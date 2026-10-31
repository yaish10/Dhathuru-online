-- One list of everything waiting for the signed-in person's decision (leave, shift swaps, attendance corrections),
-- plus what they decided in the last 30 days. Decisions still go through decide_leave, decide_shift_swap and
-- decide_attendance_correction, so every existing rule applies unchanged. This only decides what is shown.

-- Mirrors who decide_leave lets through, without raising: the platform owner and company owner, the named approvers when
-- the request has any, otherwise the role set in Leave Approval Workflow. Never your own leave unless that is allowed.
create function leave_can_decide(p_id uuid) returns boolean
  language plpgsql stable security definer set search_path = public as
$$ declare r leave_requests; w jsonb; v_role member_role; v_named uuid[]; v_appr text;
begin
  select * into r from leave_requests where id = p_id;
  if not found or r.status <> 'Pending' then return false; end if;
  select settings->'8_leave_approval_workflow' into w from companies where id = r.company_id;
  if r.user_id = auth.uid() and not coalesce((w->>'self')::boolean, false) then return false; end if;
  select role into v_role from company_members where company_id = r.company_id and user_id = auth.uid() and active;
  if is_platform_admin() or v_role = 'owner' then return true; end if;
  if v_role is null then return false; end if;
  v_named := leave_approver_ids(p_id);
  if v_named is not null and array_length(v_named, 1) > 0 then return auth.uid() = any(v_named); end if;
  if not is_company_hr(r.company_id) then return false; end if;
  v_appr := coalesce(w->>'approver', 'HR');
  return coalesce(case v_appr
    when 'Owner' then v_role = 'owner'
    when 'Admin' then v_role in ('owner', 'admin')
    when 'HR' then v_role in ('owner', 'admin', 'hr')
    when 'Operations' then v_role in ('owner', 'admin', 'operations')
    else v_role in ('owner', 'admin') end, false);
end $$;
revoke execute on function leave_can_decide(uuid) from anon, public, authenticated;

create function my_approvals(p_company uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare w jsonb; pend jsonb; done_ jsonb;
begin
  if not is_company_member(p_company) then raise exception 'Not a member of this company.'; end if;
  select settings->'8_leave_approval_workflow' into w from companies where id = p_company;

  select coalesce(jsonb_agg(x order by x->>'created_at'), '[]'::jsonb) into pend from (
    select jsonb_build_object('kind', 'leave', 'id', l.id, 'requester_id', l.user_id, 'requester', swap_name(l.user_id),
             'designation', swap_title(l.company_id, l.user_id), 'title', l.leave_type, 'start', l.start_date, 'end', l.end_date,
             'days', l.end_date - l.start_date + 1, 'note', l.note, 'created_at', l.created_at) as x
      from leave_requests l where l.company_id = p_company and l.status = 'Pending' and leave_can_decide(l.id)
    union all
    select jsonb_build_object('kind', 'swap', 'id', s.id, 'requester_id', s.requester, 'requester', swap_name(s.requester),
             'designation', swap_title(s.company_id, s.requester), 'title', 'Shift swap', 'day', s.day,
             'requester_shift', s.requester_shift, 'partner', swap_name(s.partner), 'partner_shift', s.partner_shift,
             'note', s.reason, 'partner_note', s.partner_note, 'created_at', s.created_at)
      from shift_swaps s
      where s.company_id = p_company and s.status = 'pending_approval' and s.requester <> auth.uid() and s.partner <> auth.uid()
        and (auth.uid() = any(coalesce(swap_approver_ids(s.id), '{}')) or is_company_hr(s.company_id))
    union all
    select jsonb_build_object('kind', 'attendance', 'id', c.id, 'requester_id', c.user_id, 'requester', swap_name(c.user_id),
             'designation', swap_title(c.company_id, c.user_id), 'title', 'Attendance correction', 'day', c.day,
             'clock_in', c.clock_in, 'clock_out', c.clock_out, 'proposed_status', c.status, 'note', c.reason, 'created_at', c.created_at)
      from attendance_corrections c
      where c.company_id = p_company and c.status_now = 'Pending' and is_company_hr(c.company_id)
  ) q;

  select coalesce(jsonb_agg(x order by x->>'decided_at' desc), '[]'::jsonb) into done_ from (
    select jsonb_build_object('kind', 'leave', 'id', l.id, 'requester', swap_name(l.user_id), 'designation', swap_title(l.company_id, l.user_id),
             'title', l.leave_type, 'start', l.start_date, 'end', l.end_date, 'days', l.end_date - l.start_date + 1, 'note', l.note,
             'status', lower(l.status), 'decided_at', l.decided_at, 'decision_note', l.decision_note, 'created_at', l.created_at) as x
      from leave_requests l where l.company_id = p_company and l.decided_by = auth.uid() and l.decided_at > now() - interval '30 days'
    union all
    select jsonb_build_object('kind', 'swap', 'id', s.id, 'requester', swap_name(s.requester), 'designation', swap_title(s.company_id, s.requester),
             'title', 'Shift swap', 'day', s.day, 'requester_shift', s.requester_shift, 'partner', swap_name(s.partner), 'partner_shift', s.partner_shift,
             'note', s.reason, 'status', s.status, 'decided_at', s.decided_at, 'decision_note', s.decision_note, 'created_at', s.created_at)
      from shift_swaps s where s.company_id = p_company and s.decided_by = auth.uid() and s.decided_at > now() - interval '30 days'
    union all
    select jsonb_build_object('kind', 'attendance', 'id', c.id, 'requester', swap_name(c.user_id), 'designation', swap_title(c.company_id, c.user_id),
             'title', 'Attendance correction', 'day', c.day, 'clock_in', c.clock_in, 'clock_out', c.clock_out, 'proposed_status', c.status,
             'note', c.reason, 'status', lower(c.status_now), 'decided_at', c.decided_at, 'created_at', c.created_at)
      from attendance_corrections c where c.company_id = p_company and c.decided_by = auth.uid() and c.decided_at > now() - interval '30 days'
  ) q;

  return jsonb_build_object('comment_required', coalesce((w->>'comment')::boolean, false), 'pending', pend, 'decided', done_);
end $$;
revoke execute on function my_approvals(uuid) from anon, public;
grant execute on function my_approvals(uuid) to authenticated;
