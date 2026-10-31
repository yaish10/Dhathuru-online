-- Payroll: pay details per person, payroll runs and payslips.
-- A run takes basic pay and allowances for the pay cycle (Payroll Configuration), adds overtime from approved
-- timesheets that is not paid yet, takes off unpaid leave (and, if switched on, unapproved absences from approved
-- timesheets) and pension. Approving a run marks that overtime as paid, so it is never paid twice.
-- Staff see their own payslip once the run is approved. Bank files and accounting export are not part of this.

-- 1. Pay details (HR and the person can read; HR changes them through set_member_pay()).
create table member_pay (
  company_id  uuid not null,
  user_id     uuid not null,
  basic       numeric(12, 2) not null default 0 check (basic >= 0),
  allowances  jsonb not null default '[]'::jsonb check (jsonb_typeof(allowances) = 'array'),
  pension     boolean not null default true,
  pay_method  text not null default 'Bank transfer' check (pay_method in ('Bank transfer', 'Cash', 'Cheque')),
  updated_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (company_id, user_id),
  foreign key (company_id, user_id) references company_members (company_id, user_id) on delete cascade
);
alter table member_pay enable row level security;
create policy mpay_select on member_pay for select to authenticated
  using (is_company_hr(company_id) or user_id = auth.uid());
create trigger mpay_subscription before insert or update or delete on member_pay
  for each row execute function reject_if_subscription_expired();

create function set_member_pay(p_company uuid, p_user uuid, p_basic numeric, p_allowances jsonb, p_pension boolean, p_method text) returns member_pay
  language plpgsql security definer set search_path = public as
$$ declare a jsonb; clean jsonb := '[]'::jsonb; rec member_pay; old_basic numeric;
begin
  if not is_company_hr(p_company) then raise exception 'Only HR, owners and admins can change pay details.'; end if;
  if not exists (select 1 from company_members where company_id = p_company and user_id = p_user) then raise exception 'That person is not in this company.'; end if;
  if p_basic is null or p_basic < 0 or p_basic > 10000000 then raise exception 'Enter a basic salary of 0 or more.'; end if;
  if jsonb_typeof(coalesce(p_allowances, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_allowances, '[]'::jsonb)) > 20 then raise exception 'Up to 20 allowances.'; end if;
  for a in select * from jsonb_array_elements(coalesce(p_allowances, '[]'::jsonb)) loop
    if coalesce(char_length(btrim(a->>'name')), 0) not between 1 and 60 then raise exception 'Give each allowance a name.'; end if;
    if coalesce(nullif(a->>'amount', '')::numeric, -1) < 0 then raise exception 'Allowance amounts must be 0 or more.'; end if;
    clean := clean || jsonb_build_object('name', btrim(a->>'name'), 'amount', round((a->>'amount')::numeric, 2));
  end loop;
  select basic into old_basic from member_pay where company_id = p_company and user_id = p_user;
  insert into member_pay (company_id, user_id, basic, allowances, pension, pay_method, updated_by, updated_at)
    values (p_company, p_user, round(p_basic, 2), clean, coalesce(p_pension, true), coalesce(p_method, 'Bank transfer'), auth.uid(), now())
    on conflict (company_id, user_id) do update set basic = excluded.basic, allowances = excluded.allowances, pension = excluded.pension,
      pay_method = excluded.pay_method, updated_by = excluded.updated_by, updated_at = now()
    returning * into rec;
  if old_basic is distinct from rec.basic then
    perform log_employee_event(p_company, p_user, 'pay', 'Basic salary set to ' || to_char(rec.basic, 'FM999G999G990D00'));
  end if;
  return rec;
end $$;
revoke execute on function set_member_pay(uuid, uuid, numeric, jsonb, boolean, text) from anon, public;
grant execute on function set_member_pay(uuid, uuid, numeric, jsonb, boolean, text) to authenticated;

-- 2. Who approves payroll: the people named for "Payroll" in Approvers & Responsibilities; if nobody is named, HR, owners and admins.
create function payroll_named(p_company uuid) returns uuid[]
  language sql stable security definer set search_path = public as
$$ select coalesce(array_agg(distinct v::uuid), '{}') from companies c,
     lateral (select coalesce(c.settings->'8_approvers_and_responsibilities'->'duties'->'payroll', '{}'::jsonb) d) x,
     lateral (select jsonb_array_elements_text(coalesce(x.d->'people', '[]'::jsonb)) v union select x.d->>'backup' where x.d->>'backup' is not null) y
   where c.id = p_company and exists (select 1 from company_members m where m.company_id = p_company and m.user_id = y.v::uuid and m.active) $$;
