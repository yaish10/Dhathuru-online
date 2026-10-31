-- Allowance rules: try rules on everyone on payroll at once (used by the rule builder to show what a rule would pay).
-- HR only. p_rules = unsaved rules, or null for the saved ones. Nothing is saved.
create function preview_allowances_all(p_company uuid, p_from date, p_to date, p_rules jsonb default null) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare st jsonb; cyc text; f numeric; ndp int; rules jsonb; m record; ot int; items jsonb; out_a jsonb := '[]'::jsonb;
begin
  if not is_company_hr(p_company) then raise exception 'Only HR, owners and admins can try allowance rules.'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 40 then raise exception 'Choose a period of up to about a month.'; end if;
  select settings into st from companies where id = p_company;
  cyc := coalesce(st->'8_payroll_configuration'->>'cycle', 'Monthly');
  f := case cyc when 'Weekly' then 12.0 / 52 when 'Fortnightly' then 12.0 / 26 else 1 end;
  ndp := least(4, greatest(0, coalesce(nullif(st->'9_base_currency'->>'decimals', '')::int, 2)));
  rules := coalesce(p_rules, case when jsonb_typeof(st->'8_allowance_rules') = 'array' then st->'8_allowance_rules' else '[]'::jsonb end);
  for m in select mp.user_id, mp.basic from member_pay mp join company_members cm on cm.company_id = mp.company_id and cm.user_id = mp.user_id
      where mp.company_id = p_company and cm.active and cm.employment_status is distinct from 'Former' and mp.basic > 0 loop
    select coalesce(sum(overtime_min + holiday_min), 0) into ot from timesheet_weeks
      where company_id = p_company and user_id = m.user_id and paid_run is null and not overtime_paid and week_start + 6 <= p_to and week_start + 6 >= p_from;
    items := allowance_apply(rules, allowance_metrics(p_company, m.user_id, p_from, p_to, ot), round(m.basic * f, ndp), f, 1, ndp);
    out_a := out_a || jsonb_build_object('user_id', m.user_id, 'items', items,
      'total', (select coalesce(sum((x->>'amount')::numeric), 0) from jsonb_array_elements(items) x));
  end loop;
  return out_a;
end $$;
revoke execute on function preview_allowances_all(uuid, date, date, jsonb) from anon, public;
grant execute on function preview_allowances_all(uuid, date, date, jsonb) to authenticated;
