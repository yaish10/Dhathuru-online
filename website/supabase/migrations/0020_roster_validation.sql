-- Duty roster: enforce qualification, rest/hours, and coverage. Periods: draft, published, amended, locked.

create table roster_periods (
  company_id    uuid not null references companies(id) on delete cascade,
  period_start  date not null,
  period_end    date not null,
  status        text not null default 'draft' check (status in ('draft', 'published', 'amended', 'locked')),
  published_by  uuid references auth.users(id) on delete set null,
  published_at  timestamptz,
  note          text check (note is null or char_length(note) <= 200),
  primary key (company_id, period_start),
  check (period_end >= period_start)
);
alter table roster_periods enable row level security;
create policy roster_periods_select on roster_periods for select to authenticated using (is_company_member(company_id));
create trigger roster_periods_subscription before insert or update or delete on roster_periods
  for each row execute function reject_if_subscription_expired();

-- Hook 0021 uses to refuse a working shift (attendance Absent / On leave). Default: no extra block.
create function roster_extra_block(p_company uuid, p_user uuid, p_day date, p_shift text) returns text
  language sql stable security definer set search_path = public as $$ select null::text $$;
revoke execute on function roster_extra_block(uuid, uuid, date, text) from anon, public;

create function hm_min(t text) returns int
  language sql immutable as
$$ select case when t ~ '^\d{1,2}:\d{2}' then split_part(t, ':', 1)::int * 60 + split_part(t, ':', 2)::int end $$;

create function shift_hours_of(start_t text, end_t text, brk int) returns numeric
  language plpgsql immutable as
$$ declare a int; b int;
begin
  a := hm_min(start_t); b := hm_min(end_t);
  if a is null or b is null then return 8;
  end if;
  if b <= a then b := b + 1440; end if;
  return greatest(0, b - a - coalesce(brk, 0)) / 60.0;
end $$;

create function roster_shift_json(st jsonb, p_code text) returns jsonb
  language sql stable as
$$
  select x from jsonb_array_elements(
    case when jsonb_typeof(st->'8_shift_definitions') = 'array' then st->'8_shift_definitions'
         else '[{"code":"D","start":"06:00","end":"14:00"},{"code":"E","start":"14:00","end":"22:00"},{"code":"N","start":"22:00","end":"06:00"}]'::jsonb end
  ) x
  where upper(btrim(coalesce(x->>'code', left(x->>'name', 1)))) = upper(btrim(p_code))
  limit 1
$$;

create function roster_is_working(p_code text) returns boolean
  language sql immutable as $$ select p_code is not null and p_code <> '' and p_code not in ('OFF', 'L') $$;

create function roster_batch_shift(p_company uuid, p_user uuid, p_day date, p_rows jsonb) returns text
  language plpgsql stable as
$$ declare s text;
begin
  if p_rows is not null then
    select upper(btrim(x.value->>'s')) into s
      from jsonb_array_elements(p_rows) with ordinality as x(value, ord)
      where (x.value->>'u')::uuid = p_user and (x.value->>'d')::date = p_day
      order by x.ord desc limit 1;
    if found then
      if s is null or s = '' then return null; end if;
      return s;
    end if;
  end if;
  select shift into s from roster_entries where company_id = p_company and user_id = p_user and day = p_day;
  return s;
end $$;

create function member_crew_group(p_company uuid, p_user uuid) returns text
  language sql stable as
$$ select coalesce(jt.crew_group, 'Other')
   from company_members m left join job_titles jt on jt.id = m.job_title_id
   where m.company_id = p_company and m.user_id = p_user $$;

create function has_valid_qual(p_company uuid, p_user uuid, p_name text, p_day date) returns boolean
  language sql stable as
$$ select exists (
  select 1 from staff_certifications c
  where c.company_id = p_company and c.user_id = p_user
    and lower(btrim(c.name)) = lower(btrim(p_name))
    and (c.valid_until is null or c.valid_until >= p_day)
) $$;

create function roster_period_status(p_company uuid, p_day date) returns text
  language sql stable as
$$ select status from roster_periods
   where company_id = p_company and p_day between period_start and period_end
   order by period_start desc limit 1 $$;

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
                   case when jsonb_typeof(st->'8_crew_qualification_types') = 'array' then st->'8_crew_qualification_types' else '[]'::jsonb end) loop
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

create function roster_coverage_gaps(p_company uuid, p_start date, p_end date) returns text
  language plpgsql stable security definer set search_path = public as
