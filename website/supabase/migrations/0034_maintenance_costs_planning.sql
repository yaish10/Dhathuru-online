-- Maintenance plan priorities 5-6 and the planning calendar (area 9):
--   costs & budgets (contractor cost and estimates on jobs, monthly/annual budgets, budget alerts, cost per engine hour),
--   contractors & technicians (contractor details on suppliers, technician skills, performance),
--   warranty & lifecycle (vessel warranty, warranty claims, component life events, retire/dispose, warranty reminders),
--   maintenance reports (one RPC with every report in the plan),
--   planning calendar (planned start/end and downtime on work orders, clash checks, Operations notices, calendar feed).
-- Builds on 0031 (maintenance) and 0032 (parts, suppliers, purchasing). UI is Cursor's; see DATABASE_HANDOFF.md.

-- 1. Work orders: contractor link, contractor cost, estimate, planning fields.
alter table work_orders
  add column contractor_id      uuid references suppliers(id) on delete set null,
  add column cost_contractor    numeric(12, 2) check (cost_contractor is null or cost_contractor >= 0),
  add column est_cost           numeric(12, 2) check (est_cost is null or est_cost >= 0),
  add column planned_start      timestamptz,
  add column planned_end        timestamptz,
  add column takes_out_of_service boolean not null default false,
  add column est_downtime_hours numeric(8, 1) check (est_downtime_hours is null or est_downtime_hours >= 0),
  add constraint work_orders_plan_check check (planned_end is null or planned_start is null or planned_end > planned_start);
create index on work_orders (company_id, planned_start);

-- Total actual cost of a job (labour + parts + contractor + other).
create function wo_total_cost(w work_orders) returns numeric
  language sql immutable as
$$ select coalesce(w.cost_labour, 0) + coalesce(w.cost_parts, 0) + coalesce(w.cost_contractor, 0) + coalesce(w.cost_other, 0) $$;

-- The assignee's progress RPC also takes cost_contractor (same as 0032 otherwise).
create or replace function wo_progress(p_id uuid, p_patch jsonb) returns work_orders
  language plpgsql security definer set search_path = public as
$$ declare w work_orders; issued boolean;
begin
  select * into w from work_orders where id = p_id;
  if not found then raise exception 'Work order not found.'; end if;
  if not (is_company_maint(w.company_id) or w.assignee = auth.uid()) then raise exception 'Only the person assigned or maintenance staff can update this job.'; end if;
  if w.status in ('Awaiting approval', 'Completed', 'Closed') then raise exception 'This job is %.', lower(w.status); end if;
  if p_patch ? 'status' and p_patch->>'status' not in ('Assigned', 'In progress', 'Awaiting parts') then raise exception 'Use Complete to finish the job.'; end if;
  issued := exists (select 1 from stock_moves where work_order_id = p_id and kind in ('Issued', 'Returned'));
  update work_orders set
    status = coalesce(nullif(p_patch->>'status', ''), status),
    labour_hours = case when p_patch ? 'labour_hours' then nullif(p_patch->>'labour_hours', '')::numeric else labour_hours end,
    parts_used = case when p_patch ? 'parts_used' then nullif(btrim(p_patch->>'parts_used'), '') else parts_used end,
    work_done = case when p_patch ? 'work_done' then nullif(btrim(p_patch->>'work_done'), '') else work_done end,
    cost_labour = case when p_patch ? 'cost_labour' then nullif(p_patch->>'cost_labour', '')::numeric else cost_labour end,
    cost_other = case when p_patch ? 'cost_other' then nullif(p_patch->>'cost_other', '')::numeric else cost_other end,
    cost_contractor = case when p_patch ? 'cost_contractor' then nullif(p_patch->>'cost_contractor', '')::numeric else cost_contractor end,
    cost_parts = case when issued then wo_parts_cost(p_id) when p_patch ? 'cost_parts' then nullif(p_patch->>'cost_parts', '')::numeric else cost_parts end
    where id = p_id returning * into w;
  return w;
end $$;

-- 2. Budgets: per year, optionally per month and/or vessel, per cost category ('Total' for an overall figure).
create table maint_budgets (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  year       integer not null check (year between 2000 and 2100),
  month      integer check (month is null or month between 1 and 12),
  vessel_id  uuid references vessels(id) on delete cascade,
  category   text not null default 'Total' check (category in ('Total', 'Labour', 'Parts', 'Contractor', 'Other')),
  amount     numeric(14, 2) not null check (amount >= 0),
  note       text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now()
);
create unique index maint_budgets_key on maint_budgets (company_id, year, coalesce(month, 0), coalesce(vessel_id, '00000000-0000-0000-0000-000000000000'::uuid), category);
alter table maint_budgets enable row level security;
create policy mbu_select on maint_budgets for select to authenticated using (is_company_maint(company_id));
create policy mbu_insert on maint_budgets for insert to authenticated with check (is_company_maint(company_id));
create policy mbu_update on maint_budgets for update to authenticated using (is_company_maint(company_id)) with check (is_company_maint(company_id));
create policy mbu_delete on maint_budgets for delete to authenticated using (is_company_maint(company_id));
create trigger mbu_subscription before insert or update or delete on maint_budgets for each row execute function reject_if_subscription_expired();

