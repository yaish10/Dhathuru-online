-- Allowance Rules: allowances worked out by rules (HR Settings key 8_allowance_rules, edited on Payroll & Overtime → Allowance rules).
-- A rule says who it is for, when it is paid (conditions), how much (flat or tiered) and how it is counted:
--   { name, active, basis, amount, shifts, prorate,
--     who: { groups[], titles[], depts[], types[] }          empty list = everyone
--     match: "all" | "any", conditions: [{ metric, op, value }]
--     tiers: { metric, steps: [{ from, amount }] }            amount = the step with the highest "from" reached
--     per_absence, min, cap }
-- basis: Fixed per month | % of basic | Per day worked | Per shift worked | Per hour worked | Per overtime hour
-- metrics: days_worked, absences, late_days, missed_punches, hours_worked, overtime_hours, service_years, leave_days, basic, shifts_worked
-- Days, shifts, hours, absences and late days are counted the same way as Timesheets; overtime hours from approved timesheets in the run.
-- Personal allowances on Pay details still apply as well.

-- 1. What happened for one person in the period.
create function allowance_metrics(p_company uuid, p_user uuid, p_from date, p_to date, p_ot_min int) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare grp text; ttl text; dept text; etype text; start_d date; wk int[]; dys jsonb;
begin
  select coalesce(jt.crew_group, case when jt.title ~* 'captain|master|skipper' then 'Captain' when jt.title ~* 'engineer|mechanic|oiler' then 'Engineering'
           when jt.title ~* 'deck|mate|officer|bosun|sailor|crew' then 'Deck' else 'Shore' end, 'Shore'),
         coalesce(jt.title, cm.role_label, initcap(cm.role::text)), d.name, cm.employment_type, cm.start_date
    into grp, ttl, dept, etype, start_d
    from company_members cm left join job_titles jt on jt.id = cm.job_title_id left join departments d on d.id = cm.department_id
    where cm.company_id = p_company and cm.user_id = p_user;
  wk := payroll_weekend(p_company);
  -- the same day-by-day view as Timesheets (0026), so rules and timesheets always agree
  dys := timesheet_days(p_company, p_user, p_from, p_to);
  return jsonb_build_object(
    'days_worked', (select count(*) from jsonb_array_elements(dys) x where x->>'clock_in' is not null),
    'absences', (select count(*) from jsonb_array_elements(dys) x where (x->>'absent')::boolean),
    'late_days', (select count(*) from jsonb_array_elements(dys) x where (x->>'late')::boolean),
    'missed_punches', (select count(*) from jsonb_array_elements(dys) x where (x->>'missed')::boolean),
    'hours_worked', (select round(coalesce(sum((x->>'actual')::int), 0) / 60.0, 2) from jsonb_array_elements(dys) x),
    'overtime_hours', round(coalesce(p_ot_min, 0) / 60.0, 2),
    'service_years', case when start_d is null then 0 else round(greatest(0, p_to - start_d) / 365.25, 2) end,
    'leave_days', (select count(distinct g::date) from leave_requests l, generate_series(greatest(l.start_date, p_from), least(l.end_date, p_to), interval '1 day') g
                    where l.company_id = p_company and l.user_id = p_user and l.status = 'Approved' and l.start_date <= p_to and l.end_date >= p_from
                      and not (extract(dow from g)::int = any(wk))),
    'shifts', coalesce((select jsonb_object_agg(code, n) from (select upper(x->>'shift') code, count(*) n from jsonb_array_elements(dys) x
                    where x->>'clock_in' is not null and coalesce(x->>'shift', '') <> '' group by 1) q), '{}'::jsonb),
    'group', grp, 'title', ttl, 'dept', dept, 'type', etype);
end $$;
revoke execute on function allowance_metrics(uuid, uuid, date, date, int) from anon, public, authenticated;

create function allowance_num(v text) returns numeric
  language plpgsql immutable as
$$ begin return coalesce(nullif(btrim(v), '')::numeric, 0); exception when others then return 0; end $$;