$$ declare
  st jsonb; rules jsonb; sh jsonb; needed int; have int; minc int; d date; code text; out text := '';
begin
  select settings into st from companies where id = p_company;
  rules := coalesce(st->'8_crew_assignment_rules', '{}'::jsonb);
  minc := coalesce(nullif(rules->>'minCrew', '')::int, 0);
  d := p_start;
  while d <= p_end loop
    for sh in select * from jsonb_array_elements(
      case when jsonb_typeof(st->'8_shift_definitions') = 'array' then st->'8_shift_definitions' else '[]'::jsonb end) loop
      code := upper(btrim(coalesce(sh->>'code', left(sh->>'name', 1))));
      needed := coalesce(nullif(sh->>'needed', '')::int, 0);
      if needed > 0 then
        select count(*) into have from roster_entries where company_id = p_company and day = d and shift = code;
        if have < needed then
          out := out || to_char(d, 'DD Mon') || ' ' || code || ' short by ' || (needed - have) || '. ';
        end if;
      end if;
    end loop;
    if minc > 0
       and not exists (
         select 1 from jsonb_array_elements(
           case when jsonb_typeof(st->'8_shift_definitions') = 'array' then st->'8_shift_definitions' else '[]'::jsonb end
         ) x where coalesce(nullif(x->>'needed', '')::int, 0) > 0
       ) then
      select count(*) into have from roster_entries
        where company_id = p_company and day = d and shift not in ('OFF', 'L');
      if have < minc then
        out := out || to_char(d, 'DD Mon') || ' has ' || have || ' working (minimum ' || minc || '). ';
      end if;
    end if;
    d := d + 1;
  end loop;
  return nullif(btrim(out), '');
end $$;
revoke execute on function roster_coverage_gaps(uuid, date, date) from anon, public;
grant execute on function roster_coverage_gaps(uuid, date, date) to authenticated;

create function publish_roster(p_company uuid, p_start date, p_end date) returns text
  language plpgsql security definer set search_path = public as
$$ declare gaps text; st text;
begin
  if not can_edit_roster(p_company) then raise exception 'Only roster editors can publish.'; end if;
  if p_end < p_start then raise exception 'The end date is before the start.'; end if;
  if p_end - p_start > 62 then raise exception 'Publish at most two months at a time.'; end if;
  gaps := roster_coverage_gaps(p_company, p_start, p_end);
  if gaps is not null then raise exception 'Coverage gaps remain: %', gaps; end if;
  select status into st from roster_periods where company_id = p_company and period_start = p_start;
  if st = 'locked' then raise exception 'Unlock this period before publishing.'; end if;
  insert into roster_periods (company_id, period_start, period_end, status, published_by, published_at)
    values (p_company, p_start, p_end, 'published', auth.uid(), now())
    on conflict (company_id, period_start) do update
      set period_end = excluded.period_end, status = 'published', published_by = excluded.published_by, published_at = now();
  insert into company_audit (company_id, actor, action, detail)
    values (p_company, auth.uid(), 'roster_published', p_start::text || ' to ' || p_end::text);
  return 'published';
end $$;
revoke execute on function publish_roster(uuid, date, date) from anon, public;
grant execute on function publish_roster(uuid, date, date) to authenticated;

create function set_roster_period_status(p_company uuid, p_start date, p_end date, p_status text) returns text
  language plpgsql security definer set search_path = public as
$$ begin
  if not can_edit_roster(p_company) then raise exception 'Only roster editors can change the period status.'; end if;
  if p_status not in ('draft', 'published', 'amended', 'locked') then raise exception 'Unknown roster status.'; end if;
  insert into roster_periods (company_id, period_start, period_end, status, published_by, published_at)
    values (p_company, p_start, p_end, p_status, case when p_status = 'published' then auth.uid() end,
            case when p_status = 'published' then now() end)
    on conflict (company_id, period_start) do update
      set period_end = excluded.period_end, status = p_status,
          published_by = case when p_status = 'published' then auth.uid() else roster_periods.published_by end,
          published_at = case when p_status = 'published' then now() else roster_periods.published_at end;
  insert into company_audit (company_id, actor, action, detail)
    values (p_company, auth.uid(), 'roster_status', p_status || ' ' || p_start::text);
  return p_status;
end $$;
revoke execute on function set_roster_period_status(uuid, date, date, text) from anon, public;
grant execute on function set_roster_period_status(uuid, date, date, text) to authenticated;
