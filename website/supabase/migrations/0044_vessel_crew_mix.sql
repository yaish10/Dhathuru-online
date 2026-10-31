-- Crew mix per vessel (e.g. 1 Captain, 2 Crew, 1 Cashier) and trip crew that follows the duty roster.
--  * vessels.meta.crew_mix = [{"role": "Captain", "n": 1}, {"role": "Crew", "n": 2}, {"role": "Cashier", "n": 1}]
--    Set with set_vessel_crew_mix(p_vessel, p_mix) by Operations or HR. Company default: 3_auto_crew_rules.mix (same shape).
--  * A role matches a person's designation ("Cashier"), its crew group ("Captain"), and "Crew" means any sea-going
--    non-captain (Deck / Engineering, or a designation containing "crew").
--  * auto_assign_crew (run every minute by ops_tick, or now with assign_trip_crew) fills each trip from the people on duty
--    for the whole trip, by role. When the roster changes, crew it placed automatically who are no longer on duty are
--    taken off trips that have not started boarding, and the place is filled again. People chosen by hand are never moved.
--  * crew_check: expired certificates / missing qualifications are warnings by default, as on the roster (0043).
--  * No crew_mix anywhere = the old behaviour (captain + deck + engineering numbers from 0039).

create or replace function crew_check(p_company uuid, p_user uuid, p_day date) returns text
  language plpgsql stable security definer set search_path = public as
$$ declare
  st jsonb; rules jsonb; m record; nm text; grp text; q jsonb; missing text[] := '{}'; att text;
begin
  select settings into st from companies where id = p_company;
  rules := coalesce(st->'8_crew_assignment_rules', '{}'::jsonb);
  select employment_status, active into m from company_members where company_id = p_company and user_id = p_user;
  if not found then return 'Not in this company.'; end if;
  select coalesce(p.full_name, split_part(p.email, '@', 1)) into nm from profiles p where p.id = p_user;
  if m.employment_status = 'Former' or not m.active then return nm || ' no longer works here.'; end if;
  if m.employment_status = 'Suspended' then return nm || ' is suspended.'; end if;
  if exists (select 1 from leave_requests where company_id = p_company and user_id = p_user and status = 'Approved' and p_day between start_date and end_date) then
    return nm || ' is on approved leave on ' || to_char(p_day, 'DD Mon') || '.'; end if;
  select status into att from attendance_records where company_id = p_company and user_id = p_user and day = p_day;
  if att = 'Absent' then return nm || ' is marked Absent on ' || to_char(p_day, 'DD Mon') || '.'; end if;
  if coalesce((rules->>'expired')::boolean, false) and has_expired_cert(p_company, p_user, p_day) then
    return nm || ' has an expired certificate (see Crew Assignment Rules).'; end if;
  if coalesce((rules->>'qualified')::boolean, false) then
    grp := member_crew_group(p_company, p_user);
    for q in select * from jsonb_array_elements(
               hr_qual_types(st)) loop
      if ((q->>'required') = 'All crew' and grp in ('Captain', 'Deck', 'Engineering')) or (q->>'required') = grp then
        if not has_valid_qual(p_company, p_user, q->>'name', p_day) then missing := missing || (q->>'name'); end if;
      end if;
    end loop;
    if array_length(missing, 1) > 0 then
      return nm || ' is missing ' || array_to_string(missing, ', ') || ' required for ' || grp || ' crew.'; end if;
  end if;
  return null;
end $$;


create or replace function member_fits_role(p_company uuid, p_user uuid, p_role text) returns boolean
  language sql stable security definer set search_path = public as
$$ with p as (
     select lower(coalesce(jt.title, m.role_label, '')) as pos, lower(coalesce(jt.crew_group, '')) as grp,
            regexp_replace(lower(btrim(p_role)), 's$', '') as r
     from company_members m left join job_titles jt on jt.id = m.job_title_id
     where m.company_id = p_company and m.user_id = p_user)
   select coalesce((select pos = r or regexp_replace(pos, 's$', '') = r or grp = r
                       or (r = 'crew' and (pos like '%crew%' or (grp in ('deck', 'engineering') and pos not like '%captain%')))
                    from p), false) $$;