-- Costs of completed/closed jobs in a period, grouped by vessel, component, month, kind or category.
-- Returns [{key, label, jobs, labour, parts, contractor, other, total, estimate, budget}]. Budget is filled for 'vessel' and 'month'.
create function maint_costs(p_company uuid, p_from date, p_to date, p_group text default 'vessel') returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare out_r jsonb;
begin
  if not is_company_maint(p_company) then raise exception 'Only maintenance staff can see maintenance costs.'; end if;
  if p_group not in ('vessel', 'component', 'month', 'kind', 'category') then raise exception 'Group by vessel, component, month, kind or category.'; end if;
  with w as (
    select wo.*, coalesce(wo.completed_at, wo.closed_at, wo.updated_at)::date as done_on, wo_total_cost(wo) as tot from work_orders wo
    where wo.company_id = p_company and wo.status in ('Completed', 'Closed')
      and coalesce(wo.completed_at, wo.closed_at, wo.updated_at)::date between p_from and p_to),
  g as (
    select case p_group when 'vessel' then w.vessel_id::text when 'component' then coalesce(w.component_id::text, 'vessel:' || w.vessel_id)
                        when 'month' then to_char(w.done_on, 'YYYY-MM') when 'kind' then w.kind else coalesce(w.category, 'None') end as key,
           count(*) jobs, sum(coalesce(w.cost_labour, 0)) labour, sum(coalesce(w.cost_parts, 0)) parts, sum(coalesce(w.cost_contractor, 0)) contractor,
           sum(coalesce(w.cost_other, 0)) other, sum(w.tot) total, sum(coalesce(w.est_cost, 0)) estimate
    from w group by 1)
  select coalesce(jsonb_agg(jsonb_build_object('key', g.key,
      'label', case p_group when 'vessel' then (select v.name from vessels v where v.id::text = g.key)
                            when 'component' then coalesce((select v.name || ' · ' || c.name from vessel_components c join vessels v on v.id = c.vessel_id where c.id::text = g.key),
                                                           (select v.name || ' · whole vessel' from vessels v where 'vessel:' || v.id = g.key))
                            else g.key end,
      'jobs', g.jobs, 'labour', g.labour, 'parts', g.parts, 'contractor', g.contractor, 'other', g.other, 'total', g.total, 'estimate', g.estimate,
      'budget', case p_group
        when 'vessel' then (select sum(b.amount) from maint_budgets b where b.company_id = p_company and b.vessel_id::text = g.key and b.category = 'Total'
                              and make_date(b.year, coalesce(b.month, 1), 1) <= p_to and (case when b.month is null then make_date(b.year, 12, 31) else (make_date(b.year, b.month, 1) + interval '1 month' - interval '1 day')::date end) >= p_from)
        when 'month' then (select sum(b.amount) from maint_budgets b where b.company_id = p_company and b.vessel_id is null and b.category = 'Total'
                              and b.year = split_part(g.key, '-', 1)::int and b.month = split_part(g.key, '-', 2)::int)
        end) order by g.total desc), '[]'::jsonb)
    into out_r from g;
  return out_r;
end $$;
revoke execute on function maint_costs(uuid, date, date, text) from anon, public;
grant execute on function maint_costs(uuid, date, date, text) to authenticated;

-- Budget against actual for a year: one row per month (fleet-wide 'Total' budgets; an annual budget is spread evenly).
create function maint_budget_vs_actual(p_company uuid, p_year int, p_vessel uuid default null) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare out_r jsonb;
begin
  if not is_company_maint(p_company) then raise exception 'Only maintenance staff can see budgets.'; end if;
  select jsonb_agg(jsonb_build_object('month', m,
      'budget', coalesce((select sum(b.amount) from maint_budgets b where b.company_id = p_company and b.year = p_year and b.month = m and b.category = 'Total'
                            and b.vessel_id is not distinct from p_vessel), 0)
              + coalesce((select sum(b.amount) / 12 from maint_budgets b where b.company_id = p_company and b.year = p_year and b.month is null and b.category = 'Total'
                            and b.vessel_id is not distinct from p_vessel), 0),
      'actual', coalesce((select sum(wo_total_cost(w)) from work_orders w where w.company_id = p_company and w.status in ('Completed', 'Closed')
                            and (p_vessel is null or w.vessel_id = p_vessel)
                            and extract(year from coalesce(w.completed_at, w.closed_at)) = p_year and extract(month from coalesce(w.completed_at, w.closed_at)) = m), 0))
    order by m) into out_r from generate_series(1, 12) m;
  return out_r;
end $$;
revoke execute on function maint_budget_vs_actual(uuid, int, uuid) from anon, public;
grant execute on function maint_budget_vs_actual(uuid, int, uuid) to authenticated;

-- 3. Contractors: suppliers can also be contractors (service providers) with an agreement and a rate.
alter table suppliers
  add column kind            text not null default 'Supplier' check (kind in ('Supplier', 'Contractor', 'Both')),
  add column services        text check (services is null or char_length(services) <= 300),
  add column agreement_ref   text check (agreement_ref is null or char_length(agreement_ref) <= 80),
  add column agreement_until date,
  add column hourly_rate     numeric(10, 2) check (hourly_rate is null or hourly_rate >= 0),
  add column rating          smallint check (rating is null or rating between 1 and 5);

-- Technician skills (what each mechanic/engineer can do), used to pick the right person for a job.
create table technician_skills (
  company_id uuid not null,
  user_id    uuid not null,
  skill      text not null check (char_length(btrim(skill)) between 2 and 60),
  level      text not null default 'Qualified' check (level in ('Learning', 'Qualified', 'Expert')),
  note       text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now(),
  primary key (company_id, user_id, skill),
  foreign key (company_id, user_id) references company_members (company_id, user_id) on delete cascade
);
alter table technician_skills enable row level security;
create policy tsk_select on technician_skills for select to authenticated using (is_company_member(company_id));
create policy tsk_insert on technician_skills for insert to authenticated with check (is_company_maint(company_id));
create policy tsk_update on technician_skills for update to authenticated using (is_company_maint(company_id)) with check (is_company_maint(company_id));
create policy tsk_delete on technician_skills for delete to authenticated using (is_company_maint(company_id));

