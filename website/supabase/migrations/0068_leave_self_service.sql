-- Leave for the person themselves (apps): balances per leave type, their requests, applying and cancelling.
-- Same rules as the website's request form (HR → Leave & Absence → Request leave): working days skip the weekend set in
-- Duty Roster, approved and pending requests both count as used in the year the leave starts, and a type with a yearly
-- limit cannot be exceeded. The database now enforces these too, so a phone cannot skip them.
-- Approval itself is unchanged: the insert fires the existing triggers (auto-approve when approval is off, notify approvers).

-- The company's weekend as day-of-week numbers (0 = Sunday), from Duty Roster → weekend.
create function leave_weekend_dows(p_company uuid) returns integer[]
  language sql stable security definer set search_path = public as
$$ select case coalesce((select settings->'8_duty_roster'->>'weekend' from companies where id = p_company), 'Friday & Saturday')
       when 'Saturday & Sunday' then array[6, 0]
       when 'Friday only' then array[5]
       when 'None' then array[]::int[]
       else array[5, 6] end $$;
revoke execute on function leave_weekend_dows(uuid) from anon, public, authenticated;

-- Working days between two dates (inclusive), leaving out the weekend.
create function leave_working_days(p_company uuid, p_start date, p_end date) returns integer
  language sql stable security definer set search_path = public as
$$ select count(*)::int from generate_series(p_start, least(p_end, p_start + 399), interval '1 day') d
   where extract(dow from d)::int <> all (leave_weekend_dows(p_company)) $$;
revoke execute on function leave_working_days(uuid, date, date) from anon, public, authenticated;

-- Leave types as the company defined them (Settings → Leave Types & Policies); one default when none are set.
create function leave_types_of(p_company uuid) returns jsonb
  language sql stable security definer set search_path = public as
$$ select coalesce(
     (select jsonb_agg(jsonb_build_object('name', x->>'name', 'days', coalesce(nullif(x->>'days', '')::int, 0),
                                          'paid', coalesce((x->>'paid')::boolean, true), 'note', coalesce((x->>'note')::boolean, false)))
        from companies c, jsonb_array_elements(case when jsonb_typeof(c.settings->'8_leave_types_and_policies') = 'array'
             then c.settings->'8_leave_types_and_policies' else '[]'::jsonb end) x
        where c.id = p_company and jsonb_typeof(x) = 'object' and coalesce(btrim(x->>'name'), '') <> ''),
     jsonb_build_array(jsonb_build_object('name', 'Annual leave', 'days', 0, 'paid', true, 'note', false))) $$;
revoke execute on function leave_types_of(uuid) from anon, public, authenticated;

-- Days of one type already taken or waiting, for leave starting in p_year.
create function leave_used_days(p_company uuid, p_user uuid, p_type text, p_year int, p_status text, p_except uuid default null) returns integer
  language sql stable security definer set search_path = public as
$$ select coalesce(sum(leave_working_days(p_company, l.start_date, l.end_date)), 0)::int from leave_requests l
   where l.company_id = p_company and l.user_id = p_user and l.leave_type = p_type and l.status = p_status
     and extract(year from l.start_date)::int = p_year and l.id is distinct from p_except $$;
revoke execute on function leave_used_days(uuid, uuid, text, int, text, uuid) from anon, public, authenticated;