create function allowance_fmt(v numeric) returns text
  language sql immutable as
$$ select rtrim(to_char(coalesce(v, 0), 'FM999999990.99'), '.') $$;

create function allowance_metric_label(k text) returns text
  language sql immutable as
$$ select case k when 'days_worked' then 'days worked' when 'absences' then 'unapproved absences' when 'late_days' then 'late days'
     when 'missed_punches' then 'missed punches' when 'hours_worked' then 'hours worked' when 'overtime_hours' then 'overtime hours'
     when 'service_years' then 'years of service' when 'leave_days' then 'leave days' when 'basic' then 'basic salary' when 'shifts_worked' then 'shifts worked' else k end $$;

-- 2. Apply the rules to one person. Returns payslip items: { name, amount, rule, detail }.
create function allowance_apply(p_rules jsonb, p_m jsonb, p_basic numeric, p_f numeric, p_pro numeric, p_ndp int) returns jsonb
  language plpgsql stable as
$$ declare
  ru jsonb; c jsonb; st jsonb; items jsonb := '[]'::jsonb; codes text[]; shifts_n numeric; mets jsonb; ok boolean; any_ok boolean; one boolean;
  v numeric; tv numeric; rate numeric; amt numeric; why text[]; fail text; cut numeric; lo numeric; hi numeric; mode text; who jsonb;