-- Who can take a job: technicians with a skill, whether they are on leave or already busy in the window.
-- Returns [{user_id, name, skills[], level, on_leave, open_jobs, clash}] best first.
create function maint_technicians(p_company uuid, p_skill text default null, p_from timestamptz default null, p_to timestamptz default null) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare out_r jsonb;
begin
  if not is_company_maint(p_company) then raise exception 'Only maintenance staff can plan technicians.'; end if;
  with t as (
    select cm.user_id, coalesce(p.full_name, split_part(p.email, '@', 1)) nm,
           array(select ts.skill from technician_skills ts where ts.company_id = p_company and ts.user_id = cm.user_id order by ts.skill) skills,
           (select ts.level from technician_skills ts where ts.company_id = p_company and ts.user_id = cm.user_id and lower(ts.skill) = lower(p_skill)) lvl,
           exists (select 1 from leave_requests l where l.company_id = p_company and l.user_id = cm.user_id and l.status = 'Approved'
                     and l.start_date <= coalesce(p_to, now())::date and l.end_date >= coalesce(p_from, now())::date) on_leave,
           (select count(*) from work_orders w where w.company_id = p_company and w.assignee = cm.user_id and w.status not in ('Completed', 'Closed', 'Draft')) open_jobs,
           exists (select 1 from work_orders w where w.company_id = p_company and w.assignee = cm.user_id and w.status not in ('Completed', 'Closed')
                     and p_from is not null and p_to is not null and w.planned_start < p_to and coalesce(w.planned_end, w.planned_start + interval '1 hour') > p_from) clash
    from company_members cm join profiles p on p.id = cm.user_id
    where cm.company_id = p_company and cm.active and cm.employment_status is distinct from 'Former'
      and (p_skill is null or exists (select 1 from technician_skills ts where ts.company_id = p_company and ts.user_id = cm.user_id and lower(ts.skill) = lower(p_skill)))
      and (p_skill is not null or exists (select 1 from technician_skills ts where ts.company_id = p_company and ts.user_id = cm.user_id)))
  select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'name', nm, 'skills', to_jsonb(skills), 'level', lvl, 'on_leave', on_leave, 'open_jobs', open_jobs, 'clash', clash)
           order by on_leave, clash, case lvl when 'Expert' then 0 when 'Qualified' then 1 else 2 end, open_jobs, nm), '[]'::jsonb)
    into out_r from t;
  return out_r;
end $$;
revoke execute on function maint_technicians(uuid, text, timestamptz, timestamptz) from anon, public;
grant execute on function maint_technicians(uuid, text, timestamptz, timestamptz) to authenticated;

-- 4. Warranty and lifecycle.
alter table vessels add column warranty_until date;
alter table vessel_components
  add column expected_life_hours numeric(10, 1) check (expected_life_hours is null or expected_life_hours > 0),
  add column expected_life_years numeric(5, 1) check (expected_life_years is null or expected_life_years > 0),
  add column supplier_id         uuid references suppliers(id) on delete set null,
  add column retired_on          date,
  add column disposed_on         date,
  add column disposal_note       text check (disposal_note is null or char_length(disposal_note) <= 300);

create table component_events (
  id            bigint generated always as identity primary key,
  company_id    uuid not null references companies(id) on delete cascade,
  vessel_id     uuid references vessels(id) on delete cascade,
  component_id  uuid not null references vessel_components(id) on delete cascade,
  kind          text not null check (kind in ('Installed', 'Overhaul', 'Repaired', 'Replaced', 'Removed', 'Retired', 'Disposed', 'Warranty claim')),
  on_date       date not null default current_date,
  hours_at      numeric(10, 1),
  cost          numeric(12, 2) check (cost is null or cost >= 0),
  work_order_id uuid references work_orders(id) on delete set null,
  note          text check (note is null or char_length(note) <= 500),
  actor         uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index on component_events (component_id, on_date desc);
alter table component_events enable row level security;
create policy cev_select on component_events for select to authenticated using (is_company_member(company_id));
create policy cev_insert on component_events for insert to authenticated with check (is_company_maint(company_id) and actor = auth.uid());
create policy cev_delete on component_events for delete to authenticated using (is_company_maint(company_id));

-- Status changes on a component are written to its life history automatically.
create function components_lifecycle() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  if tg_op = 'INSERT' then
    insert into component_events (company_id, vessel_id, component_id, kind, on_date, hours_at, actor, note)
      values (new.company_id, new.vessel_id, new.id, 'Installed', coalesce(new.installed_on, current_date), new.hours, auth.uid(), new.make_model);
  elsif new.status is distinct from old.status then
    if new.status = 'Retired' and new.retired_on is null then new.retired_on := current_date; end if;
    insert into component_events (company_id, vessel_id, component_id, kind, on_date, hours_at, actor, note)
      values (new.company_id, new.vessel_id, new.id, case new.status when 'Retired' then 'Retired' when 'Removed' then 'Removed' else 'Installed' end, current_date, new.hours, auth.uid(), null);
  elsif new.disposed_on is not null and old.disposed_on is null then
    insert into component_events (company_id, vessel_id, component_id, kind, on_date, hours_at, actor, note)
      values (new.company_id, new.vessel_id, new.id, 'Disposed', new.disposed_on, new.hours, auth.uid(), new.disposal_note);
  end if;
  return new;
end $$;
create trigger vco_lifecycle_b before update on vessel_components for each row execute function components_lifecycle();
create trigger vco_lifecycle_a after insert on vessel_components for each row execute function components_lifecycle();

-- Overhaul / Replaced / Repaired events are added by maintenance staff (insert into component_events).

create table warranty_claims (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  number           integer not null,
  vessel_id        uuid references vessels(id) on delete cascade,
  component_id     uuid references vessel_components(id) on delete set null,
  supplier_id      uuid references suppliers(id) on delete set null,
  defect_id        uuid references defects(id) on delete set null,
  work_order_id    uuid references work_orders(id) on delete set null,
  title            text not null check (char_length(btrim(title)) between 3 and 120),
  detail           text check (detail is null or char_length(detail) <= 2000),
  status           text not null default 'Draft' check (status in ('Draft', 'Submitted', 'Approved', 'Rejected', 'Paid')),
  claimed_amount   numeric(12, 2) check (claimed_amount is null or claimed_amount >= 0),
  recovered_amount numeric(12, 2) check (recovered_amount is null or recovered_amount >= 0),
  supplier_ref     text check (supplier_ref is null or char_length(supplier_ref) <= 80),
  submitted_on     date,
  decided_on       date,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, number)
);
alter table warranty_claims enable row level security;
create policy wcl_select on warranty_claims for select to authenticated using (is_company_maint(company_id));
create policy wcl_update on warranty_claims for update to authenticated using (is_company_maint(company_id)) with check (is_company_maint(company_id));
create policy wcl_delete on warranty_claims for delete to authenticated using (is_company_maint(company_id) and status = 'Draft');
create trigger wcl_subscription before insert or update or delete on warranty_claims for each row execute function reject_if_subscription_expired();
alter table maint_files drop constraint if exists maint_files_ref_type_check;
alter table maint_files add constraint maint_files_ref_type_check check (ref_type in ('vessel', 'component', 'work_order', 'defect', 'part', 'purchase_order', 'warranty_claim', 'supplier'));

