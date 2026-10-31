-- 0061: Shift swap requests (staff swap a day's shift with a colleague; optional HOD approval from HR rules).
-- Ownership: database only. UI: the iOS app (Home -> Quick access -> Shift change) and, later, the web.
--
-- Flow: requester picks a colleague + day -> colleague accepts/declines -> if HR rule `8_shift_swap_rules.hod`
-- is on, the approvers (manager, department head, people named for Crew assignments; HR if none) decide ->
-- the roster is swapped through the same validation as set_roster (rest, hours, leave, locked periods).

-- 1. The roster engine without the permission check, for internal callers (swap). set_roster keeps its check.
create function roster_apply(p_company uuid, p_rows jsonb) returns integer
  language plpgsql security definer set search_path = public as
$$ declare
  st jsonb; codes text[]; rules jsonb; ros jsonb; hours jsonb; rw jsonb;
  u uuid; d date; s text; n integer := 0; nm text; extra text; grp text; sh jsonb; sh_group text;
  q jsonb; prev text; prev_sh jsonb; cur_sh jsonb; rest_h numeric; need_rest numeric;
  run int; lim int; sum_h numeric; wl numeric; k int; cell text; per_st text; touched date[] := '{}';
begin
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
revoke execute on function roster_apply(uuid, jsonb) from anon, public, authenticated;

create or replace function set_roster(p_company uuid, p_rows jsonb) returns integer
  language plpgsql security definer set search_path = public as
$$ begin
  if not can_edit_roster(p_company) then raise exception 'Only HR, owners, admins and the people named for crew assignments can change the roster.'; end if;
  return roster_apply(p_company, p_rows);
end $$;
revoke execute on function set_roster(uuid, jsonb) from anon, public;
grant execute on function set_roster(uuid, jsonb) to authenticated;

-- 2. Rules (HR Settings -> Shift Swap Rules, key 8_shift_swap_rules). Defaults apply until HR saves them.
create function swap_rules(p_company uuid) returns jsonb
  language sql stable security definer set search_path = public as
$$ select jsonb_build_object(
     'enabled', coalesce((settings->'8_shift_swap_rules'->>'enabled')::boolean, true),
     'hod', coalesce((settings->'8_shift_swap_rules'->>'hod')::boolean, true),
     'notice_hours', coalesce(nullif(settings->'8_shift_swap_rules'->>'notice', '')::int, 0))
   from companies where id = p_company $$;
revoke execute on function swap_rules(uuid) from anon, public;
grant execute on function swap_rules(uuid) to authenticated;

-- 3. Requests. Free-text reason, meta jsonb for later fields; status is a fixed list because the code acts on it.
create table shift_swaps (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references companies(id) on delete cascade,
  requester            uuid not null,
  partner              uuid not null,
  day                  date not null,
  requester_shift      text not null check (char_length(requester_shift) between 1 and 6),
  partner_shift        text not null check (char_length(partner_shift) between 1 and 6),
  reason               text check (reason is null or char_length(reason) <= 200),
  needs_approval       boolean not null default false,
  status               text not null default 'pending_partner'
                       check (status in ('pending_partner', 'pending_approval', 'approved', 'declined', 'rejected', 'cancelled')),
  partner_responded_at timestamptz,
  partner_note         text check (partner_note is null or char_length(partner_note) <= 200),
  decided_by           uuid references auth.users(id) on delete set null,
  decided_at           timestamptz,
  decision_note        text check (decision_note is null or char_length(decision_note) <= 200),
  meta                 jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  foreign key (company_id, requester) references company_members (company_id, user_id) on delete cascade,
  foreign key (company_id, partner) references company_members (company_id, user_id) on delete cascade,
  check (requester <> partner)
);
create index on shift_swaps (company_id, status, day);
create index on shift_swaps (company_id, requester);
create index on shift_swaps (company_id, partner);
-- One open request per person and day.
create unique index shift_swaps_open_requester on shift_swaps (company_id, requester, day)
  where status in ('pending_partner', 'pending_approval');
alter table shift_swaps enable row level security;
create trigger shift_swaps_subscription before insert or update or delete on shift_swaps
  for each row execute function reject_if_subscription_expired();

-- Who decides a request that needs approval: the requester's manager and department head, anyone named for
-- Crew assignments (Approvers & Responsibilities); HR when nobody is set. Never the two people swapping.
create function swap_approver_ids(p_id uuid) returns uuid[]
  language plpgsql stable security definer set search_path = public as
$$ declare r shift_swaps; out uuid[] := '{}'; d jsonb; mgr uuid; head uuid;
begin
  select * into r from shift_swaps where id = p_id;
  if not found then return null; end if;
  select m.manager_id, dp.head_user_id into mgr, head
    from company_members m left join departments dp on dp.id = m.department_id
    where m.company_id = r.company_id and m.user_id = r.requester;
  select coalesce(settings->'8_approvers_and_responsibilities'->'duties'->'crew_assign', '{}'::jsonb) into d
    from companies where id = r.company_id;
  out := array_remove(array[mgr, head], null)
      || array(select (x)::uuid from jsonb_array_elements_text(coalesce(d->'people', '[]'::jsonb)) x)
      || array(select (d->>'backup')::uuid where nullif(d->>'backup', '') is not null);
  out := array(select distinct u from unnest(out) u where u <> r.requester and u <> r.partner
               and exists (select 1 from company_members m where m.company_id = r.company_id and m.user_id = u and m.active));
  if cardinality(out) = 0 then
    out := array(select u from unnest(hr_user_ids(r.company_id)) u where u <> r.requester and u <> r.partner);
  end if;
  return out;
end $$;
revoke execute on function swap_approver_ids(uuid) from anon, public;
grant execute on function swap_approver_ids(uuid) to authenticated;

create policy swaps_select on shift_swaps for select to authenticated
  using (requester = auth.uid() or partner = auth.uid() or is_company_hr(company_id)
         or (needs_approval and status <> 'pending_partner' and auth.uid() = any(coalesce(swap_approver_ids(id), '{}'))));
-- Writes only through the RPCs below.

-- 4. Internal: swap the two shifts in the roster (validated like set_roster). Raises if it cannot.
create function swap_apply(p_id uuid) returns void
  language plpgsql security definer set search_path = public as
$$ declare r shift_swaps; a text; b text;
begin
  select * into r from shift_swaps where id = p_id;
  select shift into a from roster_entries where company_id = r.company_id and user_id = r.requester and day = r.day;
  select shift into b from roster_entries where company_id = r.company_id and user_id = r.partner and day = r.day;
  if a is distinct from r.requester_shift or b is distinct from r.partner_shift then
    raise exception 'The roster for % changed after this request, so it cannot be swapped.', to_char(r.day, 'DD Mon');
  end if;
  perform roster_apply(r.company_id, jsonb_build_array(
    jsonb_build_object('u', r.requester, 'd', r.day, 's', r.partner_shift),
    jsonb_build_object('u', r.partner, 'd', r.day, 's', r.requester_shift)));
end $$;
revoke execute on function swap_apply(uuid) from anon, public, authenticated;

create function swap_name(p_user uuid) returns text
  language sql stable security definer set search_path = public as
$$ select coalesce(p.full_name, split_part(p.email, '@', 1), 'Someone') from profiles p where p.id = p_user $$;
revoke execute on function swap_name(uuid) from anon, public, authenticated;

-- 5. RPCs
create function request_shift_swap(p_company uuid, p_partner uuid, p_day date, p_reason text default null) returns shift_swaps
  language plpgsql security definer set search_path = public as
$$ declare rules jsonb; a text; b text; r shift_swaps; tz text; today date;
begin
  if not exists (select 1 from company_members where company_id = p_company and user_id = auth.uid() and active) then
    raise exception 'Only active staff can request a shift swap.'; end if;
  rules := swap_rules(p_company);
  if not (rules->>'enabled')::boolean then raise exception 'Shift swaps are switched off (see Shift Swap Rules).'; end if;
  if p_partner is null or p_partner = auth.uid() then raise exception 'Choose a colleague to swap with.'; end if;
  if not exists (select 1 from company_members where company_id = p_company and user_id = p_partner and active) then
    raise exception 'That person is not an active member of the company.'; end if;
  tz := company_tz(p_company); today := (now() at time zone tz)::date;
  if p_day is null or p_day < today then raise exception 'Choose today or a later day.'; end if;
  if (rules->>'notice_hours')::int > 0 and
     (p_day::text || ' 00:00')::timestamp at time zone tz < now() + make_interval(hours => (rules->>'notice_hours')::int) then
    raise exception 'Swaps need at least % hours notice.', rules->>'notice_hours'; end if;
  select shift into a from roster_entries where company_id = p_company and user_id = auth.uid() and day = p_day;
  select shift into b from roster_entries where company_id = p_company and user_id = p_partner and day = p_day;
  if a is null then raise exception 'You have no shift on %.', to_char(p_day, 'DD Mon'); end if;
  if b is null then raise exception '% has no shift on %.', swap_name(p_partner), to_char(p_day, 'DD Mon'); end if;
  if a = b then raise exception 'You both have the same shift (%) on %, so there is nothing to swap.', a, to_char(p_day, 'DD Mon'); end if;
  if a in ('L', 'TRN') or b in ('L', 'TRN') then raise exception 'Leave and training days cannot be swapped.'; end if;
  if exists (select 1 from shift_swaps where company_id = p_company and requester = auth.uid() and day = p_day
             and status in ('pending_partner', 'pending_approval')) then
    raise exception 'You already have an open swap request for %.', to_char(p_day, 'DD Mon'); end if;
  insert into shift_swaps (company_id, requester, partner, day, requester_shift, partner_shift, reason, needs_approval)
    values (p_company, auth.uid(), p_partner, p_day, a, b, nullif(left(btrim(p_reason), 200), ''), (rules->>'hod')::boolean)
    returning * into r;
  perform notify_user(p_company, p_partner, 'swap_request', 'req', 'shift_swap', r.id::text,
    swap_name(auth.uid()) || ' asks to swap shifts', to_char(p_day, 'DD Mon') || ': you ' || b || ' -> ' || a || ', them ' || a || ' -> ' || b);
  insert into company_audit (company_id, actor, action, detail) values (p_company, auth.uid(), 'swap_requested', r.id::text);
  return r;
end $$;
revoke execute on function request_shift_swap(uuid, uuid, date, text) from anon, public;
grant execute on function request_shift_swap(uuid, uuid, date, text) to authenticated;

create function respond_shift_swap(p_id uuid, p_accept boolean, p_note text default null) returns shift_swaps
  language plpgsql security definer set search_path = public as
$$ declare r shift_swaps; ttl text;
begin
  select * into r from shift_swaps where id = p_id for update;
  if not found then raise exception 'Swap request not found.'; end if;
  if r.partner <> auth.uid() then raise exception 'Only the colleague asked to swap can answer this request.'; end if;
  if r.status <> 'pending_partner' then raise exception 'This request was already answered or closed.'; end if;
  ttl := 'Shift swap ' || to_char(r.day, 'DD Mon');
  if not p_accept then
    update shift_swaps set status = 'declined', partner_responded_at = now(), partner_note = nullif(left(btrim(p_note), 200), '')
      where id = p_id returning * into r;
    perform notify_user(r.company_id, r.requester, 'swap_result', 'dec', 'shift_swap', r.id::text, ttl || ' declined', swap_name(r.partner) || ' declined.');
    return r;
  end if;
  if r.needs_approval then
    update shift_swaps set status = 'pending_approval', partner_responded_at = now(), partner_note = nullif(left(btrim(p_note), 200), '')
      where id = p_id returning * into r;
    perform notify_many(r.company_id, swap_approver_ids(r.id), 'swap_approval', 'appr', 'shift_swap', r.id::text,
      'Shift swap needs approval', swap_name(r.requester) || ' and ' || swap_name(r.partner) || ' on ' || to_char(r.day, 'DD Mon') || ' (' || r.requester_shift || ' / ' || r.partner_shift || ')');
    perform notify_user(r.company_id, r.requester, 'swap_result', 'acc', 'shift_swap', r.id::text, ttl || ' accepted', swap_name(r.partner) || ' accepted. Waiting for approval.');
  else
    perform swap_apply(r.id);   -- raises with the roster rule that stops it; the request stays open
    update shift_swaps set status = 'approved', partner_responded_at = now(), partner_note = nullif(left(btrim(p_note), 200), ''),
      decided_at = now() where id = p_id returning * into r;
    perform notify_many(r.company_id, array[r.requester, r.partner], 'swap_result', 'done', 'shift_swap', r.id::text,
      ttl || ' done', 'Your roster has been updated.');
  end if;
  insert into company_audit (company_id, actor, action, detail) values (r.company_id, auth.uid(), 'swap_answered', r.id::text);
  return r;
end $$;
revoke execute on function respond_shift_swap(uuid, boolean, text) from anon, public;
grant execute on function respond_shift_swap(uuid, boolean, text) to authenticated;

create function decide_shift_swap(p_id uuid, p_approve boolean, p_note text default null) returns shift_swaps
  language plpgsql security definer set search_path = public as
$$ declare r shift_swaps; ttl text;
begin
  select * into r from shift_swaps where id = p_id for update;
  if not found then raise exception 'Swap request not found.'; end if;
  if r.status <> 'pending_approval' then raise exception 'This request is not waiting for approval.'; end if;
  if not (auth.uid() = any(coalesce(swap_approver_ids(p_id), '{}')) or is_company_hr(r.company_id)) then
    raise exception 'Only the approvers for this swap (or HR) can decide it.'; end if;
  if auth.uid() in (r.requester, r.partner) and not is_platform_admin() then
    raise exception 'You cannot approve your own swap.'; end if;
  ttl := 'Shift swap ' || to_char(r.day, 'DD Mon');
  if p_approve then
    perform swap_apply(p_id);
    update shift_swaps set status = 'approved', decided_by = auth.uid(), decided_at = now(),
      decision_note = nullif(left(btrim(p_note), 200), '') where id = p_id returning * into r;
    perform notify_many(r.company_id, array[r.requester, r.partner], 'swap_result', 'done', 'shift_swap', r.id::text, ttl || ' approved', 'Your roster has been updated.');
  else
    update shift_swaps set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
      decision_note = nullif(left(btrim(p_note), 200), '') where id = p_id returning * into r;
    perform notify_many(r.company_id, array[r.requester, r.partner], 'swap_result', 'rej', 'shift_swap', r.id::text, ttl || ' not approved', coalesce(r.decision_note, 'The request was rejected.'));
  end if;
  insert into company_audit (company_id, actor, action, detail)
    values (r.company_id, auth.uid(), case when p_approve then 'swap_approved' else 'swap_rejected' end, r.id::text);
  return r;
end $$;
revoke execute on function decide_shift_swap(uuid, boolean, text) from anon, public;
grant execute on function decide_shift_swap(uuid, boolean, text) to authenticated;

create function cancel_shift_swap(p_id uuid) returns shift_swaps
  language plpgsql security definer set search_path = public as
$$ declare r shift_swaps;
begin
  select * into r from shift_swaps where id = p_id for update;
  if not found then raise exception 'Swap request not found.'; end if;
  if r.requester <> auth.uid() then raise exception 'Only the person who asked can cancel.'; end if;
  if r.status not in ('pending_partner', 'pending_approval') then raise exception 'This request is already closed.'; end if;
  update shift_swaps set status = 'cancelled' where id = p_id returning * into r;
  return r;
end $$;
revoke execute on function cancel_shift_swap(uuid) from anon, public;
grant execute on function cancel_shift_swap(uuid) to authenticated;

-- 6. What the app lists: my requests, requests waiting for my answer, requests waiting for my approval.
create function my_shift_swaps(p_company uuid) returns jsonb
  language sql stable security definer set search_path = public as
$$ select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) from (
     select jsonb_build_object('id', s.id, 'day', s.day, 'status', s.status, 'needs_approval', s.needs_approval,
       'requester', s.requester, 'requester_name', swap_name(s.requester), 'requester_shift', s.requester_shift,
       'partner', s.partner, 'partner_name', swap_name(s.partner), 'partner_shift', s.partner_shift,
       'reason', s.reason, 'partner_note', s.partner_note, 'decision_note', s.decision_note, 'created_at', s.created_at,
       'role', case when s.requester = auth.uid() then 'requester'
                    when s.partner = auth.uid() then 'partner' else 'approver' end,
       'can_approve', s.status = 'pending_approval' and s.requester <> auth.uid() and s.partner <> auth.uid()
                      and (auth.uid() = any(coalesce(swap_approver_ids(s.id), '{}')) or is_company_hr(s.company_id))) as x
     from shift_swaps s
     where s.company_id = p_company and s.created_at > now() - interval '60 days'
       and (s.requester = auth.uid() or s.partner = auth.uid()
            or (s.status = 'pending_approval' and (auth.uid() = any(coalesce(swap_approver_ids(s.id), '{}')) or is_company_hr(s.company_id))))
   ) q $$;
revoke execute on function my_shift_swaps(uuid) from anon, public;
grant execute on function my_shift_swaps(uuid) to authenticated;

-- Colleagues with a shift on a day, for the "swap with" picker (names + their shift; nothing private).
create function swap_candidates(p_company uuid, p_day date) returns jsonb
  language sql stable security definer set search_path = public as
$$ select case when not is_company_member(p_company) then '[]'::jsonb else coalesce(jsonb_agg(jsonb_build_object(
       'user_id', m.user_id, 'name', swap_name(m.user_id), 'shift', r.shift) order by swap_name(m.user_id)), '[]'::jsonb) end
   from company_members m join roster_entries r on r.company_id = m.company_id and r.user_id = m.user_id and r.day = p_day
   where m.company_id = p_company and m.active and m.user_id <> auth.uid() and r.shift not in ('L', 'TRN') $$;
revoke execute on function swap_candidates(uuid, date) from anon, public;
grant execute on function swap_candidates(uuid, date) to authenticated;
