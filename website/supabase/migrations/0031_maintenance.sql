-- Maintenance (first round: plan priorities 1-3): vessels with engines and components, running hours, preventive schedules
-- (by date or engine hours) with reminders, numbered work orders with statuses and approval, breakdown and defect reports,
-- inspection checklists that raise defects, vessel availability with return-to-service release, files and an activity log.
-- Settings live under 10_ (Maintenance Settings). Spare parts, purchasing, costs/budgets and reports come later.

-- 1. Who runs maintenance: owners, admins, operations, and the people named for "Maintenance approvals"
--    in Approvers & Responsibilities. Everyone in the company can see vessels, report defects and submit inspections.
create function maint_named(p_company uuid) returns uuid[]
  language sql stable security definer set search_path = public as
$$ select coalesce(array_agg(distinct v::uuid), '{}') from companies c,
     lateral (select coalesce(c.settings->'8_approvers_and_responsibilities'->'duties'->'maintenance', '{}'::jsonb) d) x,
     lateral (select jsonb_array_elements_text(coalesce(x.d->'people', '[]'::jsonb)) v union select x.d->>'backup' where x.d->>'backup' is not null) y
   where c.id = p_company and exists (select 1 from company_members m where m.company_id = p_company and m.user_id = y.v::uuid and m.active) $$;
revoke execute on function maint_named(uuid) from anon, public;