create function open_warranty_claim(p_company uuid, p_row jsonb) returns warranty_claims
  language plpgsql security definer set search_path = public as
$$ declare c warranty_claims; n int; comp vessel_components;
begin
  if not is_company_maint(p_company) then raise exception 'Only maintenance staff can make warranty claims.'; end if;
  if coalesce(char_length(btrim(p_row->>'title')), 0) < 3 then raise exception 'Say what the claim is for.'; end if;
  if nullif(p_row->>'component_id', '') is not null then
    select * into comp from vessel_components where id = (p_row->>'component_id')::uuid and company_id = p_company;
    if not found then raise exception 'Component not found.'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('wcl_' || p_company::text));
  select coalesce(max(number), 0) + 1 into n from warranty_claims where company_id = p_company;
  insert into warranty_claims (company_id, number, vessel_id, component_id, supplier_id, defect_id, work_order_id, title, detail, claimed_amount, supplier_ref, created_by)
    values (p_company, n, coalesce(nullif(p_row->>'vessel_id', '')::uuid, comp.vessel_id), comp.id, coalesce(nullif(p_row->>'supplier_id', '')::uuid, comp.supplier_id),
            nullif(p_row->>'defect_id', '')::uuid, nullif(p_row->>'work_order_id', '')::uuid, btrim(p_row->>'title'), nullif(btrim(p_row->>'detail'), ''),
            nullif(p_row->>'claimed_amount', '')::numeric, nullif(btrim(p_row->>'supplier_ref'), ''), auth.uid())
    returning * into c;
  if comp.id is not null then
    insert into component_events (company_id, vessel_id, component_id, kind, actor, note, cost)
      values (p_company, comp.vessel_id, comp.id, 'Warranty claim', auth.uid(), 'Claim WC-' || n || ': ' || c.title, c.claimed_amount);
  end if;
  perform maint_log(p_company, c.vessel_id, 'warranty', c.id, 'Warranty claim WC-' || n || ' opened: ' || c.title);
  return c;
end $$;
revoke execute on function open_warranty_claim(uuid, jsonb) from anon, public;
grant execute on function open_warranty_claim(uuid, jsonb) to authenticated;

create function warranty_claims_audit() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    if new.status = 'Submitted' and new.submitted_on is null then new.submitted_on := current_date; end if;
    if new.status in ('Approved', 'Rejected', 'Paid') and new.decided_on is null then new.decided_on := current_date; end if;
    perform maint_log(new.company_id, new.vessel_id, 'warranty', new.id, 'WC-' || new.number || ': ' || old.status || ' → ' || new.status);
  end if;
  return new;
end $$;
create trigger wcl_audit before update on warranty_claims for each row execute function warranty_claims_audit();

-- 5. Vessel availability history (for downtime and availability reports).
create table vessel_status_periods (
  id         bigint generated always as identity primary key,
  company_id uuid not null references companies(id) on delete cascade,
  vessel_id  uuid not null references vessels(id) on delete cascade,
  status     text not null check (status in ('Operational', 'Restricted', 'Out of service')),
  reason     text,
  from_at    timestamptz not null,
  to_at      timestamptz
);
create index on vessel_status_periods (vessel_id, from_at);
alter table vessel_status_periods enable row level security;
create policy vsp_select on vessel_status_periods for select to authenticated using (is_company_member(company_id));
insert into vessel_status_periods (company_id, vessel_id, status, reason, from_at)
  select company_id, id, status, status_reason, case when status = 'Operational' then created_at else status_at end from vessels;

-- Same as 0031, plus closing the old status period and opening a new one.
create or replace function vessels_guard() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'Operational' and coalesce(current_setting('veyora.release', true), '') <> '1' then
      raise exception 'Use "Return to service" to make % operational again.', old.name;
    end if;
    new.status_at := now();
    update vessel_status_periods set to_at = now() where vessel_id = new.id and to_at is null;
    insert into vessel_status_periods (company_id, vessel_id, status, reason, from_at) values (new.company_id, new.id, new.status, new.status_reason, now());
    perform maint_log(new.company_id, new.id, 'vessel', new.id, new.name || ': ' || old.status || ' → ' || new.status || coalesce(' (' || new.status_reason || ')', ''));
    perform notify_many(new.company_id, maint_user_ids(new.company_id), 'vessel_status', to_char(now(), 'YYYYMMDDHH24MI'), 'vessel', new.id::text,
      new.name || ' is now ' || lower(new.status), coalesce(new.status_reason, ''));
  end if;
  return new;
end $$;
create function vessels_first_period() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  insert into vessel_status_periods (company_id, vessel_id, status, reason, from_at) values (new.company_id, new.id, new.status, new.status_reason, now());
  return new;
end $$;
create trigger ves_first_period after insert on vessels for each row execute function vessels_first_period();