begin
  for ru in select * from jsonb_array_elements(case when jsonb_typeof(p_rules) = 'array' then p_rules else '[]'::jsonb end) loop
    if jsonb_typeof(ru) <> 'object' or coalesce(btrim(ru->>'name'), '') = '' or coalesce((ru->>'active')::boolean, true) is false then continue; end if;
    who := coalesce(ru->'who', '{}'::jsonb);
    if jsonb_array_length(coalesce(who->'groups', '[]')) > 0 and not (who->'groups') ? (p_m->>'group') then continue; end if;
    if jsonb_array_length(coalesce(who->'titles', '[]')) > 0 and not (who->'titles') ? coalesce(p_m->>'title', '') then continue; end if;
    if jsonb_array_length(coalesce(who->'depts', '[]')) > 0 and not (who->'depts') ? coalesce(p_m->>'dept', '') then continue; end if;
    if jsonb_array_length(coalesce(who->'types', '[]')) > 0 and not (who->'types') ? coalesce(p_m->>'type', '') then continue; end if;
    codes := array(select upper(btrim(x)) from unnest(string_to_array(coalesce(ru->>'shifts', ''), ',')) x where btrim(x) <> '');
    select coalesce(sum(value::numeric), 0) into shifts_n from jsonb_each_text(coalesce(p_m->'shifts', '{}'::jsonb)) where cardinality(codes) = 0 or key = any(codes);
    mets := p_m || jsonb_build_object('basic', p_basic, 'shifts_worked', shifts_n);
    why := '{}'; fail := null;
    -- conditions
    mode := coalesce(ru->>'match', 'all'); any_ok := false; ok := true;
    for c in select * from jsonb_array_elements(coalesce(ru->'conditions', '[]'::jsonb)) loop
      v := allowance_num(mets->>(c->>'metric')); tv := allowance_num(c->>'value');
      one := case c->>'op' when '>=' then v >= tv when '>' then v > tv when '<=' then v <= tv when '<' then v < tv when '=' then v = tv when '!=' then v <> tv else true end;
      if one then any_ok := true;
      elsif fail is null then fail := allowance_metric_label(c->>'metric') || ' ' || allowance_fmt(v) || ', needs ' || case c->>'op' when '>=' then 'at least' when '>' then 'more than' when '<=' then 'at most' when '<' then 'less than' when '=' then 'exactly' when '!=' then 'anything but' else c->>'op' end || ' ' || allowance_fmt(tv); end if;
      ok := ok and one;
    end loop;
    if jsonb_array_length(coalesce(ru->'conditions', '[]'::jsonb)) > 0 and ((mode = 'any' and not any_ok) or (mode <> 'any' and not ok)) then
      items := items || jsonb_build_object('name', btrim(ru->>'name'), 'amount', 0, 'rule', true, 'detail', 'not paid: ' || fail);
      continue;
    end if;
    -- rate: flat amount, or the tier reached
    rate := allowance_num(ru->>'amount');
    if jsonb_typeof(ru->'tiers') = 'object' and jsonb_array_length(coalesce(ru->'tiers'->'steps', '[]')) > 0 then
      v := allowance_num(mets->>(ru->'tiers'->>'metric')); rate := 0; st := null;
      select x into st from jsonb_array_elements(ru->'tiers'->'steps') x where allowance_num(x->>'from') <= v order by allowance_num(x->>'from') desc limit 1;
      if st is not null then rate := allowance_num(st->>'amount'); end if;
      why := why || (allowance_metric_label(ru->'tiers'->>'metric') || ' ' || allowance_fmt(v) || ' → ' || allowance_fmt(rate));
    end if;
    case coalesce(ru->>'basis', 'Fixed per month')
      when '% of basic' then amt := p_basic * rate / 100; why := why || (allowance_fmt(rate) || '% of basic');
      when 'Per day worked' then amt := rate * allowance_num(mets->>'days_worked'); why := why || ((mets->>'days_worked') || ' days × ' || allowance_fmt(rate));
      when 'Per shift worked' then amt := rate * shifts_n; why := why || (shifts_n || ' ' || coalesce(nullif(array_to_string(codes, '/'), ''), 'all') || ' shifts × ' || allowance_fmt(rate));
      when 'Per hour worked' then amt := rate * allowance_num(mets->>'hours_worked'); why := why || ((mets->>'hours_worked') || ' h × ' || allowance_fmt(rate));
      when 'Per overtime hour' then amt := rate * allowance_num(mets->>'overtime_hours'); why := why || ((mets->>'overtime_hours') || ' overtime h × ' || allowance_fmt(rate));
      else amt := rate * p_f * case when coalesce((ru->>'prorate')::boolean, true) then p_pro else 1 end;
        if p_pro < 1 and coalesce((ru->>'prorate')::boolean, true) then why := why || 'part of the period'::text; end if;
    end case;
    cut := allowance_num(ru->>'per_absence');
    if cut > 0 and allowance_num(mets->>'absences') > 0 then
      amt := amt - cut * allowance_num(mets->>'absences');
      why := why || ('−' || allowance_fmt(cut) || ' × ' || (mets->>'absences') || case when (mets->>'absences') = '1' then ' absence' else ' absences' end);
    end if;
    lo := allowance_num(ru->>'min'); hi := allowance_num(ru->>'cap');
    if lo > 0 and amt < lo then amt := lo; why := why || ('minimum ' || allowance_fmt(lo)); end if;
    if hi > 0 and amt > hi then amt := hi; why := why || ('capped at ' || allowance_fmt(hi)); end if;
    amt := round(greatest(0, amt), p_ndp);
    if amt = 0 and coalesce(ru->>'basis', '') in ('Per day worked', 'Per shift worked', 'Per hour worked', 'Per overtime hour') and cut = 0 then continue; end if;
    items := items || jsonb_build_object('name', btrim(ru->>'name'), 'amount', amt, 'rule', true, 'detail', nullif(array_to_string(why, ', '), ''));
  end loop;
  return items;
end $$;

-- 3. Pay runs use the rules (same as 0027 otherwise).
create or replace function calc_payroll_run(p_run uuid) returns void
  language plpgsql security definer set search_path = public as
$$ declare
  r payroll_runs; st jsonb; cfg jsonb; ndp int; cyc text; f numeric; hours numeric; pe numeric; pr numeric; absence boolean;
  wk int[]; wdays int; unpaid text[]; m record; mp member_pay; a_from date; a_to date; days_all int; days_emp int; pro numeric;
  basic numeric; allow numeric; items jsonb; ritems jsonb; hourly numeric; daily numeric; ot_min int; hol_min int; ot_amt numeric; weeks jsonb;
  up_days int; ab_days int; gross numeric; p_emp numeric; p_er numeric; rules jsonb;
