-- Required qualifications: the database used an empty list until "Crew Qualification Types" was saved in
-- Settings, while the app showed (and the Settings page offered) the default list. Both now use the same
-- defaults as settings-defs.js, so an unsaved setting means the defaults apply, not "nothing required".

create function hr_qual_types(st jsonb) returns jsonb
  language sql immutable as
$$ select case when jsonb_typeof(st->'8_crew_qualification_types') = 'array' then st->'8_crew_qualification_types'
  else '[{"name":"Master licence","months":60,"required":"Captain"},{"name":"Engineer licence","months":60,"required":"Engineering"},
         {"name":"STCW Basic","months":60,"required":"All crew"},{"name":"First aid","months":36,"required":"None"},
         {"name":"Radio operator","months":60,"required":"Captain"},{"name":"Fire fighting","months":60,"required":"None"},
         {"name":"Security awareness","months":24,"required":"None"}]'::jsonb end $$;

-- Same as 0020 apart from the qualification list.
create or replace function set_roster(p_company uuid, p_rows jsonb) returns integer
  language plpgsql security definer set search_path = public as
$$ declare
  st jsonb; codes text[]; rules jsonb; ros jsonb; hours jsonb; rw jsonb;
  u uuid; d date; s text; n integer := 0; nm text; extra text; grp text; sh jsonb; sh_group text;
  q jsonb; prev text; prev_sh jsonb; cur_sh jsonb; rest_h numeric; need_rest numeric;
  run int; lim int; sum_h numeric; wl numeric; k int; cell text; per_st text; touched date[] := '{}';