-- Hours a vessel spent in a status within a window.
create function vessel_hours_in(p_vessel uuid, p_status text, p_from timestamptz, p_to timestamptz) returns numeric
  language sql stable security definer set search_path = public as
$$ select coalesce(sum(extract(epoch from (least(coalesce(to_at, now()), p_to) - greatest(from_at, p_from))) / 3600.0), 0)
   from vessel_status_periods where vessel_id = p_vessel and status = p_status and from_at < p_to and coalesce(to_at, now()) > p_from $$;
revoke execute on function vessel_hours_in(uuid, text, timestamptz, timestamptz) from anon, public;

-- 6. Planning calendar: plan a job in time, check clashes, tell Operations.
-- Operators (roles owner/admin/operations) plus maintenance people get the notice.
create function plan_work_order(p_id uuid, p_start timestamptz, p_end timestamptz, p_out boolean default false, p_downtime numeric default null) returns work_orders
  language plpgsql security definer set search_path = public as
$$ declare w work_orders; v vessels; clash work_orders; was timestamptz; tech_clash work_orders;
begin
  select * into w from work_orders where id = p_id;
  if not found then raise exception 'Work order not found.'; end if;
  if not is_company_maint(w.company_id) then raise exception 'Only maintenance staff can plan jobs.'; end if;
  if w.status in ('Completed', 'Closed') then raise exception 'This job is already %.', lower(w.status); end if;
  if p_start is null then
    update work_orders set planned_start = null, planned_end = null, takes_out_of_service = false, est_downtime_hours = null where id = p_id returning * into w;
    return w;
  end if;
  if p_end is null or p_end <= p_start then raise exception 'The end must be after the start.'; end if;
  select * into v from vessels where id = w.vessel_id;
  -- Two jobs that take the same vessel out of service may not overlap.
  if coalesce(p_out, false) then
    select * into clash from work_orders x where x.vessel_id = w.vessel_id and x.id <> w.id and x.takes_out_of_service and x.status not in ('Completed', 'Closed')
      and x.planned_start < p_end and coalesce(x.planned_end, x.planned_start) > p_start order by x.planned_start limit 1;
    if clash.id is not null then
      raise exception '% is already booked out of service for % (% to %).', v.name, clash.code, to_char(clash.planned_start, 'DD Mon HH24:MI'), to_char(clash.planned_end, 'DD Mon HH24:MI');
    end if;
  end if;
  -- The assigned technician may not have two planned jobs at the same time.
  if w.assignee is not null then
    select * into tech_clash from work_orders x where x.assignee = w.assignee and x.id <> w.id and x.status not in ('Completed', 'Closed')
      and x.planned_start < p_end and coalesce(x.planned_end, x.planned_start) > p_start limit 1;
    if tech_clash.id is not null then
      raise exception 'The person assigned already has % planned at that time.', tech_clash.code;
    end if;
  end if;
  was := w.planned_start;
  update work_orders set planned_start = p_start, planned_end = p_end, takes_out_of_service = coalesce(p_out, false),
    est_downtime_hours = coalesce(p_downtime, case when coalesce(p_out, false) then round(extract(epoch from (p_end - p_start)) / 3600.0, 1) end)
    where id = p_id returning * into w;
  perform maint_log(w.company_id, w.vessel_id, 'plan', w.id, w.code || case when was is null then ' planned ' else ' moved to ' end || to_char(p_start, 'DD Mon HH24:MI') || '–' || to_char(p_end, 'DD Mon HH24:MI')
    || case when w.takes_out_of_service then ' (vessel out of service)' else '' end);
  if w.takes_out_of_service then
    perform notify_many(w.company_id, maint_user_ids(w.company_id), 'maint_plan', to_char(now(), 'YYYYMMDDHH24MI'), 'work_order', w.id::text,
      v.name || case when was is null then ' booked out of service' else ' maintenance moved' end,
      to_char(p_start, 'DD Mon HH24:MI') || ' to ' || to_char(p_end, 'DD Mon HH24:MI') || ' · ' || w.code || ' ' || w.title);
  end if;
  if w.assignee is not null then
    perform notify_user(w.company_id, w.assignee, 'work_order', 'plan' || to_char(now(), 'HH24MI'), 'work_order', w.id::text,
      w.code || ' planned for ' || to_char(p_start, 'DD Mon HH24:MI'), w.title);
  end if;
  return w;
end $$;
revoke execute on function plan_work_order(uuid, timestamptz, timestamptz, boolean, numeric) from anon, public;
grant execute on function plan_work_order(uuid, timestamptz, timestamptz, boolean, numeric) to authenticated;