revoke execute on function payroll_named(uuid) from anon, public;

create function is_payroll_approver(p_company uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select is_platform_admin()
     or exists (select 1 from company_members where company_id = p_company and user_id = auth.uid() and active and role = 'owner')
     or auth.uid() = any(payroll_named(p_company))
     or (cardinality(payroll_named(p_company)) = 0 and is_company_hr(p_company)) $$;
revoke execute on function is_payroll_approver(uuid) from anon, public;
grant execute on function is_payroll_approver(uuid) to authenticated;

create function can_see_payroll(p_company uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select is_company_hr(p_company) or is_payroll_approver(p_company) $$;
revoke execute on function can_see_payroll(uuid) from anon, public;
grant execute on function can_see_payroll(uuid) to authenticated;

-- 3. Runs and lines.
create table payroll_runs (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies(id) on delete cascade,
  period_start   date not null,
  period_end     date not null check (period_end >= period_start and period_end - period_start <= 40),
  pay_date       date,
  status         text not null default 'Draft' check (status in ('Draft', 'Approved', 'Paid')),
  currency       text not null default 'MVR',
  staff_count    integer not null default 0,
  gross          numeric(14, 2) not null default 0,
  deductions     numeric(14, 2) not null default 0,
  net            numeric(14, 2) not null default 0,
  overtime       numeric(14, 2) not null default 0,
  employer_cost  numeric(14, 2) not null default 0,
  note           text check (note is null or char_length(note) <= 200),
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  calculated_at  timestamptz,
  approved_by    uuid references auth.users(id) on delete set null,
  approved_at    timestamptz,
  paid_by        uuid references auth.users(id) on delete set null,
  paid_at        timestamptz
);
create index on payroll_runs (company_id, period_start desc);

create table payroll_lines (
  run_id            uuid not null references payroll_runs(id) on delete cascade,
  company_id        uuid not null,
  user_id           uuid not null,
  basic             numeric(12, 2) not null default 0,
  allowances        numeric(12, 2) not null default 0,
  allowance_items   jsonb not null default '[]'::jsonb,
  overtime_min      integer not null default 0,
  holiday_min       integer not null default 0,
  overtime_amount   numeric(12, 2) not null default 0,
  unpaid_days       integer not null default 0,
  unpaid_amount     numeric(12, 2) not null default 0,
  absent_days       integer not null default 0,
  absent_amount     numeric(12, 2) not null default 0,
  gross             numeric(12, 2) not null default 0,
  pension_employee  numeric(12, 2) not null default 0,
  pension_employer  numeric(12, 2) not null default 0,
  net               numeric(12, 2) not null default 0,
  hourly_rate       numeric(12, 4) not null default 0,
  days_paid         integer not null default 0,
  days_in_period    integer not null default 0,
  pay_method        text,
  weeks             jsonb not null default '[]'::jsonb,
  primary key (run_id, user_id),
  foreign key (company_id, user_id) references company_members (company_id, user_id) on delete cascade
);
create index on payroll_lines (company_id, user_id);

create function my_payslip_run(p_run uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select exists (select 1 from payroll_runs r join payroll_lines l on l.run_id = r.id
     where r.id = p_run and l.user_id = auth.uid() and r.status in ('Approved', 'Paid')) $$;
revoke execute on function my_payslip_run(uuid) from anon, public;
grant execute on function my_payslip_run(uuid) to authenticated;

alter table payroll_runs enable row level security;
create policy prun_select on payroll_runs for select to authenticated
  using (can_see_payroll(company_id) or my_payslip_run(id));
alter table payroll_lines enable row level security;
create policy pline_select on payroll_lines for select to authenticated
  using (can_see_payroll(company_id) or (user_id = auth.uid() and my_payslip_run(run_id)));
create trigger prun_subscription before insert or update or delete on payroll_runs
  for each row execute function reject_if_subscription_expired();
create trigger pline_subscription before insert or update or delete on payroll_lines
  for each row execute function reject_if_subscription_expired();

alter table timesheet_weeks add column paid_run uuid references payroll_runs(id) on delete set null;

-- 4. Calculation.
create function payroll_cfg(p_company uuid) returns jsonb
  language sql stable as
$$ select coalesce(settings->'8_payroll_configuration', '{}'::jsonb) from companies where id = p_company $$;

create function payroll_weekend(p_company uuid) returns int[]
  language sql stable as
$$ select case coalesce((select settings->'8_duty_roster'->>'weekend' from companies where id = p_company), 'Friday & Saturday')
     when 'Saturday & Sunday' then array[6, 0] when 'Friday only' then array[5] when 'None' then array[]::int[] else array[5, 6] end $$;

create function calc_payroll_run(p_run uuid) returns void
  language plpgsql security definer set search_path = public as
$$ declare
  r payroll_runs; st jsonb; cfg jsonb; ndp int; cyc text; f numeric; hours numeric; pe numeric; pr numeric; absence boolean;
  wk int[]; wdays int; unpaid text[]; m record; mp member_pay; a_from date; a_to date; days_all int; days_emp int; pro numeric;
  basic numeric; allow numeric; items jsonb; hourly numeric; daily numeric; ot_min int; hol_min int; ot_amt numeric; weeks jsonb;
  up_days int; ab_days int; gross numeric; p_emp numeric; p_er numeric;
begin
  select * into r from payroll_runs where id = p_run;
  if not found then raise exception 'Payroll run not found.'; end if;
  if not is_company_hr(r.company_id) then raise exception 'Only HR, owners and admins can prepare payroll.'; end if;
  if r.status <> 'Draft' then raise exception 'Only a draft run can be recalculated. Reopen it first.'; end if;
  select settings into st from companies where id = r.company_id;
  cfg := coalesce(st->'8_payroll_configuration', '{}'::jsonb);
  ndp := least(4, greatest(0, coalesce(nullif(st->'9_base_currency'->>'decimals', '')::int, 2)));
  cyc := coalesce(cfg->>'cycle', 'Monthly');
  f := case cyc when 'Weekly' then 12.0 / 52 when 'Fortnightly' then 12.0 / 26 else 1 end;
  hours := greatest(1, coalesce(nullif(cfg->>'hours', '')::numeric, 208));
  pe := coalesce(nullif(cfg->>'pensionEmployee', '')::numeric, 7);
  pr := coalesce(nullif(cfg->>'pension', '')::numeric, 7);
  absence := coalesce((cfg->>'absence')::boolean, false);
  wk := payroll_weekend(r.company_id);
  wdays := greatest(1, 7 - cardinality(wk));
  unpaid := case when jsonb_typeof(st->'8_leave_types_and_policies') = 'array'
    then array(select x->>'name' from jsonb_array_elements(st->'8_leave_types_and_policies') x where jsonb_typeof(x) = 'object' and (x->>'paid')::boolean is false)
    else array['Unpaid leave'] end;
  delete from payroll_lines where run_id = p_run;
  days_all := r.period_end - r.period_start + 1;
  for m in select cm.user_id, cm.start_date, cm.end_date, cm.employment_status from company_members cm
      where cm.company_id = r.company_id
        and (cm.start_date is null or cm.start_date <= r.period_end)
        and (cm.employment_status is distinct from 'Former' or (cm.end_date is not null and cm.end_date >= r.period_start)) loop
    mp := null;
    select * into mp from member_pay where company_id = r.company_id and user_id = m.user_id;
    a_from := greatest(r.period_start, coalesce(m.start_date, r.period_start));
    a_to := least(r.period_end, coalesce(m.end_date, r.period_end));
    if a_to < a_from then continue; end if;
    days_emp := a_to - a_from + 1;
    pro := days_emp::numeric / days_all;
    basic := round(coalesce(mp.basic, 0) * f * pro, ndp);
    select coalesce(jsonb_agg(jsonb_build_object('name', x->>'name', 'amount', round((x->>'amount')::numeric * f * pro, ndp))), '[]'::jsonb),
           coalesce(sum(round((x->>'amount')::numeric * f * pro, ndp)), 0)
      into items, allow from jsonb_array_elements(coalesce(mp.allowances, '[]'::jsonb)) x;
    hourly := coalesce(mp.basic, 0) / hours;
    daily := coalesce(mp.basic, 0) * 12 / (52 * wdays);
    -- overtime: approved weeks not paid yet that ended by the end of this period (late approvals carry forward)
    select coalesce(sum(t.overtime_min), 0), coalesce(sum(t.holiday_min), 0),
           coalesce(sum(t.overtime_min / 60.0 * hourly * t.overtime_rate + t.holiday_min / 60.0 * hourly * t.holiday_rate), 0),
           coalesce(jsonb_agg(t.week_start order by t.week_start), '[]'::jsonb)
      into ot_min, hol_min, ot_amt, weeks
      from timesheet_weeks t where t.company_id = r.company_id and t.user_id = m.user_id
        and not t.overtime_paid and t.paid_run is null and t.week_start + 6 <= r.period_end
        and t.overtime_min + t.holiday_min > 0;
    ot_amt := round(ot_amt, ndp);
    select count(distinct g::date) into up_days
      from leave_requests l, generate_series(greatest(l.start_date, a_from), least(l.end_date, a_to), interval '1 day') g
      where l.company_id = r.company_id and l.user_id = m.user_id and l.status = 'Approved' and l.leave_type = any(unpaid)
        and l.start_date <= a_to and l.end_date >= a_from and not (extract(dow from g)::int = any(wk));
    ab_days := 0;
    if absence then
      select count(*) into ab_days from timesheet_weeks t, jsonb_array_elements(t.days) d
        where t.company_id = r.company_id and t.user_id = m.user_id and (d->>'absent')::boolean
          and (d->>'day')::date between a_from and a_to;
    end if;
    if mp.user_id is null and ot_min + hol_min = 0 then continue; end if;
    gross := greatest(0, basic + allow + ot_amt - round(up_days * daily, ndp) - round(ab_days * daily, ndp));
    p_emp := case when coalesce(mp.pension, false) then round(basic * pe / 100, ndp) else 0 end;
    p_er := case when coalesce(mp.pension, false) then round(basic * pr / 100, ndp) else 0 end;
    insert into payroll_lines (run_id, company_id, user_id, basic, allowances, allowance_items, overtime_min, holiday_min, overtime_amount,
        unpaid_days, unpaid_amount, absent_days, absent_amount, gross, pension_employee, pension_employer, net, hourly_rate,
        days_paid, days_in_period, pay_method, weeks)
      values (p_run, r.company_id, m.user_id, basic, allow, items, ot_min, hol_min, ot_amt,
        up_days, round(up_days * daily, ndp), ab_days, round(ab_days * daily, ndp), gross, p_emp, p_er, greatest(0, gross - p_emp), round(hourly, 4),
        days_emp, days_all, coalesce(mp.pay_method, 'Bank transfer'), weeks);
  end loop;
  update payroll_runs set
    currency = coalesce(st->'9_base_currency'->>'base', 'MVR'),
    staff_count = (select count(*) from payroll_lines where run_id = p_run),
    gross = (select coalesce(sum(l.gross), 0) from payroll_lines l where l.run_id = p_run),
    deductions = (select coalesce(sum(l.pension_employee), 0) from payroll_lines l where l.run_id = p_run),
    net = (select coalesce(sum(l.net), 0) from payroll_lines l where l.run_id = p_run),
    overtime = (select coalesce(sum(l.overtime_amount), 0) from payroll_lines l where l.run_id = p_run),
    employer_cost = (select coalesce(sum(l.gross + l.pension_employer), 0) from payroll_lines l where l.run_id = p_run),
    calculated_at = now()
    where id = p_run;
end $$;
revoke execute on function calc_payroll_run(uuid) from anon, public;
grant execute on function calc_payroll_run(uuid) to authenticated;

create function create_payroll_run(p_company uuid, p_start date, p_end date, p_pay_date date default null, p_note text default null) returns uuid
  language plpgsql security definer set search_path = public as
$$ declare rid uuid;
begin
  if not is_company_hr(p_company) then raise exception 'Only HR, owners and admins can prepare payroll.'; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'Choose the pay period (start and end).'; end if;
  if p_end - p_start > 40 then raise exception 'A pay period can be at most about a month.'; end if;
  if exists (select 1 from payroll_runs where company_id = p_company and period_start <= p_end and period_end >= p_start) then
    raise exception 'There is already a payroll run for part of these dates.';
  end if;
  insert into payroll_runs (company_id, period_start, period_end, pay_date, note, created_by)
    values (p_company, p_start, p_end, p_pay_date, nullif(left(btrim(p_note), 200), ''), auth.uid()) returning id into rid;
  perform calc_payroll_run(rid);
  insert into company_audit (company_id, actor, action, detail) values (p_company, auth.uid(), 'payroll_created', p_start::text || ' to ' || p_end::text);
  return rid;
end $$;
revoke execute on function create_payroll_run(uuid, date, date, date, text) from anon, public;
grant execute on function create_payroll_run(uuid, date, date, date, text) to authenticated;

create function delete_payroll_run(p_run uuid) returns void
  language plpgsql security definer set search_path = public as
$$ declare r payroll_runs;
begin
  select * into r from payroll_runs where id = p_run;
  if not found then raise exception 'Payroll run not found.'; end if;
  if not is_company_hr(r.company_id) then raise exception 'Only HR, owners and admins can delete payroll runs.'; end if;
  if r.status <> 'Draft' then raise exception 'Only a draft run can be deleted.'; end if;
  delete from payroll_runs where id = p_run;
  insert into company_audit (company_id, actor, action, detail) values (r.company_id, auth.uid(), 'payroll_deleted', r.period_start::text);
end $$;
revoke execute on function delete_payroll_run(uuid) from anon, public;
grant execute on function delete_payroll_run(uuid) to authenticated;

-- 5. Approve, pay, reopen.
create function approve_payroll_run(p_run uuid) returns void
  language plpgsql security definer set search_path = public as
$$ declare r payroll_runs; need boolean; l record;
begin
  select * into r from payroll_runs where id = p_run;
  if not found then raise exception 'Payroll run not found.'; end if;
  if not is_payroll_approver(r.company_id) then raise exception 'Only the people named for Payroll in Approvers & Responsibilities can approve payroll.'; end if;
  if r.status <> 'Draft' then raise exception 'This run is already approved.'; end if;
  need := coalesce((payroll_cfg(r.company_id)->>'approval')::boolean, true);
  if need and r.created_by = auth.uid() and not (is_platform_admin() or exists (select 1 from company_members where company_id = r.company_id and user_id = auth.uid() and role = 'owner')) then
    raise exception 'Payroll needs a second person: someone other than whoever prepared it must approve it.';
  end if;
  if is_company_hr(r.company_id) then perform calc_payroll_run(p_run); end if;
  for l in select user_id, weeks from payroll_lines where run_id = p_run loop
    update timesheet_weeks set overtime_paid = true, paid_run = p_run
      where company_id = r.company_id and user_id = l.user_id and week_start in (select (jsonb_array_elements_text(l.weeks))::date)
        and not overtime_paid;
  end loop;
  update payroll_runs set status = 'Approved', approved_by = auth.uid(), approved_at = now() where id = p_run;
  perform notify_many(r.company_id, array(select user_id from payroll_lines where run_id = p_run), 'payslip', '', 'payroll_run', p_run::text,
    'Your payslip is ready', 'Pay for ' || to_char(r.period_start, 'DD Mon') || ' – ' || to_char(r.period_end, 'DD Mon YYYY'));
  insert into company_audit (company_id, actor, action, detail) values (r.company_id, auth.uid(), 'payroll_approved', r.period_start::text);
end $$;
revoke execute on function approve_payroll_run(uuid) from anon, public;
grant execute on function approve_payroll_run(uuid) to authenticated;

create function mark_payroll_paid(p_run uuid) returns void
  language plpgsql security definer set search_path = public as
$$ declare r payroll_runs;
begin
  select * into r from payroll_runs where id = p_run;
  if not found then raise exception 'Payroll run not found.'; end if;
  if not (is_company_hr(r.company_id) or is_payroll_approver(r.company_id)) then raise exception 'Only HR or payroll approvers can mark payroll as paid.'; end if;
  if r.status <> 'Approved' then raise exception 'Approve the run before marking it paid.'; end if;
  update payroll_runs set status = 'Paid', paid_by = auth.uid(), paid_at = now() where id = p_run;
  insert into company_audit (company_id, actor, action, detail) values (r.company_id, auth.uid(), 'payroll_paid', r.period_start::text);
end $$;
revoke execute on function mark_payroll_paid(uuid) from anon, public;
grant execute on function mark_payroll_paid(uuid) to authenticated;

create function reopen_payroll_run(p_run uuid, p_reason text) returns void
  language plpgsql security definer set search_path = public as
$$ declare r payroll_runs;
begin
  select * into r from payroll_runs where id = p_run;
  if not found then raise exception 'Payroll run not found.'; end if;
  if not is_payroll_approver(r.company_id) then raise exception 'Only payroll approvers can reopen payroll.'; end if;
  if r.status = 'Paid' then raise exception 'This run is paid, so it cannot be reopened.'; end if;
  if r.status <> 'Approved' then raise exception 'This run is still a draft.'; end if;
  if coalesce(char_length(btrim(p_reason)), 0) < 2 then raise exception 'Give a reason for reopening.'; end if;
  update timesheet_weeks set overtime_paid = false, paid_run = null where paid_run = p_run;
  update payroll_runs set status = 'Draft', approved_by = null, approved_at = null,
    note = left(coalesce(note || ' · ', '') || 'Reopened: ' || btrim(p_reason), 200) where id = p_run;
  insert into company_audit (company_id, actor, action, detail) values (r.company_id, auth.uid(), 'payroll_reopened', r.period_start::text);
end $$;
revoke execute on function reopen_payroll_run(uuid, text) from anon, public;
grant execute on function reopen_payroll_run(uuid, text) to authenticated;