begin
  if not can_edit_roster(p_company) then raise exception 'Only HR, owners, admins and the people named for crew assignments can change the roster.'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then raise exception 'Send up to 2000 roster cells at a time.'; end if;
  select settings into st from companies where id = p_company;
  codes := array(select upper(btrim(coalesce(x->>'code', left(x->>'name', 1)))) from jsonb_array_elements(
             case when jsonb_typeof(st->'8_shift_definitions') = 'array' then st->'8_shift_definitions'
                  else '[{"code":"D"},{"code":"E"},{"code":"N"}]'::jsonb end) x where jsonb_typeof(x) = 'object')
           || array['OFF', 'L', 'TRN'];
  rules := coalesce(st->'8_crew_assignment_rules', '{}'::jsonb);
  ros := coalesce(st->'8_duty_roster', '{}'::jsonb);
  hours := coalesce(st->'8_duty_hours', '{}'::jsonb);
  for rw in select * from jsonb_array_elements(p_rows) loop
    u := (rw->>'u')::uuid; d := (rw->>'d')::date; s := upper(btrim(rw->>'s'));
    if not exists (select 1 from company_members where company_id = p_company and user_id = u and active) then
      raise exception 'Someone in this roster is not an active member of the company.'; end if;
    select coalesce(p.full_name, split_part(p.email, '@', 1)) into nm from profiles p where p.id = u;
    per_st := roster_period_status(p_company, d);
    if per_st = 'locked' then raise exception 'This roster period is locked.'; end if;
    if coalesce((ros->>'lockPast')::boolean, false) and d < current_date then
      raise exception 'Past days are locked (see Duty Roster settings).'; end if;
    if s is null or s = '' then
      delete from roster_entries where company_id = p_company and user_id = u and day = d;
    else
      if not (s = any(codes)) then raise exception 'Unknown shift code "%". Add it under Shift Definitions.', s; end if;
      if s not in ('OFF', 'L') and exists (select 1 from leave_requests where company_id = p_company and user_id = u
            and status = 'Approved' and d between start_date and end_date) then
        raise exception '% is on approved leave on %.', nm, to_char(d, 'DD Mon');
      end if;
      extra := roster_extra_block(p_company, u, d, s);
      if extra is not null then raise exception '%', extra; end if;
      if s not in ('OFF', 'L', 'TRN') and coalesce((rules->>'expired')::boolean, true) and has_expired_cert(p_company, u, d) then
        raise exception '% has an expired certificate on %, so they cannot work a shift (see Crew Assignment Rules).', nm, to_char(d, 'DD Mon');
      end if;
      if s not in ('OFF', 'L', 'TRN') and coalesce((rules->>'qualified')::boolean, true) then
        grp := member_crew_group(p_company, u);
        sh := roster_shift_json(st, s);
        sh_group := coalesce(sh->>'group', 'Everyone');
        if sh_group not in ('Everyone', '') and sh_group is not null and grp is distinct from sh_group then
          raise exception '% is % crew; the % shift is for %.', nm, grp, s, sh_group;
        end if;
        for q in select * from jsonb_array_elements(
                   hr_qual_types(st)) loop
          if (q->>'required') = 'All crew' and grp in ('Captain', 'Deck', 'Engineering')
             or (q->>'required') = grp then
            if not has_valid_qual(p_company, u, q->>'name', d) then
              raise exception '% is missing a valid % for % (see Crew Assignment Rules).', nm, q->>'name', to_char(d, 'DD Mon');
            end if;
          end if;
        end loop;
      end if;
      if roster_is_working(s) and coalesce((rules->>'rest')::boolean, true) then
        need_rest := coalesce(nullif(hours->>'rest', '')::numeric, 8);
        prev := roster_batch_shift(p_company, u, d - 1, p_rows);
        if roster_is_working(prev) then
          prev_sh := roster_shift_json(st, prev); cur_sh := roster_shift_json(st, s);
          if prev_sh is not null and cur_sh is not null and prev_sh->>'end' is not null and cur_sh->>'start' is not null then
            rest_h := (hm_min(cur_sh->>'start') - (hm_min(prev_sh->>'end') + case when hm_min(prev_sh->>'end') <= hm_min(prev_sh->>'start') then 1440 else 0 end - 1440)) / 60.0;
            if rest_h < need_rest then
              raise exception '% has only %h rest before % on % (minimum %h).', nm, round(rest_h), s, to_char(d, 'DD Mon'), need_rest;
            end if;
          end if;
        end if;
        lim := coalesce(nullif(hours->>'consecutive', '')::int, 6);
        run := 0;
        for k in 0..40 loop
          cell := case when k = 0 then s else roster_batch_shift(p_company, u, d - k, p_rows) end;
          if roster_is_working(cell) then run := run + 1; else exit; end if;
        end loop;
        if run > lim then
          raise exception '% would have % working days in a row on % (limit %).', nm, run, to_char(d, 'DD Mon'), lim;
        end if;
        wl := coalesce(nullif(hours->>'weekly', '')::numeric, 60);
        sum_h := 0;
        for k in 0..6 loop
          cell := case when k = 0 then s else roster_batch_shift(p_company, u, d - k, p_rows) end;
          if cell = 'TRN' then sum_h := sum_h + 8;
          elsif roster_is_working(cell) then
            sh := roster_shift_json(st, cell);
            sum_h := sum_h + shift_hours_of(sh->>'start', sh->>'end', coalesce(nullif(sh->>'brk', '')::int, 0));
          end if;
        end loop;
        if sum_h > wl then
          raise exception '% would have %h in 7 days ending % (limit %h).', nm, round(sum_h), to_char(d, 'DD Mon'), wl;
        end if;
      end if;
      insert into roster_entries (company_id, user_id, day, shift, updated_by) values (p_company, u, d, s, auth.uid())
        on conflict (company_id, user_id, day) do update set shift = excluded.shift, updated_by = excluded.updated_by, updated_at = now();
    end if;
    n := n + 1;
    touched := array_append(touched, d);
  end loop;
  update roster_periods set status = 'amended'
    where company_id = p_company and status = 'published'
      and period_start <= (select max(x) from unnest(touched) x) and period_end >= (select min(x) from unnest(touched) x);
  insert into company_audit (company_id, actor, action, detail) values (p_company, auth.uid(), 'roster_changed', n || ' cells');
  return n;
end $$;

-- Same as 0023 apart from the qualification list.
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
  if coalesce((rules->>'expired')::boolean, true) and has_expired_cert(p_company, p_user, p_day) then
    return nm || ' has an expired certificate (see Crew Assignment Rules).'; end if;
  if coalesce((rules->>'qualified')::boolean, true) then
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