revoke execute on function member_fits_role(uuid, uuid, text) from anon, public;

create or replace function is_captain_role(p_role text) returns boolean
  language sql immutable as $$ select lower(btrim(p_role)) in ('captain', 'captains', 'master', 'skipper') $$;

-- The crew mix for a vessel: its own, else the company default, else null (old behaviour).
create or replace function crew_mix(p_company uuid, p_vessel uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare m jsonb;
begin
  if p_vessel is not null then
    select meta->'crew_mix' into m from vessels where id = p_vessel and company_id = p_company;
    if jsonb_typeof(m) = 'array' and jsonb_array_length(m) > 0 then return m; end if;
  end if;
  m := company_setting(p_company, '3_auto_crew_rules')->'mix';
  if jsonb_typeof(m) = 'array' and jsonb_array_length(m) > 0 then return m; end if;
  return null;
end $$;
revoke execute on function crew_mix(uuid, uuid) from anon, public;
grant execute on function crew_mix(uuid, uuid) to authenticated;

-- Operations or HR set a vessel's crew mix. p_mix = [{role, n}] (up to 10 roles, 0–20 each); [] clears it.
create or replace function set_vessel_crew_mix(p_vessel uuid, p_mix jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare v vessels; clean jsonb := '[]'::jsonb; x jsonb; r text; n int;
begin
  select * into v from vessels where id = p_vessel;
  if not found then raise exception 'Vessel not found.'; end if;
  if not (is_company_ops(v.company_id) or is_company_hr(v.company_id)) then raise exception 'Only Operations or HR can set vessel crew.'; end if;
  if jsonb_typeof(p_mix) <> 'array' or jsonb_array_length(p_mix) > 10 then raise exception 'Send up to 10 roles.'; end if;
  for x in select * from jsonb_array_elements(p_mix) loop
    r := btrim(coalesce(x->>'role', '')); n := coalesce(nullif(x->>'n', '')::int, 0);
    if char_length(r) < 2 or char_length(r) > 40 then raise exception 'Each role needs a name (2–40 letters).'; end if;
    if n < 0 or n > 20 then raise exception 'Use 0 to 20 people per role.'; end if;
    if n > 0 then clean := clean || jsonb_build_object('role', r, 'n', n); end if;
  end loop;
  update vessels set meta = case when jsonb_array_length(clean) = 0 then meta - 'crew_mix' else jsonb_set(meta, '{crew_mix}', clean) end
   where id = p_vessel returning * into v;
  insert into company_audit (company_id, actor, action, detail) values (v.company_id, auth.uid(), 'vessel_crew_mix', coalesce(v.code, v.name) || ': ' || clean::text);
  return v.meta->'crew_mix';
end $$;
revoke execute on function set_vessel_crew_mix(uuid, jsonb) from anon, public;
grant execute on function set_vessel_crew_mix(uuid, jsonb) to authenticated;

-- Best free, on-duty person for a role on a trip (same preferences as pick_crew: people assigned to the vessel,
-- then fewest trips that day, then people without document problems).
create or replace function pick_crew_role(p_trip uuid, p_role text) returns uuid
  language plpgsql stable security definer set search_path = public as
$$ declare t trips; v vessels; e timestamptz; tz text; d date; u uuid;
begin
  select * into t from trips where id = p_trip;
  select * into v from vessels where id = t.vessel_id;
  e := trip_end(t); tz := company_tz(t.company_id); d := (t.depart_at at time zone tz)::date;
  select cm.user_id into u from company_members cm
    where cm.company_id = t.company_id and cm.active and cm.employment_status = 'Active'
      and member_fits_role(t.company_id, cm.user_id, p_role)
      and cm.user_id is distinct from t.captain_id
      and not exists (select 1 from trip_crew c where c.trip_id = t.id and c.user_id = cm.user_id)
      and roster_covers(t.company_id, cm.user_id, t.depart_at, e)
      and crew_check(t.company_id, cm.user_id, d) is null
      and not person_on_trip(t.company_id, cm.user_id, t.depart_at, e, t.id)
    order by (v.id is not null and lower(coalesce(cm.assigned_vessel, '')) in (lower(v.name), lower(coalesce(v.code, '')))) desc,
             (select count(*) from trips o where o.company_id = t.company_id and (o.depart_at at time zone tz)::date = d
                and (o.captain_id = cm.user_id or exists (select 1 from trip_crew c where c.trip_id = o.id and c.user_id = cm.user_id))),
             has_expired_cert(t.company_id, cm.user_id, d),
             cm.user_id
    limit 1;
  return u;
end $$;
revoke execute on function pick_crew_role(uuid, text) from anon, public;

create or replace function auto_assign_crew(p_company uuid) returns integer
  language plpgsql security definer set search_path = public as
$$ declare r jsonb; t record; u uuid; n int := 0; need int; grp text; have int; nm text; mix jsonb; it jsonb; v_role text; v_c record;
begin
  r := company_setting(p_company, '3_auto_crew_rules');
  if not coalesce((r->>'enabled')::boolean, true) then return 0; end if;
  for t in select tr.id, tr.captain_id, tr.vessel_id, tr.status, tr.depart_at, trip_end(tr) as ends, tr.meta tmeta, v.meta vmeta
           from trips tr left join vessels v on v.id = tr.vessel_id
           where tr.company_id = p_company and not trip_closed(tr.status) and tr.status in ('Scheduled', 'Boarding', 'Delayed')
             and (tr.depart_at > now() or (tr.status = 'Delayed' and tr.status_reason like 'Waiting:%' and tr.depart_at > now() - interval '6 hours'))
             and tr.depart_at < now() + make_interval(hours => coalesce(nullif(r->>'hours', '')::int, 48))
           order by tr.depart_at loop

    -- Roster changed? Take off people placed automatically who are no longer on duty (before boarding only).
    if t.status = 'Scheduled' then
      for v_c in select tc.user_id, tc.role from trip_crew tc where tc.trip_id = t.id and (tc.meta->>'auto')::boolean is true
                 and not roster_covers(p_company, tc.user_id, t.depart_at, t.ends) loop
        delete from trip_crew where trip_id = t.id and user_id = v_c.user_id;
        select coalesce(full_name, split_part(email, '@', 1)) into nm from profiles where id = v_c.user_id;
        insert into trip_events (company_id, trip_id, kind, detail) values (p_company, t.id, 'auto', coalesce(nm, '') || ' (' || v_c.role || ') taken off: no longer on duty in the roster');
      end loop;
      if t.captain_id is not null and (t.tmeta->>'auto_captain')::boolean is true and not roster_covers(p_company, t.captain_id, t.depart_at, t.ends) then
        begin
          update trips set captain_id = null, meta = meta - 'auto_captain' where id = t.id;
          select coalesce(full_name, split_part(email, '@', 1)) into nm from profiles where id = t.captain_id;
          insert into trip_events (company_id, trip_id, kind, detail) values (p_company, t.id, 'auto', 'Captain ' || coalesce(nm, '') || ' taken off: no longer on duty in the roster');
          t.captain_id := null;
        exception when others then null;
        end;
      end if;
    end if;

    mix := crew_mix(p_company, t.vessel_id);
    if mix is not null then
      -- Automatic placements under a role this vessel no longer needs (e.g. old "Deck") come off before boarding.
      if t.status = 'Scheduled' then
        delete from trip_crew tc where tc.trip_id = t.id and (tc.meta->>'auto')::boolean is true
          and not exists (select 1 from jsonb_array_elements(mix) m where lower(m->>'role') = lower(tc.role) and coalesce(nullif(m->>'n', '')::int, 0) > 0);
      end if;
      for it in select * from jsonb_array_elements(mix) loop
        v_role := it->>'role'; need := coalesce(nullif(it->>'n', '')::int, 0);
        continue when need <= 0;
        if is_captain_role(v_role) then
          if t.captain_id is null then
            u := pick_crew_role(t.id, v_role);
            if u is not null then
              begin
                update trips set captain_id = u, meta = jsonb_set(meta, '{auto_captain}', 'true') where id = t.id;
                t.captain_id := u;
                select coalesce(full_name, split_part(email, '@', 1)) into nm from profiles where id = u;
                insert into trip_events (company_id, trip_id, kind, detail) values (p_company, t.id, 'auto', 'Captain ' || coalesce(nm, '') || ' assigned from the roster');
                n := n + 1;
              exception when others then null;
              end;
            end if;
          end if;
          have := case when t.captain_id is null then 0 else 1 end;
        else
          have := 0;
        end if;
        have := have + (select count(*) from trip_crew c where c.trip_id = t.id and lower(c.role) = lower(v_role));
        while have < need loop
          u := pick_crew_role(t.id, v_role);
          exit when u is null;
          begin
            insert into trip_crew (trip_id, company_id, user_id, role, meta) values (t.id, p_company, u, v_role, '{"auto": true}');
            select coalesce(full_name, split_part(email, '@', 1)) into nm from profiles where id = u;
            insert into trip_events (company_id, trip_id, kind, detail) values (p_company, t.id, 'auto', v_role || ' ' || coalesce(nm, '') || ' assigned from the roster');
            n := n + 1;
          exception when others then exit;
          end;
          have := have + 1;
        end loop;
      end loop;
      continue;
    end if;

    -- No crew mix: captain + deck + engineering numbers (0039 behaviour).
    if t.captain_id is null and coalesce((r->>'captain')::boolean, true) then
      u := pick_crew(t.id, 'Captain');
      if u is not null then
        begin
          update trips set captain_id = u, meta = jsonb_set(meta, '{auto_captain}', 'true') where id = t.id;
          select coalesce(full_name, split_part(email, '@', 1)) into nm from profiles where id = u;
          insert into trip_events (company_id, trip_id, kind, detail) values (p_company, t.id, 'auto', 'Captain ' || coalesce(nm, '') || ' assigned from the roster');
          n := n + 1;
        exception when others then null;
        end;
      end if;
    end if;
    foreach grp in array array['Deck', 'Engineering'] loop
      need := coalesce(nullif(t.vmeta->'crew'->>lower(grp), '')::int, nullif(r->>lower(grp), '')::int, 1);
      select count(*) into have from trip_crew c where c.trip_id = t.id and member_crew_group(p_company, c.user_id) = grp;
      while have < need loop
        u := pick_crew(t.id, grp);
        exit when u is null;
        begin
          insert into trip_crew (trip_id, company_id, user_id, role, meta) values (t.id, p_company, u, grp, '{"auto": true}');
          select coalesce(full_name, split_part(email, '@', 1)) into nm from profiles where id = u;
          insert into trip_events (company_id, trip_id, kind, detail) values (p_company, t.id, 'auto', grp || ' crew ' || coalesce(nm, '') || ' assigned from the roster');
          n := n + 1;
        exception when others then exit;
        end;
        have := have + 1;
      end loop;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function auto_assign_crew(uuid) from anon, public;

-- One-off: captains placed automatically before this migration (trip_events "Captain … assigned from the roster")
-- get the auto_captain flag, so they too follow roster changes. Captains chosen by hand are untouched.
update trips t set meta = jsonb_set(t.meta, '{auto_captain}', 'true')
 where not trip_closed(t.status) and t.captain_id is not null and (t.meta->>'auto_captain') is null
   and exists (select 1 from trip_events e join profiles p on p.id = t.captain_id
               where e.trip_id = t.id and e.kind = 'auto'
                 and e.detail = 'Captain ' || coalesce(p.full_name, split_part(p.email, '@', 1)) || ' assigned from the roster');
