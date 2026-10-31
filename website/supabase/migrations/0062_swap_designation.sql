-- 0062: Shift swap rule "Swap with" (HR Settings -> Shift Swap Rules -> scope): Anyone / Same designation / Same crew group.
-- The colleague picker in the app is filtered by it and request_shift_swap enforces it. Designation = the person's job title.

create function swap_title(p_company uuid, p_user uuid) returns text
  language sql stable security definer set search_path = public as
$$ select coalesce(jt.title, '') from company_members m left join job_titles jt on jt.id = m.job_title_id
   where m.company_id = p_company and m.user_id = p_user $$;
revoke execute on function swap_title(uuid, uuid) from anon, public, authenticated;

create function swap_same_group(p_company uuid, p_a uuid, p_b uuid, p_scope text) returns boolean
  language sql stable security definer set search_path = public as
$$ select case coalesce(p_scope, 'Anyone')
    when 'Same designation' then (select a.job_title_id is not distinct from b.job_title_id
        from company_members a, company_members b
        where a.company_id = p_company and a.user_id = p_a and b.company_id = p_company and b.user_id = p_b)
    when 'Same crew group' then member_crew_group(p_company, p_a) = member_crew_group(p_company, p_b)
    else true end $$;
revoke execute on function swap_same_group(uuid, uuid, uuid, text) from anon, public, authenticated;

create or replace function swap_rules(p_company uuid) returns jsonb
  language sql stable security definer set search_path = public as
$$ select jsonb_build_object(
     'enabled', coalesce((settings->'8_shift_swap_rules'->>'enabled')::boolean, true),
     'hod', coalesce((settings->'8_shift_swap_rules'->>'hod')::boolean, true),
     'scope', coalesce(nullif(settings->'8_shift_swap_rules'->>'scope', ''), 'Anyone'),
     'notice_hours', coalesce(nullif(settings->'8_shift_swap_rules'->>'notice', '')::int, 0))
   from companies where id = p_company $$;
create or replace function request_shift_swap(p_company uuid, p_partner uuid, p_day date, p_reason text default null) returns shift_swaps
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
  if not swap_same_group(p_company, auth.uid(), p_partner, rules->>'scope') then
    raise exception '%', case rules->>'scope'
      when 'Same designation' then 'You can only swap with staff who have your designation (see Shift Swap Rules).'
      else 'You can only swap with staff in your crew group (see Shift Swap Rules).' end;
  end if;
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

create or replace function my_shift_swaps(p_company uuid) returns jsonb
  language sql stable security definer set search_path = public as
$$ select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) from (
     select jsonb_build_object('id', s.id, 'day', s.day, 'status', s.status, 'needs_approval', s.needs_approval,
       'requester', s.requester, 'requester_name', swap_name(s.requester), 'requester_shift', s.requester_shift,
       'partner', s.partner, 'partner_name', swap_name(s.partner), 'partner_shift', s.partner_shift,
       'requester_title', swap_title(s.company_id, s.requester), 'partner_title', swap_title(s.company_id, s.partner),
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

create or replace function swap_candidates(p_company uuid, p_day date) returns jsonb
  language sql stable security definer set search_path = public as
$$ select case when not is_company_member(p_company) then '[]'::jsonb else coalesce(jsonb_agg(jsonb_build_object(
       'user_id', m.user_id, 'name', swap_name(m.user_id), 'shift', r.shift,
       'designation', swap_title(p_company, m.user_id)) order by swap_name(m.user_id)), '[]'::jsonb) end
   from company_members m join roster_entries r on r.company_id = m.company_id and r.user_id = m.user_id and r.day = p_day
   where m.company_id = p_company and m.active and m.user_id <> auth.uid() and r.shift not in ('L', 'TRN')
     and swap_same_group(p_company, auth.uid(), m.user_id, swap_rules(p_company)->>'scope') $$;