begin
  select * into r from payroll_runs where id = p_run;
  if not found then raise exception 'Payroll run not found.'; end if;
  if not is_company_hr(r.company_id) then raise exception 'Only HR, owners and admins can prepare payroll.'; end if;
  if r.status <> 'Draft' then raise exception 'Only a draft run can be recalculated. Reopen it first.'; end if;
  select settings into st from companies where id = r.company_id;
  cfg := coalesce(st->'8_payroll_configuration', '{}'::jsonb);
  rules := case when jsonb_typeof(st->'8_allowance_rules') = 'array' then st->'8_allowance_rules' else '[]'::jsonb end;
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
    select coalesce(sum(t.overtime_min), 0), coalesce(sum(t.holiday_min), 0),
           coalesce(sum(t.overtime_min / 60.0 * hourly * t.overtime_rate + t.holiday_min / 60.0 * hourly * t.holiday_rate), 0),
           coalesce(jsonb_agg(t.week_start order by t.week_start), '[]'::jsonb)
      into ot_min, hol_min, ot_amt, weeks
      from timesheet_weeks t where t.company_id = r.company_id and t.user_id = m.user_id
        and not t.overtime_paid and t.paid_run is null and t.week_start + 6 <= r.period_end
        and t.overtime_min + t.holiday_min > 0;
    ot_amt := round(ot_amt, ndp);
    if mp.user_id is not null and jsonb_array_length(rules) > 0 then
      ritems := allowance_apply(rules, allowance_metrics(r.company_id, m.user_id, a_from, a_to, ot_min + hol_min), basic, f, pro, ndp);
      items := items || ritems;
      allow := allow + (select coalesce(sum((x->>'amount')::numeric), 0) from jsonb_array_elements(ritems) x);
    end if;
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

-- 4. Try rules on one person and period without making a pay run (HR only). p_rules = unsaved rules, or null for the saved ones.
create function preview_allowances(p_company uuid, p_user uuid, p_from date, p_to date, p_rules jsonb default null) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare st jsonb; cyc text; f numeric; ndp int; basic numeric; pro numeric; ot int; m jsonb; mp member_pay;
begin
  if not is_company_hr(p_company) then raise exception 'Only HR, owners and admins can try allowance rules.'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 40 then raise exception 'Choose a period of up to about a month.'; end if;
  select settings into st from companies where id = p_company;
  cyc := coalesce(st->'8_payroll_configuration'->>'cycle', 'Monthly');
  f := case cyc when 'Weekly' then 12.0 / 52 when 'Fortnightly' then 12.0 / 26 else 1 end;
  ndp := least(4, greatest(0, coalesce(nullif(st->'9_base_currency'->>'decimals', '')::int, 2)));
  select * into mp from member_pay where company_id = p_company and user_id = p_user;
  pro := 1;
  basic := round(coalesce(mp.basic, 0) * f, ndp);
  select coalesce(sum(overtime_min + holiday_min), 0) into ot from timesheet_weeks
    where company_id = p_company and user_id = p_user and paid_run is null and not overtime_paid and week_start + 6 <= p_to and week_start + 6 >= p_from;
  m := allowance_metrics(p_company, p_user, p_from, p_to, ot);
  return jsonb_build_object('metrics', m || jsonb_build_object('basic', basic), 'items',
    allowance_apply(coalesce(p_rules, case when jsonb_typeof(st->'8_allowance_rules') = 'array' then st->'8_allowance_rules' else '[]'::jsonb end), m, basic, f, pro, ndp));
end $$;
revoke execute on function preview_allowances(uuid, uuid, date, date, jsonb) from anon, public;
grant execute on function preview_allowances(uuid, uuid, date, date, jsonb) to authenticated;