create function is_company_maint(cid uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select is_platform_admin()
     or exists (select 1 from company_members where company_id = cid and user_id = auth.uid() and active and role::text in ('owner', 'admin', 'operations'))
     or auth.uid() = any(maint_named(cid)) $$;
revoke execute on function is_company_maint(uuid) from anon, public;
grant execute on function is_company_maint(uuid) to authenticated;

-- Approves work orders and returns vessels to service: the named maintenance people, else owners/admins and the role in
-- Maintenance Approval Rules (default Operations).
create function is_maint_approver(cid uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select is_platform_admin()
     or exists (select 1 from company_members where company_id = cid and user_id = auth.uid() and active and role::text in ('owner', 'admin'))
     or auth.uid() = any(maint_named(cid))
     or (cardinality(maint_named(cid)) = 0 and exists (select 1 from company_members m, companies c where c.id = cid and m.company_id = cid and m.user_id = auth.uid() and m.active
           and m.role::text = lower(coalesce(c.settings->'10_maintenance_approval_rules'->>'approver', 'Operations')))) $$;
revoke execute on function is_maint_approver(uuid) from anon, public;
grant execute on function is_maint_approver(uuid) to authenticated;

create function maint_user_ids(p_company uuid) returns uuid[]
  language sql stable security definer set search_path = public as
$$ select coalesce(array_agg(distinct u), '{}') from (
     select user_id u from company_members where company_id = p_company and active and role::text in ('owner', 'admin', 'operations')
     union select unnest(maint_named(p_company))) x $$;
revoke execute on function maint_user_ids(uuid) from anon, public;

-- Maintenance people may change Maintenance Settings (10_).
create or replace function set_company_setting(p_company uuid, p_key text, p_value jsonb) returns void
  language plpgsql security definer set search_path = public as
$$ begin
  if not (is_company_admin(p_company)
          or ((p_key like '8\_%' or p_key like '16\_%') and is_company_hr(p_company))
          or ((p_key like '13\_%' or p_key like '14\_%' or p_key like '17\_%') and is_company_it(p_company))
          or (p_key like '10\_%' and is_company_maint(p_company))) then
    raise exception 'Only owners and admins can change settings.';
  end if;
  if p_key !~ '^[a-z0-9_]{1,60}$' then raise exception 'Invalid setting key.'; end if;
  if pg_column_size(p_value) > 100000 then raise exception 'Setting is too large.'; end if;
  update companies set settings = jsonb_set(coalesce(settings, '{}'::jsonb), array[p_key], p_value, true) where id = p_company;
  insert into company_audit (company_id, actor, action, detail) values (p_company, auth.uid(), 'setting_changed', p_key);
end $$;

-- 2. Activity log.
create table maint_events (
  id         bigint generated always as identity primary key,
  company_id uuid not null references companies(id) on delete cascade,
  vessel_id  uuid,
  ref_type   text not null check (char_length(ref_type) between 2 and 30),
  ref_id     uuid,
  detail     text not null check (char_length(detail) <= 300),
  actor      uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on maint_events (company_id, created_at desc);
create index on maint_events (vessel_id, created_at desc);
alter table maint_events enable row level security;
create policy mev_select on maint_events for select to authenticated using (is_company_member(company_id));

create function maint_log(p_company uuid, p_vessel uuid, p_type text, p_ref uuid, p_detail text) returns void
  language sql security definer set search_path = public as
$$ insert into maint_events (company_id, vessel_id, ref_type, ref_id, detail, actor)
   select p_company, p_vessel, p_type, p_ref, left(p_detail, 300), auth.uid() where exists (select 1 from companies where id = p_company) $$;
revoke execute on function maint_log(uuid, uuid, text, uuid, text) from anon, public, authenticated;

-- 3. Vessels and their components (engines, gearboxes, generators, ...).
create table vessels (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  code          text not null check (char_length(btrim(code)) between 1 and 30),
  name          text not null check (char_length(btrim(name)) between 1 and 80),
  kind          text not null default 'Ferry' check (char_length(kind) between 2 and 40),
  registration  text check (registration is null or char_length(registration) <= 40),
  built_year    integer check (built_year is null or built_year between 1900 and 2100),
  status        text not null default 'Operational' check (status in ('Operational', 'Restricted', 'Out of service')),
  status_reason text check (status_reason is null or char_length(status_reason) <= 200),
  status_at     timestamptz not null default now(),
  released_by   uuid references auth.users(id) on delete set null,
  released_at   timestamptz,
  note          text check (note is null or char_length(note) <= 500),
  created_at    timestamptz not null default now(),
  unique (company_id, code)
);
alter table vessels enable row level security;
create policy ves_select on vessels for select to authenticated using (is_company_member(company_id));
create policy ves_insert on vessels for insert to authenticated with check (is_company_maint(company_id));
create policy ves_update on vessels for update to authenticated using (is_company_maint(company_id)) with check (is_company_maint(company_id));
create policy ves_delete on vessels for delete to authenticated using (is_company_maint(company_id));
create trigger ves_subscription before insert or update or delete on vessels for each row execute function reject_if_subscription_expired();

-- A vessel goes back to Operational only through release_vessel(), which checks the return-to-service rules.
create function vessels_guard() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'Operational' and coalesce(current_setting('veyora.release', true), '') <> '1' then
      raise exception 'Use "Return to service" to make % operational again.', old.name;
    end if;
    new.status_at := now();
    perform maint_log(new.company_id, new.id, 'vessel', new.id, new.name || ': ' || old.status || ' → ' || new.status || coalesce(' (' || new.status_reason || ')', ''));
    perform notify_many(new.company_id, maint_user_ids(new.company_id), 'vessel_status', to_char(now(), 'YYYYMMDDHH24MI'), 'vessel', new.id::text,
      new.name || ' is now ' || lower(new.status), coalesce(new.status_reason, ''));
  end if;
  return new;
end $$;
create trigger ves_guard before update on vessels for each row execute function vessels_guard();

create table vessel_components (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies(id) on delete cascade,
  vessel_id      uuid not null references vessels(id) on delete cascade,
  kind           text not null default 'Engine' check (kind in ('Engine', 'Gearbox', 'Generator', 'Propeller', 'Steering', 'Electrical', 'Cooling', 'Hull', 'Navigation', 'Safety equipment', 'Other')),
  name           text not null check (char_length(btrim(name)) between 1 and 80),
  make_model     text check (make_model is null or char_length(make_model) <= 80),
  serial         text check (serial is null or char_length(serial) <= 80),
  installed_on   date,
  warranty_until date,
  tracks_hours   boolean not null default false,
  hours          numeric(10, 1) not null default 0 check (hours >= 0),
  hours_at       timestamptz,
  status         text not null default 'In service' check (status in ('In service', 'Removed', 'Retired')),
  note           text check (note is null or char_length(note) <= 300),
  created_at     timestamptz not null default now()
);
create index on vessel_components (vessel_id);
alter table vessel_components enable row level security;
create policy vco_select on vessel_components for select to authenticated using (is_company_member(company_id));
create policy vco_insert on vessel_components for insert to authenticated with check (is_company_maint(company_id));
create policy vco_update on vessel_components for update to authenticated using (is_company_maint(company_id)) with check (is_company_maint(company_id));
create policy vco_delete on vessel_components for delete to authenticated using (is_company_maint(company_id));

create table hour_readings (
  id           bigint generated always as identity primary key,
  company_id   uuid not null references companies(id) on delete cascade,
  component_id uuid not null references vessel_components(id) on delete cascade,
  hours        numeric(10, 1) not null check (hours >= 0),
  note         text check (note is null or char_length(note) <= 200),
  read_by      uuid references auth.users(id) on delete set null,
  read_at      timestamptz not null default now()
);
create index on hour_readings (component_id, read_at desc);
alter table hour_readings enable row level security;
create policy hr_select on hour_readings for select to authenticated using (is_company_member(company_id));

-- Crew and engineers log running hours from the engine hour meter. A lower reading than before needs maintenance access (meter change).
create function log_hours(p_component uuid, p_hours numeric, p_note text default null) returns vessel_components
  language plpgsql security definer set search_path = public as
$$ declare c vessel_components;
begin
  select * into c from vessel_components where id = p_component;
  if not found then raise exception 'Component not found.'; end if;
  if not is_company_member(c.company_id) then raise exception 'Not a member of this company.'; end if;
  if p_hours is null or p_hours < 0 or p_hours > 1000000 then raise exception 'Enter the hour meter reading.'; end if;
  if p_hours < c.hours and not is_company_maint(c.company_id) then
    raise exception 'That is lower than the last reading (% h). Ask maintenance if the meter was changed.', c.hours;
  end if;
  insert into hour_readings (company_id, component_id, hours, note, read_by) values (c.company_id, c.id, round(p_hours, 1), nullif(btrim(p_note), ''), auth.uid());
  update vessel_components set hours = round(p_hours, 1), hours_at = now(), tracks_hours = true where id = c.id returning * into c;
  perform maint_log(c.company_id, c.vessel_id, 'hours', c.id, c.name || ': ' || c.hours || ' h');
  return c;
end $$;
revoke execute on function log_hours(uuid, numeric, text) from anon, public;
grant execute on function log_hours(uuid, numeric, text) to authenticated;

-- 4. Preventive maintenance: repeat by calendar days and/or running hours; whichever comes first.
create table maint_schedules (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  vessel_id       uuid not null references vessels(id) on delete cascade,
  component_id    uuid references vessel_components(id) on delete set null,
  title           text not null check (char_length(btrim(title)) between 2 and 120),
  job_type        text check (job_type is null or char_length(job_type) <= 60),
  interval_days   integer check (interval_days is null or interval_days between 1 and 3650),
  interval_hours  numeric(10, 1) check (interval_hours is null or interval_hours > 0),
  last_done_on    date,
  last_done_hours numeric(10, 1),
  tasks           text check (tasks is null or char_length(tasks) <= 2000),
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  check (interval_days is not null or interval_hours is not null)
);
create index on maint_schedules (vessel_id);
alter table maint_schedules enable row level security;
create policy msc_select on maint_schedules for select to authenticated using (is_company_member(company_id));
create policy msc_insert on maint_schedules for insert to authenticated with check (is_company_maint(company_id));
create policy msc_update on maint_schedules for update to authenticated using (is_company_maint(company_id)) with check (is_company_maint(company_id));
create policy msc_delete on maint_schedules for delete to authenticated using (is_company_maint(company_id));

-- Due status for one schedule: 'overdue', 'due', 'ok', with the next date / hours.
create function maint_schedule_state(p_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare s maint_schedules; c vessel_components; cfg jsonb; wd int; wh numeric; nd date; nh numeric; st text := 'ok';
begin
  select * into s from maint_schedules where id = p_id;
  if not found then return null; end if;
  select * into c from vessel_components where id = s.component_id;
  select coalesce(settings->'10_maintenance_reminder_rules', '{}'::jsonb) into cfg from companies where id = s.company_id;
  wd := coalesce(nullif(cfg->>'first', '')::int, 14); wh := coalesce(nullif(cfg->>'hoursWarn', '')::numeric, 25);
  if s.interval_days is not null then nd := coalesce(s.last_done_on, s.created_at::date) + s.interval_days; end if;
  if s.interval_hours is not null and c.id is not null then nh := coalesce(s.last_done_hours, 0) + s.interval_hours; end if;
  if (nd is not null and nd < current_date) or (nh is not null and c.hours >= nh) then st := 'overdue';
  elsif (nd is not null and nd <= current_date + wd) or (nh is not null and c.hours >= nh - wh) then st := 'due'; end if;
  return jsonb_build_object('state', st, 'next_on', nd, 'next_hours', nh, 'hours', c.hours);
end $$;
revoke execute on function maint_schedule_state(uuid) from anon, public;
grant execute on function maint_schedule_state(uuid) to authenticated;

-- 5. Work orders.
create table work_orders (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  number            integer not null,
  code              text not null,
  vessel_id         uuid not null references vessels(id) on delete cascade,
  component_id      uuid references vessel_components(id) on delete set null,
  schedule_id       uuid references maint_schedules(id) on delete set null,
  defect_id         uuid,
  title             text not null check (char_length(btrim(title)) between 3 and 120),
  problem           text check (problem is null or char_length(problem) <= 2000),
  work_required     text check (work_required is null or char_length(work_required) <= 2000),
  kind              text not null default 'Corrective' check (kind in ('Preventive', 'Corrective', 'Breakdown', 'Inspection')),
  category          text check (category is null or char_length(category) <= 60),
  priority          text not null default 'Medium' check (priority in ('Critical', 'High', 'Medium', 'Low')),
  status            text not null default 'Open' check (status in ('Draft', 'Open', 'Assigned', 'In progress', 'Awaiting parts', 'Awaiting approval', 'Completed', 'Closed')),
  assignee          uuid references auth.users(id) on delete set null,
  contractor        text check (contractor is null or char_length(contractor) <= 120),
  due_on            date,
  needs_approval    boolean not null default false,
  labour_hours      numeric(8, 2) check (labour_hours is null or labour_hours >= 0),
  parts_used        text check (parts_used is null or char_length(parts_used) <= 1000),
  cost_labour       numeric(12, 2) check (cost_labour is null or cost_labour >= 0),
  cost_parts        numeric(12, 2) check (cost_parts is null or cost_parts >= 0),
  cost_other        numeric(12, 2) check (cost_other is null or cost_other >= 0),
  work_done         text check (work_done is null or char_length(work_done) <= 2000),
  hours_at_done     numeric(10, 1),
  completed_by      uuid references auth.users(id) on delete set null,
  completed_at      timestamptz,
  approved_by       uuid references auth.users(id) on delete set null,
  approved_at       timestamptz,
  approval_note     text check (approval_note is null or char_length(approval_note) <= 300),
  closed_at         timestamptz,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, number)
);
create index on work_orders (company_id, status);
create index on work_orders (vessel_id);
alter table work_orders enable row level security;
create policy wo_select on work_orders for select to authenticated using (is_company_member(company_id));
create policy wo_update on work_orders for update to authenticated using (is_company_maint(company_id)) with check (is_company_maint(company_id));
create policy wo_delete on work_orders for delete to authenticated using (is_company_maint(company_id) and status in ('Draft', 'Open'));
create trigger wo_subscription before insert or update or delete on work_orders for each row execute function reject_if_subscription_expired();

-- Work order code from Maintenance Settings → Work Order Number Format (e.g. WO-2026-000001).
create function wo_code(p_company uuid, p_n int) returns text
  language sql stable as
$$ select coalesce(f->>'prefix', 'WO')
       || case when coalesce(f->>'sep', '-') = 'none' then '' else coalesce(f->>'sep', '-') end
       || case when coalesce((f->>'year')::boolean, true) then to_char(current_date, 'YYYY') || case when coalesce(f->>'sep', '-') = 'none' then '' else coalesce(f->>'sep', '-') end else '' end
       || lpad(p_n::text, greatest(1, least(10, coalesce(nullif(f->>'digits', '')::int, 6))), '0')
   from (select coalesce(settings->'10_work_order_number_format', '{}'::jsonb) f from companies where id = p_company) x $$;

create function create_work_order(p_company uuid, p_vessel uuid, p_row jsonb) returns work_orders
  language plpgsql security definer set search_path = public as
$$ declare n int; w work_orders; st jsonb; start int;
begin
  if not is_company_maint(p_company) then raise exception 'Only maintenance staff can create work orders.'; end if;
  if not exists (select 1 from vessels where id = p_vessel and company_id = p_company) then raise exception 'Choose a vessel.'; end if;
  perform pg_advisory_xact_lock(hashtext('wo_' || p_company::text));
  select settings into st from companies where id = p_company;
  start := coalesce(nullif(st->'10_work_order_number_format'->>'start', '')::int, 1);
  select greatest(coalesce(max(number), 0) + 1, start) into n from work_orders where company_id = p_company;
  insert into work_orders (company_id, number, code, vessel_id, component_id, schedule_id, defect_id, title, problem, work_required, kind, category, priority, status,
      assignee, contractor, due_on, needs_approval, created_by)
    values (p_company, n, wo_code(p_company, n), p_vessel, nullif(p_row->>'component_id', '')::uuid, nullif(p_row->>'schedule_id', '')::uuid, nullif(p_row->>'defect_id', '')::uuid,
      btrim(p_row->>'title'), nullif(btrim(p_row->>'problem'), ''), nullif(btrim(p_row->>'work_required'), ''), coalesce(nullif(p_row->>'kind', ''), 'Corrective'),
      nullif(p_row->>'category', ''), coalesce(nullif(p_row->>'priority', ''), 'Medium'),
      case when nullif(p_row->>'assignee', '') is not null or nullif(btrim(p_row->>'contractor'), '') is not null then 'Assigned' else coalesce(nullif(p_row->>'status', ''), 'Open') end,
      nullif(p_row->>'assignee', '')::uuid, nullif(btrim(p_row->>'contractor'), ''), nullif(p_row->>'due_on', '')::date,
      coalesce((p_row->>'needs_approval')::boolean, coalesce((st->'10_maintenance_approval_rules'->>'enabled')::boolean, true)), auth.uid())
    returning * into w;
  if w.defect_id is not null then update defects set work_order_id = w.id where id = w.defect_id and work_order_id is null; end if;
  perform maint_log(p_company, p_vessel, 'work_order', w.id, w.code || ' created: ' || w.title);
  if w.assignee is not null then perform notify_user(p_company, w.assignee, 'work_order', 'assigned', 'work_order', w.id::text, w.code || ' assigned to you', w.title); end if;
  return w;
end $$;
revoke execute on function create_work_order(uuid, uuid, jsonb) from anon, public;
grant execute on function create_work_order(uuid, uuid, jsonb) to authenticated;

create function work_orders_audit() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    if new.status = 'Closed' then new.closed_at := now(); end if;
    perform maint_log(new.company_id, new.vessel_id, 'work_order', new.id, new.code || ': ' || old.status || ' → ' || new.status);
  end if;
  if new.assignee is distinct from old.assignee and new.assignee is not null then
    perform notify_user(new.company_id, new.assignee, 'work_order', to_char(now(), 'YYYYMMDDHH24MI'), 'work_order', new.id::text, new.code || ' assigned to you', new.title);
  end if;
  return new;
end $$;
create trigger wo_audit before update on work_orders for each row execute function work_orders_audit();

-- The person a job is assigned to can move it along and record the work without full maintenance access.
create function wo_progress(p_id uuid, p_patch jsonb) returns work_orders
  language plpgsql security definer set search_path = public as
$$ declare w work_orders;
begin
  select * into w from work_orders where id = p_id;
  if not found then raise exception 'Work order not found.'; end if;
  if not (is_company_maint(w.company_id) or w.assignee = auth.uid()) then raise exception 'Only the person assigned or maintenance staff can update this job.'; end if;
  if w.status in ('Awaiting approval', 'Completed', 'Closed') then raise exception 'This job is %.', lower(w.status); end if;
  if p_patch ? 'status' and p_patch->>'status' not in ('Assigned', 'In progress', 'Awaiting parts') then raise exception 'Use Complete to finish the job.'; end if;
  update work_orders set
    status = coalesce(nullif(p_patch->>'status', ''), status),
    labour_hours = case when p_patch ? 'labour_hours' then nullif(p_patch->>'labour_hours', '')::numeric else labour_hours end,
    parts_used = case when p_patch ? 'parts_used' then nullif(btrim(p_patch->>'parts_used'), '') else parts_used end,
    work_done = case when p_patch ? 'work_done' then nullif(btrim(p_patch->>'work_done'), '') else work_done end,
    cost_labour = case when p_patch ? 'cost_labour' then nullif(p_patch->>'cost_labour', '')::numeric else cost_labour end,
    cost_parts = case when p_patch ? 'cost_parts' then nullif(p_patch->>'cost_parts', '')::numeric else cost_parts end,
    cost_other = case when p_patch ? 'cost_other' then nullif(p_patch->>'cost_other', '')::numeric else cost_other end
    where id = p_id returning * into w;
  return w;
end $$;
revoke execute on function wo_progress(uuid, jsonb) from anon, public;
grant execute on function wo_progress(uuid, jsonb) to authenticated;

-- Finishing a job: updates the preventive schedule (done on, at hours) and the linked defect.
create function wo_finish(p_id uuid) returns void
  language plpgsql security definer set search_path = public as
$$ declare w work_orders; h numeric;
begin
  select * into w from work_orders where id = p_id;
  if w.schedule_id is not null then
    select hours into h from vessel_components where id = (select component_id from maint_schedules where id = w.schedule_id);
    update maint_schedules set last_done_on = coalesce(w.completed_at::date, current_date), last_done_hours = coalesce(w.hours_at_done, h, last_done_hours) where id = w.schedule_id;
  end if;
  if w.defect_id is not null then
    update defects set status = case when status in ('Open', 'Temporary fix') then 'Repaired' else status end, final_repair = coalesce(final_repair, w.work_done), repaired_at = coalesce(repaired_at, now()) where id = w.defect_id;
  end if;
end $$;
revoke execute on function wo_finish(uuid) from anon, public, authenticated;

create function complete_work_order(p_id uuid, p_work_done text, p_hours numeric default null) returns work_orders
  language plpgsql security definer set search_path = public as
$$ declare w work_orders;
begin
  select * into w from work_orders where id = p_id;
  if not found then raise exception 'Work order not found.'; end if;
  if not (is_company_maint(w.company_id) or w.assignee = auth.uid()) then raise exception 'Only the person assigned or maintenance staff can complete this job.'; end if;
  if w.status in ('Awaiting approval', 'Completed', 'Closed') then raise exception 'This job is already %.', lower(w.status); end if;
  if coalesce(char_length(btrim(coalesce(p_work_done, w.work_done))), 0) < 2 then raise exception 'Say what work was done.'; end if;
  update work_orders set work_done = coalesce(nullif(btrim(p_work_done), ''), work_done), hours_at_done = coalesce(p_hours, hours_at_done),
    completed_by = auth.uid(), completed_at = now(), status = case when needs_approval then 'Awaiting approval' else 'Completed' end
    where id = p_id returning * into w;
  if w.status = 'Completed' then perform wo_finish(p_id);
  else perform notify_many(w.company_id, maint_user_ids(w.company_id), 'work_order', 'approve', 'work_order', w.id::text, w.code || ' needs approval', w.title); end if;
  return w;
end $$;
revoke execute on function complete_work_order(uuid, text, numeric) from anon, public;
grant execute on function complete_work_order(uuid, text, numeric) to authenticated;

create function approve_work_order(p_id uuid, p_ok boolean, p_note text default null) returns work_orders
  language plpgsql security definer set search_path = public as
$$ declare w work_orders; cfg jsonb;
begin
  select * into w from work_orders where id = p_id;
  if not found then raise exception 'Work order not found.'; end if;
  if not is_maint_approver(w.company_id) then raise exception 'Only maintenance approvers can approve work orders.'; end if;
  if w.status <> 'Awaiting approval' then raise exception 'This job is not waiting for approval.'; end if;
  select coalesce(settings->'10_maintenance_approval_rules', '{}'::jsonb) into cfg from companies where id = w.company_id;
  if not coalesce((cfg->>'self')::boolean, false) and w.completed_by = auth.uid() and not is_platform_admin() then
    raise exception 'Someone else must approve work you completed yourself.';
  end if;
  if coalesce((cfg->>'comment')::boolean, false) and coalesce(char_length(btrim(p_note)), 0) < 2 then raise exception 'A comment is required.'; end if;
  update work_orders set status = case when p_ok then 'Completed' else 'In progress' end, approved_by = case when p_ok then auth.uid() end,
    approved_at = case when p_ok then now() end, approval_note = nullif(btrim(p_note), '') where id = p_id returning * into w;
  if p_ok then perform wo_finish(p_id); end if;
  if w.completed_by is not null then
    perform notify_user(w.company_id, w.completed_by, 'work_order', 'decided' || to_char(now(), 'HH24MI'), 'work_order', w.id::text, w.code || case when p_ok then ' approved' else ' sent back' end, coalesce(nullif(btrim(p_note), ''), w.title));
  end if;
  return w;
end $$;
revoke execute on function approve_work_order(uuid, boolean, text) from anon, public;
grant execute on function approve_work_order(uuid, boolean, text) to authenticated;

-- 6. Breakdowns and defects. A defect that stops operation takes the vessel out of service (Return to Service Rules).
create table defects (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  number            integer not null,
  vessel_id         uuid not null references vessels(id) on delete cascade,
  component_id      uuid references vessel_components(id) on delete set null,
  title             text not null check (char_length(btrim(title)) between 3 and 120),
  symptoms          text check (symptoms is null or char_length(symptoms) <= 2000),
  fault_code        text check (fault_code is null or char_length(fault_code) <= 60),
  category          text check (category is null or char_length(category) <= 60),
  kind              text not null default 'Defect' check (kind in ('Defect', 'Breakdown')),
  severity          text not null default 'Minor' check (severity in ('Minor', 'Major', 'Critical')),
  safety            boolean not null default false,
  stops_operation   boolean not null default false,
  status            text not null default 'Open' check (status in ('Open', 'Temporary fix', 'Repaired', 'Closed')),
  temporary_measure text check (temporary_measure is null or char_length(temporary_measure) <= 1000),
  final_repair      text check (final_repair is null or char_length(final_repair) <= 2000),
  assigned_to       uuid references auth.users(id) on delete set null,
  work_order_id     uuid references work_orders(id) on delete set null,
  source            text not null default 'Report' check (source in ('Report', 'Inspection')),
  inspection_id     uuid,
  reported_by       uuid references auth.users(id) on delete set null,
  reported_at       timestamptz not null default now(),
  repaired_at       timestamptz,
  closed_at         timestamptz,
  unique (company_id, number)
);
create index on defects (company_id, status);
create index on defects (vessel_id);
alter table defects enable row level security;
create policy def_select on defects for select to authenticated using (is_company_member(company_id));
create policy def_update on defects for update to authenticated using (is_company_maint(company_id)) with check (is_company_maint(company_id));
create trigger def_subscription before insert or update or delete on defects for each row execute function reject_if_subscription_expired();
alter table work_orders add constraint work_orders_defect_fk foreign key (defect_id) references defects(id) on delete set null;

create function defects_audit() returns trigger
  language plpgsql security definer set search_path = public as
$$ declare v vessels; cfg jsonb;
begin
  select * into v from vessels where id = new.vessel_id;
  select coalesce(settings->'10_return_to_service_rules', '{}'::jsonb) into cfg from companies where id = new.company_id;
  if tg_op = 'INSERT' then
    perform maint_log(new.company_id, new.vessel_id, 'defect', new.id, 'D-' || new.number || ' ' || lower(new.kind) || ' reported (' || new.severity || '): ' || new.title);
    perform notify_many(new.company_id, maint_user_ids(new.company_id), 'defect', '', 'defect', new.id::text,
      new.severity || ' ' || lower(new.kind) || ' on ' || v.name, new.title);
  elsif new.status is distinct from old.status then
    if new.status = 'Closed' then new.closed_at := now(); end if;
    if new.status = 'Repaired' and new.repaired_at is null then new.repaired_at := now(); end if;
    perform maint_log(new.company_id, new.vessel_id, 'defect', new.id, 'D-' || new.number || ': ' || old.status || ' → ' || new.status);
  end if;
  -- Take the vessel out of service while a defect that stops operation is open.
  if new.stops_operation and new.status in ('Open', 'Temporary fix') and coalesce((cfg->>'autoOut')::boolean, true) and v.status <> 'Out of service' then
    update vessels set status = 'Out of service', status_reason = left('D-' || new.number || ': ' || new.title, 200) where id = v.id;
  end if;
  return new;
end $$;
create trigger def_audit_b before update on defects for each row execute function defects_audit();
create trigger def_audit_a after insert on defects for each row execute function defects_audit();

create function report_defect(p_company uuid, p_vessel uuid, p_row jsonb) returns defects
  language plpgsql security definer set search_path = public as
$$ declare d defects; n int; sev text;
begin
  if not is_company_member(p_company) then raise exception 'Not a member of this company.'; end if;
  if not exists (select 1 from vessels where id = p_vessel and company_id = p_company) then raise exception 'Choose a vessel.'; end if;
  if coalesce(char_length(btrim(p_row->>'title')), 0) < 3 then raise exception 'Say in a few words what is wrong.'; end if;
  perform pg_advisory_xact_lock(hashtext('def_' || p_company::text));
  select coalesce(max(number), 0) + 1 into n from defects where company_id = p_company;
  sev := coalesce(nullif(p_row->>'severity', ''), 'Minor');
  insert into defects (company_id, number, vessel_id, component_id, title, symptoms, fault_code, category, kind, severity, safety, stops_operation, temporary_measure, source, inspection_id, reported_by)
    values (p_company, n, p_vessel, nullif(p_row->>'component_id', '')::uuid, btrim(p_row->>'title'), nullif(btrim(p_row->>'symptoms'), ''), nullif(btrim(p_row->>'fault_code'), ''),
      nullif(p_row->>'category', ''), coalesce(nullif(p_row->>'kind', ''), 'Defect'), sev, coalesce((p_row->>'safety')::boolean, false),
      coalesce((p_row->>'stops_operation')::boolean, sev = 'Critical'), nullif(btrim(p_row->>'temporary_measure'), ''),
      coalesce(nullif(p_row->>'source', ''), 'Report'), nullif(p_row->>'inspection_id', '')::uuid, auth.uid())
    returning * into d;
  return d;
end $$;
revoke execute on function report_defect(uuid, uuid, jsonb) from anon, public;
grant execute on function report_defect(uuid, uuid, jsonb) to authenticated;

-- 7. Inspection checklists and submitted inspections. Failed items raise defects automatically.
create table maint_checklists (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 2 and 80),
  kind       text not null default 'Daily' check (kind in ('Daily', 'Weekly', 'Monthly', 'Pre-departure', 'Post-arrival', 'Periodic')),
  items      jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table maint_checklists enable row level security;
create policy mcl_select on maint_checklists for select to authenticated using (is_company_member(company_id));
create policy mcl_insert on maint_checklists for insert to authenticated with check (is_company_maint(company_id));
create policy mcl_update on maint_checklists for update to authenticated using (is_company_maint(company_id)) with check (is_company_maint(company_id));
create policy mcl_delete on maint_checklists for delete to authenticated using (is_company_maint(company_id));

create table maint_inspections (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  vessel_id    uuid not null references vessels(id) on delete cascade,
  checklist_id uuid references maint_checklists(id) on delete set null,
  name         text not null,
  kind         text not null,
  results      jsonb not null default '[]'::jsonb,
  failed       integer not null default 0,
  note         text check (note is null or char_length(note) <= 1000),
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz not null default now()
);
create index on maint_inspections (vessel_id, submitted_at desc);
alter table maint_inspections enable row level security;
create policy min_select on maint_inspections for select to authenticated using (is_company_member(company_id));

create function submit_inspection(p_company uuid, p_vessel uuid, p_checklist uuid, p_results jsonb, p_note text default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare cl maint_checklists; i maint_inspections; it jsonb; fails int := 0; made int := 0; d defects;
begin
  if not is_company_member(p_company) then raise exception 'Not a member of this company.'; end if;
  select * into cl from maint_checklists where id = p_checklist and company_id = p_company;
  if not found then raise exception 'Choose a checklist.'; end if;
  if not exists (select 1 from vessels where id = p_vessel and company_id = p_company) then raise exception 'Choose a vessel.'; end if;
  if jsonb_typeof(p_results) <> 'array' then raise exception 'Answer the checklist first.'; end if;
  if exists (select 1 from jsonb_array_elements(p_results) x where coalesce(x->>'result', '') not in ('ok', 'fail', 'na')) then raise exception 'Answer every item: OK, Fail or N/A.'; end if;
  select count(*) into fails from jsonb_array_elements(p_results) x where x->>'result' = 'fail';
  insert into maint_inspections (company_id, vessel_id, checklist_id, name, kind, results, failed, note, submitted_by)
    values (p_company, p_vessel, cl.id, cl.name, cl.kind, p_results, fails, nullif(btrim(p_note), ''), auth.uid()) returning * into i;
  for it in select * from jsonb_array_elements(p_results) x where x->>'result' = 'fail' loop
    d := report_defect(p_company, p_vessel, jsonb_build_object('title', left('Failed check: ' || coalesce(it->>'text', 'item'), 120),
      'symptoms', nullif(it->>'note', ''), 'category', it->>'area', 'severity', case when coalesce((it->>'critical')::boolean, false) then 'Critical' else 'Major' end,
      'stops_operation', coalesce((it->>'critical')::boolean, false), 'source', 'Inspection', 'inspection_id', i.id));
    made := made + 1;
  end loop;
  perform maint_log(p_company, p_vessel, 'inspection', i.id, cl.name || ' submitted: ' || case when fails = 0 then 'all passed' else fails || ' failed' end);
  return jsonb_build_object('id', i.id, 'failed', fails, 'defects', made);
end $$;
revoke execute on function submit_inspection(uuid, uuid, uuid, jsonb, text) from anon, public;
grant execute on function submit_inspection(uuid, uuid, uuid, jsonb, text) to authenticated;

-- 8. Vessel availability: set restricted / out of service, and return to service (with the rules).
create function set_vessel_status(p_vessel uuid, p_status text, p_reason text) returns vessels
  language plpgsql security definer set search_path = public as
$$ declare v vessels;
begin
  select * into v from vessels where id = p_vessel;
  if not found then raise exception 'Vessel not found.'; end if;
  if not is_company_maint(v.company_id) then raise exception 'Only maintenance staff can change vessel availability.'; end if;
  if p_status not in ('Restricted', 'Out of service') then raise exception 'Use Return to service to make a vessel operational.'; end if;
  if coalesce(char_length(btrim(p_reason)), 0) < 2 then raise exception 'Give a reason.'; end if;
  update vessels set status = p_status, status_reason = left(btrim(p_reason), 200) where id = p_vessel returning * into v;
  return v;
end $$;
revoke execute on function set_vessel_status(uuid, text, text) from anon, public;
grant execute on function set_vessel_status(uuid, text, text) to authenticated;

create function release_vessel(p_vessel uuid, p_note text) returns vessels
  language plpgsql security definer set search_path = public as
$$ declare v vessels; cfg jsonb; open_n int; last_fix timestamptz;
begin
  select * into v from vessels where id = p_vessel;
  if not found then raise exception 'Vessel not found.'; end if;
  select coalesce(settings->'10_return_to_service_rules', '{}'::jsonb) into cfg from companies where id = v.company_id;
  if coalesce((cfg->>'authorize')::boolean, true) then
    if not is_maint_approver(v.company_id) then raise exception 'Only maintenance approvers can return a vessel to service.'; end if;
  elsif not is_company_maint(v.company_id) then raise exception 'Only maintenance staff can return a vessel to service.'; end if;
  if v.status = 'Operational' then raise exception '% is already operational.', v.name; end if;
  select count(*) into open_n from defects where vessel_id = v.id and stops_operation and status in ('Open', 'Temporary fix');
  if open_n > 0 then raise exception '% still has % defect(s) that stop operation. Repair them first.', v.name, open_n; end if;
  if coalesce((cfg->>'requireInspection')::boolean, false) then
    select max(repaired_at) into last_fix from defects where vessel_id = v.id and stops_operation;
    if last_fix is not null and not exists (select 1 from maint_inspections where vessel_id = v.id and failed = 0 and submitted_at > last_fix) then
      raise exception 'Submit an inspection with no failed items after the repair before returning % to service.', v.name;
    end if;
  end if;
  if coalesce(char_length(btrim(p_note)), 0) < 2 then raise exception 'Say who inspected it and what was checked.'; end if;
  perform set_config('veyora.release', '1', true);
  update vessels set status = 'Operational', status_reason = null, released_by = auth.uid(), released_at = now() where id = p_vessel returning * into v;
  perform set_config('veyora.release', '', true);
  perform maint_log(v.company_id, v.id, 'release', v.id, v.name || ' returned to service: ' || left(btrim(p_note), 200));
  return v;
end $$;
revoke execute on function release_vessel(uuid, text) from anon, public;
grant execute on function release_vessel(uuid, text) to authenticated;

-- Crew cannot be assigned to a vessel that is out of service (Return to Service Rules → stop assignment).
create function vessel_assign_guard() returns trigger
  language plpgsql security definer set search_path = public as
$$ declare v vessels;
begin
  if new.assigned_vessel is not null and new.assigned_vessel is distinct from old.assigned_vessel then
    select * into v from vessels where company_id = new.company_id and (lower(code) = lower(btrim(new.assigned_vessel)) or lower(name) = lower(btrim(new.assigned_vessel))) limit 1;
    if v.id is not null and v.status = 'Out of service'
       and coalesce((select (settings->'10_return_to_service_rules'->>'blockAssign')::boolean from companies where id = new.company_id), true) then
      raise exception '% is out of service (%), so crew cannot be assigned to it.', v.name, coalesce(v.status_reason, 'maintenance');
    end if;
  end if;
  return new;
end $$;
create trigger cm_vessel_guard before update of assigned_vessel on company_members for each row execute function vessel_assign_guard();

-- 9. Files: service reports, invoices, photos and videos for vessels, work orders and defects.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('maintenance', 'maintenance', false, 52428800, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'video/mp4', 'video/quicktime',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;

create table maint_files (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  vessel_id  uuid references vessels(id) on delete cascade,
  ref_type   text not null check (ref_type in ('vessel', 'component', 'work_order', 'defect')),
  ref_id     uuid not null,
  path       text not null,
  name       text not null check (char_length(name) <= 200),
  mime       text,
  size       integer,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on maint_files (ref_type, ref_id);
alter table maint_files enable row level security;
create policy mfi_select on maint_files for select to authenticated using (is_company_member(company_id));
create policy mfi_insert on maint_files for insert to authenticated with check (is_company_member(company_id) and uploaded_by = auth.uid());
create policy mfi_delete on maint_files for delete to authenticated using (is_company_maint(company_id) or uploaded_by = auth.uid());

create function maint_file_company(p_name text) returns uuid
  language sql immutable as
$$ select case when split_part(p_name, '/', 1) ~ '^[0-9a-f-]{36}$' then split_part(p_name, '/', 1)::uuid end $$;
create policy maint_files_read on storage.objects for select to authenticated using (bucket_id = 'maintenance' and is_company_member(maint_file_company(name)));
create policy maint_files_insert on storage.objects for insert to authenticated with check (bucket_id = 'maintenance' and is_company_member(maint_file_company(name)));
create policy maint_files_delete on storage.objects for delete to authenticated using (bucket_id = 'maintenance' and is_company_maint(maint_file_company(name)));

-- 10. Reminders for due and overdue preventive maintenance (in-app, once per schedule per stage and day).
create function scan_maintenance(p_company uuid) returns integer
  language plpgsql security definer set search_path = public as
$$ declare s record; st jsonb; cfg jsonb; n int := 0; who uuid[];
begin
  if not is_company_member(p_company) then return 0; end if;
  select coalesce(settings->'10_maintenance_reminder_rules', '{}'::jsonb) into cfg from companies where id = p_company;
  who := maint_user_ids(p_company);
  for s in select ms.id, ms.title, v.name vname from maint_schedules ms join vessels v on v.id = ms.vessel_id where ms.company_id = p_company and ms.active loop
    st := maint_schedule_state(s.id);
    if st->>'state' = 'overdue' and coalesce((cfg->>'overdue')::boolean, true) then
      n := n + notify_many(p_company, who, 'maint_due', 'over' || to_char(current_date, 'YYYYMMDD'), 'schedule', s.id::text, 'Overdue: ' || s.title, s.vname);
    elsif st->>'state' = 'due' then
      n := n + notify_many(p_company, who, 'maint_due', left('due' || coalesce(st->>'next_on', st->>'next_hours', ''), 20), 'schedule', s.id::text, 'Maintenance due: ' || s.title, s.vname || coalesce(' · by ' || to_char((st->>'next_on')::date, 'DD Mon'), '') || coalesce(' · at ' || (st->>'next_hours') || ' h', ''));
    end if;
  end loop;
  return n;
end $$;
revoke execute on function scan_maintenance(uuid) from anon, public;
grant execute on function scan_maintenance(uuid) to authenticated;
