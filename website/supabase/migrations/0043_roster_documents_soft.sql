-- Expired certificates, missing qualifications and "shift is for another crew group" no longer stop a roster save
-- by default. The roster shows a warning mark instead. A company can still turn blocking back on in
-- Settings > HR & Crew > Crew Assignment Rules ("Block crew with expired certificates" / "Only qualified crew").
-- Only change from 0025: the defaults for 8_crew_assignment_rules.expired and .qualified are now false.

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
      if s not in ('OFF', 'L', 'TRN') and coalesce((rules->>'expired')::boolean, false) and has_expired_cert(p_company, u, d) then
        raise exception '% has an expired certificate on %, so they cannot work a shift (see Crew Assignment Rules).', nm, to_char(d, 'DD Mon');
      end if;
      if s not in ('OFF', 'L', 'TRN') and coalesce((rules->>'qualified')::boolean, false) then
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


-- Companies that already saved Crew Assignment Rules keep everything else, but expired documents and
-- missing qualifications become warnings (asked for on 22 Oct 2026). They can switch blocking back on in Settings.
do $$ begin
  perform set_config('veyora.subscription_write', 'on', true);  -- also update companies whose subscription has lapsed
  update companies
     set settings = jsonb_set(settings, '{8_crew_assignment_rules}', settings->'8_crew_assignment_rules' || '{"expired": false, "qualified": false}'::jsonb)
   where jsonb_typeof(settings->'8_crew_assignment_rules') = 'object';
end $$;