-- Calendar feed for a window: planned jobs, preventive services falling due, and out-of-service periods.
-- Returns [{type: 'job'|'due'|'down', id, vessel_id, vessel, title, start, end, status, priority, out_of_service, code}].
create function maint_calendar(p_company uuid, p_from date, p_to date) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare out_r jsonb := '[]'::jsonb; s record; st jsonb;
begin
  if not is_company_member(p_company) then raise exception 'Not a member of this company.'; end if;
  if p_to < p_from or p_to - p_from > 100 then raise exception 'Choose a window of up to about three months.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('type', 'job', 'id', w.id, 'vessel_id', w.vessel_id, 'vessel', v.name, 'title', w.title, 'code', w.code,
           'start', coalesce(w.planned_start, w.due_on::timestamptz), 'end', coalesce(w.planned_end, w.planned_start, w.due_on::timestamptz),
           'status', w.status, 'priority', w.priority, 'out_of_service', w.takes_out_of_service, 'assignee', w.assignee, 'planned', w.planned_start is not null)), '[]'::jsonb)
    into out_r
    from work_orders w join vessels v on v.id = w.vessel_id
    where w.company_id = p_company and w.status <> 'Draft'
      and ((w.planned_start is not null and w.planned_start::date <= p_to and coalesce(w.planned_end, w.planned_start)::date >= p_from)
        or (w.planned_start is null and w.due_on between p_from and p_to and w.status not in ('Completed', 'Closed')));
  for s in select ms.id, ms.title, ms.vessel_id, v.name vname from maint_schedules ms join vessels v on v.id = ms.vessel_id
           where ms.company_id = p_company and ms.active
             and not exists (select 1 from work_orders w where w.schedule_id = ms.id and w.status not in ('Completed', 'Closed')) loop
    st := maint_schedule_state(s.id);
    if (st->>'next_on')::date between p_from and p_to
       or (st->>'state' in ('overdue', 'due') and current_date between p_from and p_to and (st->>'state' = 'overdue' or st->>'next_on' is null)) then
      out_r := out_r || jsonb_build_object('type', 'due', 'id', s.id, 'vessel_id', s.vessel_id, 'vessel', s.vname, 'title', s.title,
        'start', coalesce(least((st->>'next_on')::date, case when st->>'state' = 'overdue' then current_date end), current_date), 'end', null, 'status', st->>'state',
        'next_hours', st->'next_hours', 'hours', st->'hours');
    end if;
  end loop;
  out_r := out_r || coalesce((select jsonb_agg(jsonb_build_object('type', 'down', 'id', p.id, 'vessel_id', p.vessel_id, 'vessel', v.name, 'title', p.status || coalesce(': ' || p.reason, ''),
           'start', p.from_at, 'end', p.to_at, 'status', p.status))
         from vessel_status_periods p join vessels v on v.id = p.vessel_id
         where p.company_id = p_company and p.status <> 'Operational' and p.from_at::date <= p_to and coalesce(p.to_at, now())::date >= p_from), '[]'::jsonb);
  return out_r;
end $$;
revoke execute on function maint_calendar(uuid, date, date) from anon, public;
grant execute on function maint_calendar(uuid, date, date) to authenticated;

-- 7. Reminders (same as 0031) plus: planned out-of-service jobs that have started take the vessel out of service,
--    warranties ending within the reminder window, contractor agreements ending, and monthly budget warnings.
create or replace function scan_maintenance(p_company uuid) returns integer
  language plpgsql security definer set search_path = public as
$$ declare s record; st jsonb; cfg jsonb; n int := 0; who uuid[]; wd int; w record; c record; b record; warn numeric; spent numeric;
begin
  if not is_company_member(p_company) then return 0; end if;
  select coalesce(settings->'10_maintenance_reminder_rules', '{}'::jsonb) into cfg from companies where id = p_company;
  wd := coalesce(nullif(cfg->>'first', '')::int, 14);
  who := maint_user_ids(p_company);
  for s in select ms.id, ms.title, v.name vname from maint_schedules ms join vessels v on v.id = ms.vessel_id where ms.company_id = p_company and ms.active loop
    st := maint_schedule_state(s.id);
    if st->>'state' = 'overdue' and coalesce((cfg->>'overdue')::boolean, true) then
      n := n + notify_many(p_company, who, 'maint_due', 'over' || to_char(current_date, 'YYYYMMDD'), 'schedule', s.id::text, 'Overdue: ' || s.title, s.vname);
    elsif st->>'state' = 'due' then
      n := n + notify_many(p_company, who, 'maint_due', left('due' || coalesce(st->>'next_on', st->>'next_hours', ''), 20), 'schedule', s.id::text, 'Maintenance due: ' || s.title, s.vname || coalesce(' · by ' || to_char((st->>'next_on')::date, 'DD Mon'), '') || coalesce(' · at ' || (st->>'next_hours') || ' h', ''));
    end if;
  end loop;
  -- planned jobs that take a vessel out of service and have started
  for w in select wo.id, wo.code, wo.title, wo.vessel_id from work_orders wo join vessels v on v.id = wo.vessel_id
           where wo.company_id = p_company and wo.takes_out_of_service and wo.status not in ('Completed', 'Closed', 'Draft')
             and wo.planned_start <= now() and coalesce(wo.planned_end, wo.planned_start) > now() and v.status = 'Operational' loop
    update vessels set status = 'Out of service', status_reason = left('Planned: ' || w.code || ' ' || w.title, 200) where id = w.vessel_id;
    n := n + 1;
  end loop;
  -- warranties ending (components and vessels)
  for c in select vc.id, vc.name, vc.warranty_until, v.name vname from vessel_components vc join vessels v on v.id = vc.vessel_id
           where vc.company_id = p_company and vc.status = 'In service' and vc.warranty_until between current_date and current_date + wd loop
    n := n + notify_many(p_company, who, 'maint_warranty', to_char(c.warranty_until, 'YYYYMMDD'), 'component', c.id::text,
      'Warranty ends ' || to_char(c.warranty_until, 'DD Mon') || ': ' || c.name, c.vname);
  end loop;
  for c in select v.id, v.name, v.warranty_until from vessels v where v.company_id = p_company and v.warranty_until between current_date and current_date + wd loop
    n := n + notify_many(p_company, who, 'maint_warranty', to_char(c.warranty_until, 'YYYYMMDD'), 'vessel', c.id::text, 'Vessel warranty ends ' || to_char(c.warranty_until, 'DD Mon'), c.name);
  end loop;
  -- contractor agreements ending
  for c in select su.id, su.name, su.agreement_until from suppliers su where su.company_id = p_company and su.active and su.kind in ('Contractor', 'Both')
             and su.agreement_until between current_date and current_date + wd loop
    n := n + notify_many(p_company, who, 'maint_contract', to_char(c.agreement_until, 'YYYYMMDD'), 'supplier', c.id::text,
      'Contractor agreement ends ' || to_char(c.agreement_until, 'DD Mon'), c.name);
  end loop;
  -- monthly fleet budget: warn at the percentage in Maintenance Budget Rules (default 90%)
  warn := coalesce(nullif((select settings->'10_maintenance_budget_rules'->>'warnPct' from companies where id = p_company), '')::numeric, 90);
  select coalesce(sum(amount), 0) amount into b from maint_budgets
    where company_id = p_company and vessel_id is null and category = 'Total' and year = extract(year from current_date) and month = extract(month from current_date);
  if b.amount > 0 then
    select coalesce(sum(wo_total_cost(x)), 0) into spent from work_orders x where x.company_id = p_company and x.status in ('Completed', 'Closed')
      and date_trunc('month', coalesce(x.completed_at, x.closed_at)) = date_trunc('month', now());
    if spent >= b.amount * warn / 100 then
      n := n + notify_many(p_company, who, 'maint_budget', to_char(current_date, 'YYYYMM') || case when spent >= b.amount then 'over' else 'warn' end, 'budget', to_char(current_date, 'YYYYMM'),
        case when spent >= b.amount then 'Maintenance budget exceeded this month' else 'Maintenance budget ' || round(spent * 100 / b.amount) || '% used this month' end,
        round(spent, 2) || ' of ' || round(b.amount, 2));
    end if;
  end if;
  return n;