create function my_leave_overview(p_company uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare yr int := extract(year from current_date)::int; w jsonb; types jsonb; reqs jsonb;
begin
  if not is_company_member(p_company) then raise exception 'Not a member of this company.'; end if;
  select settings->'8_leave_approval_workflow' into w from companies where id = p_company;
  select coalesce(jsonb_agg(t || jsonb_build_object(
      'taken', leave_used_days(p_company, auth.uid(), t->>'name', yr, 'Approved'),
      'pending', leave_used_days(p_company, auth.uid(), t->>'name', yr, 'Pending'),
      'remaining', case when (t->>'days')::int > 0 then (t->>'days')::int
                          - leave_used_days(p_company, auth.uid(), t->>'name', yr, 'Approved')
                          - leave_used_days(p_company, auth.uid(), t->>'name', yr, 'Pending') end)), '[]'::jsonb)
    into types from jsonb_array_elements(leave_types_of(p_company)) t;
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'type', l.leave_type, 'start', l.start_date, 'end', l.end_date,
      'days', leave_working_days(p_company, l.start_date, l.end_date), 'status', lower(l.status), 'note', l.note,
      'decision_note', l.decision_note, 'created_at', l.created_at, 'decided_at', l.decided_at) order by l.start_date desc), '[]'::jsonb)
    into reqs from leave_requests l
    where l.company_id = p_company and l.user_id = auth.uid() and l.end_date >= date_trunc('year', current_date)::date - 365;
  return jsonb_build_object('year', yr, 'approval_on', coalesce((w->>'enabled')::boolean, true), 'weekend', to_jsonb(leave_weekend_dows(p_company)), 'types', types, 'requests', reqs);
end $$;
revoke execute on function my_leave_overview(uuid) from anon, public;
grant execute on function my_leave_overview(uuid) to authenticated;

create function request_leave(p_company uuid, p_type text, p_start date, p_end date, p_note text default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare t jsonb; lim int; need int; used int; r leave_requests;
begin
  if not is_company_member(p_company) then raise exception 'Not a member of this company.'; end if;
  if not exists (select 1 from company_members where company_id = p_company and user_id = auth.uid() and active) then
    raise exception 'Only active staff can ask for leave.'; end if;
  select x into t from jsonb_array_elements(leave_types_of(p_company)) x where x->>'name' = p_type;
  if t is null then raise exception 'That leave type is not available.'; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'Choose valid dates. The end date cannot be before the start.'; end if;
  if p_end - p_start > 365 then raise exception 'Leave cannot be longer than a year.'; end if;
  need := leave_working_days(p_company, p_start, p_end);
  if need = 0 then raise exception 'Those dates are all weekend days.'; end if;
  if (t->>'note')::boolean and coalesce(btrim(p_note), '') = '' then raise exception 'A note is required for %.', p_type; end if;
  lim := (t->>'days')::int;
  if lim > 0 then
    used := leave_used_days(p_company, auth.uid(), p_type, extract(year from p_start)::int, 'Approved')
          + leave_used_days(p_company, auth.uid(), p_type, extract(year from p_start)::int, 'Pending');
    if used + need > lim then
      raise exception 'That is more than the % working days of % allowed this year (% used or waiting).', lim, p_type, used;
    end if;
  end if;
  if exists (select 1 from leave_requests where company_id = p_company and user_id = auth.uid() and status in ('Pending', 'Approved')
               and start_date <= p_end and end_date >= p_start) then
    raise exception 'You already have leave that overlaps those dates.';
  end if;
  insert into leave_requests (company_id, user_id, leave_type, start_date, end_date, note)
    values (p_company, auth.uid(), p_type, p_start, p_end, nullif(left(btrim(p_note), 200), '')) returning * into r;
  select * into r from leave_requests where id = r.id;   -- the insert trigger may have approved it straight away
  return jsonb_build_object('id', r.id, 'status', lower(r.status), 'days', need);
end $$;
revoke execute on function request_leave(uuid, text, date, date, text) from anon, public;
grant execute on function request_leave(uuid, text, date, date, text) to authenticated;

-- Take back a request that is still waiting.
create function cancel_leave(p_id uuid) returns void
  language plpgsql security definer set search_path = public as
$$ declare r leave_requests;
begin
  select * into r from leave_requests where id = p_id;
  if not found or r.user_id <> auth.uid() then raise exception 'Leave request not found.'; end if;
  if r.status <> 'Pending' then raise exception 'Only a request that is still waiting can be cancelled.'; end if;
  delete from leave_requests where id = p_id;
  insert into company_audit (company_id, actor, action, detail) values (r.company_id, auth.uid(), 'leave_cancelled', r.id::text);
end $$;
revoke execute on function cancel_leave(uuid) from anon, public;
grant execute on function cancel_leave(uuid) to authenticated;
