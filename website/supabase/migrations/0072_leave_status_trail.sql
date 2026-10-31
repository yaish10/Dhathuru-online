-- The story of one leave request, for the apps' detail sheet: who filed it and when, then either who it is waiting for
-- or who decided it, when, and what they wrote. Read-only; decisions still go through decide_leave.
-- Visible to the person who filed it, HR, and the approvers the request is routed to.

create function leave_trail(p_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare r leave_requests; w jsonb; steps jsonb; ids uuid[]; label text;
begin
  select * into r from leave_requests where id = p_id;
  if not found or not (r.user_id = auth.uid() or is_company_hr(r.company_id)
                       or auth.uid() = any(coalesce(leave_approver_ids(p_id), '{}'::uuid[]))) then
    raise exception 'Leave request not found.';
  end if;
  steps := jsonb_build_array(jsonb_build_object('state', 'done', 'title', 'Submitted', 'name', swap_name(r.user_id),
    'no', (select m.employee_no::text from company_members m where m.company_id = r.company_id and m.user_id = r.user_id), 'at', r.created_at));
  if r.status = 'Pending' then
    ids := coalesce(leave_approver_ids(p_id), '{}'::uuid[]);
    if array_length(ids, 1) > 0 then
      steps := steps || coalesce((select jsonb_agg(jsonb_build_object('state', 'waiting', 'title', 'Waiting for approval', 'name', swap_name(u),
        'no', (select m.employee_no::text from company_members m where m.company_id = r.company_id and m.user_id = u)) order by swap_name(u))
        from unnest(ids) u), '[]'::jsonb);
    else
      select settings->'8_leave_approval_workflow' into w from companies where id = r.company_id;
      label := coalesce(nullif(w->>'approver', ''), 'HR');
      steps := steps || jsonb_build_array(jsonb_build_object('state', 'waiting', 'title', 'Waiting for approval', 'name', label || ' team'));
    end if;
  else
    steps := steps || jsonb_build_array(jsonb_build_object('state', lower(r.status), 'title', r.status,
      'name', case when r.decided_by is null then 'Approved automatically' else swap_name(r.decided_by) end,
      'no', (select m.employee_no::text from company_members m where m.company_id = r.company_id and m.user_id = r.decided_by),
      'at', r.decided_at, 'note', r.decision_note));
  end if;
  return jsonb_build_object('status', lower(r.status), 'steps', steps);
end $$;
revoke execute on function leave_trail(uuid) from anon, public;
grant execute on function leave_trail(uuid) to authenticated;