end $$;

-- 8. Reports: everything in plan section 15 for a period, in one call (maintenance staff only).
create function maint_report(p_company uuid, p_from date, p_to date) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare
  f timestamptz := p_from::timestamptz; t timestamptz := (p_to + 1)::timestamptz; hrs numeric := extract(epoch from ((p_to + 1)::timestamptz - p_from::timestamptz)) / 3600.0;
  r jsonb := '{}'::jsonb;
begin
  if not is_company_maint(p_company) then raise exception 'Only maintenance staff can see maintenance reports.'; end if;
  if p_to < p_from or p_to - p_from > 400 then raise exception 'Choose a period of up to about a year.'; end if;

  -- history by vessel: jobs, defects, inspections, cost, downtime, availability
  r := r || jsonb_build_object('vessels', coalesce((select jsonb_agg(x order by x->>'vessel') from (
    select jsonb_build_object('vessel_id', v.id, 'vessel', v.name, 'status', v.status,
      'jobs_done', (select count(*) from work_orders w where w.vessel_id = v.id and w.status in ('Completed', 'Closed') and coalesce(w.completed_at, w.closed_at) >= f and coalesce(w.completed_at, w.closed_at) < t),
      'jobs_open', (select count(*) from work_orders w where w.vessel_id = v.id and w.status not in ('Completed', 'Closed', 'Draft')),
      'defects', (select count(*) from defects d where d.vessel_id = v.id and d.reported_at >= f and d.reported_at < t),
      'breakdowns', (select count(*) from defects d where d.vessel_id = v.id and d.kind = 'Breakdown' and d.reported_at >= f and d.reported_at < t),
      'inspections', (select count(*) from maint_inspections i where i.vessel_id = v.id and i.submitted_at >= f and i.submitted_at < t),
      'failed_items', (select coalesce(sum(i.failed), 0) from maint_inspections i where i.vessel_id = v.id and i.submitted_at >= f and i.submitted_at < t),
      'cost', (select coalesce(sum(wo_total_cost(w)), 0) from work_orders w where w.vessel_id = v.id and w.status in ('Completed', 'Closed') and coalesce(w.completed_at, w.closed_at) >= f and coalesce(w.completed_at, w.closed_at) < t),
      'downtime_hours', round(vessel_hours_in(v.id, 'Out of service', f, least(t, now())), 1),
      'restricted_hours', round(vessel_hours_in(v.id, 'Restricted', f, least(t, now())), 1),
      'availability_pct', case when least(t, now()) > f then round(100 - 100 * vessel_hours_in(v.id, 'Out of service', f, least(t, now())) / (extract(epoch from (least(t, now()) - f)) / 3600.0), 1) end) x
    from vessels v where v.company_id = p_company) q), '[]'::jsonb));

  -- upcoming and overdue preventive maintenance
  r := r || jsonb_build_object('schedules', coalesce((select jsonb_agg(jsonb_build_object('id', ms.id, 'title', ms.title, 'vessel', v.name, 'state', st->>'state', 'next_on', st->'next_on', 'next_hours', st->'next_hours', 'hours', st->'hours')
      order by case st->>'state' when 'overdue' then 0 when 'due' then 1 else 2 end, st->>'next_on')
    from maint_schedules ms join vessels v on v.id = ms.vessel_id, lateral (select maint_schedule_state(ms.id) st) z
    where ms.company_id = p_company and ms.active), '[]'::jsonb));

  -- repeated defects and component failures (same component, 2+ defects in the period)
  r := r || jsonb_build_object('repeat_defects', coalesce((select jsonb_agg(x order by k desc) from (
    select jsonb_build_object('component_id', d.component_id, 'component', c.name, 'vessel', v.name, 'count', count(*), 'last', max(d.reported_at), 'titles', jsonb_agg(d.title order by d.reported_at)) x, count(*) k
    from defects d join vessel_components c on c.id = d.component_id join vessels v on v.id = d.vessel_id
    where d.company_id = p_company and d.reported_at >= f and d.reported_at < t group by d.component_id, c.name, v.name having count(*) >= 2) q), '[]'::jsonb));

  -- spare-parts consumption (issued minus returned)
  r := r || jsonb_build_object('parts_used', coalesce((select jsonb_agg(x order by k desc) from (
    select jsonb_build_object('part_id', p.id, 'part_no', p.part_no, 'name', p.name, 'unit', p.unit, 'qty', -sum(sm.qty), 'cost', -sum(sm.qty * coalesce(sm.unit_cost, 0))) x, -sum(sm.qty * coalesce(sm.unit_cost, 0)) k
    from stock_moves sm join parts p on p.id = sm.part_id
    where sm.company_id = p_company and sm.kind in ('Issued', 'Returned') and sm.created_at >= f and sm.created_at < t group by p.id, p.part_no, p.name, p.unit) q), '[]'::jsonb));

  -- costs by vessel and by engine/component
  r := r || jsonb_build_object('costs_by_vessel', maint_costs(p_company, p_from, p_to, 'vessel'), 'costs_by_component', maint_costs(p_company, p_from, p_to, 'component'));

  -- cost per engine running hour (only where the hour meter moved in the period)
  r := r || jsonb_build_object('cost_per_hour', coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('component_id', c.id, 'component', c.name, 'vessel', v.name, 'hours_run', hr.run,
      'cost', coalesce((select sum(wo_total_cost(w)) from work_orders w where w.component_id = c.id and w.status in ('Completed', 'Closed') and coalesce(w.completed_at, w.closed_at) >= f and coalesce(w.completed_at, w.closed_at) < t), 0),
      'per_hour', round(coalesce((select sum(wo_total_cost(w)) from work_orders w where w.component_id = c.id and w.status in ('Completed', 'Closed') and coalesce(w.completed_at, w.closed_at) >= f and coalesce(w.completed_at, w.closed_at) < t), 0) / nullif(hr.run, 0), 2)) x
    from vessel_components c join vessels v on v.id = c.vessel_id,
      lateral (select max(h.hours) - min(h.hours) run from hour_readings h where h.component_id = c.id and h.read_at >= f and h.read_at < t) hr
    where c.company_id = p_company and c.tracks_hours and hr.run > 0) q), '[]'::jsonb));

  -- technician productivity
  r := r || jsonb_build_object('technicians', coalesce((select jsonb_agg(x order by k desc) from (
    select jsonb_build_object('user_id', w.assignee, 'name', coalesce(p.full_name, split_part(p.email, '@', 1)),
      'completed', count(*), 'labour_hours', coalesce(sum(w.labour_hours), 0),
      'avg_days', round(avg(extract(epoch from (w.completed_at - w.created_at)) / 86400.0)::numeric, 1),
      'on_time_pct', round(100.0 * count(*) filter (where w.due_on is null or w.completed_at::date <= w.due_on) / count(*), 0)) x, count(*) k
    from work_orders w join profiles p on p.id = w.assignee
    where w.company_id = p_company and w.status in ('Completed', 'Closed') and w.completed_at >= f and w.completed_at < t group by w.assignee, p.full_name, p.email) q), '[]'::jsonb));

  -- contractor performance: jobs, cost, on time, callbacks (a defect on the same component within 30 days of their job)
  r := r || jsonb_build_object('contractors', coalesce((select jsonb_agg(x order by k desc) from (
    select jsonb_build_object('supplier_id', su.id, 'name', su.name, 'rating', su.rating, 'agreement_until', su.agreement_until,
      'jobs', count(w.id), 'cost', coalesce(sum(wo_total_cost(w)), 0),
      'on_time_pct', case when count(w.id) > 0 then round(100.0 * count(w.id) filter (where w.due_on is null or w.completed_at::date <= w.due_on) / count(w.id), 0) end,
      'callbacks', (select count(*) from work_orders w2 join defects d on d.component_id = w2.component_id and d.reported_at > w2.completed_at and d.reported_at < w2.completed_at + interval '30 days'
                    where w2.contractor_id = su.id and w2.completed_at >= f and w2.completed_at < t)) x, count(w.id) k
    from suppliers su left join work_orders w on w.contractor_id = su.id and w.status in ('Completed', 'Closed') and w.completed_at >= f and w.completed_at < t
    where su.company_id = p_company and su.kind in ('Contractor', 'Both') group by su.id, su.name, su.rating, su.agreement_until) q), '[]'::jsonb));

  -- planned versus unplanned (Preventive/Inspection = planned; Corrective/Breakdown = unplanned)
  r := r || jsonb_build_object('planned_vs_unplanned', (select jsonb_build_object(
      'planned_jobs', count(*) filter (where kind in ('Preventive', 'Inspection')), 'unplanned_jobs', count(*) filter (where kind in ('Corrective', 'Breakdown')),
      'planned_cost', coalesce(sum(wo_total_cost(w)) filter (where kind in ('Preventive', 'Inspection')), 0),
      'unplanned_cost', coalesce(sum(wo_total_cost(w)) filter (where kind in ('Corrective', 'Breakdown')), 0))
    from work_orders w where w.company_id = p_company and w.status in ('Completed', 'Closed') and coalesce(w.completed_at, w.closed_at) >= f and coalesce(w.completed_at, w.closed_at) < t));

  -- compliance: preventive jobs done by their due date; schedules overdue now
  r := r || jsonb_build_object('compliance', (select jsonb_build_object(
      'preventive_done', count(*), 'on_time', count(*) filter (where w.due_on is null or w.completed_at::date <= w.due_on),
      'on_time_pct', case when count(*) > 0 then round(100.0 * count(*) filter (where w.due_on is null or w.completed_at::date <= w.due_on) / count(*), 0) end,
      'overdue_now', (select count(*) from maint_schedules ms where ms.company_id = p_company and ms.active and maint_schedule_state(ms.id)->>'state' = 'overdue'),
      'open_stopping_defects', (select count(*) from defects d where d.company_id = p_company and d.stops_operation and d.status in ('Open', 'Temporary fix')))
    from work_orders w where w.company_id = p_company and w.kind = 'Preventive' and w.status in ('Completed', 'Closed') and w.completed_at >= f and w.completed_at < t));

  -- warranty claims in the period
  r := r || jsonb_build_object('warranty', (select jsonb_build_object('claims', count(*), 'claimed', coalesce(sum(claimed_amount), 0), 'recovered', coalesce(sum(recovered_amount), 0),
      'open', count(*) filter (where status in ('Draft', 'Submitted')))
    from warranty_claims where company_id = p_company and created_at >= f and created_at < t));

  return r || jsonb_build_object('from', p_from, 'to', p_to, 'period_hours', round(hrs, 1));
end $$;
revoke execute on function maint_report(uuid, date, date) from anon, public;
grant execute on function maint_report(uuid, date, date) to authenticated;
