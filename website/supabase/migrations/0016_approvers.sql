-- Named approvers. Setting 8_approvers_and_responsibilities:
--   { leave: { useManager: bool, routes: [{ applies: 'All staff' | 'Group:<crew group>' | 'Dept:<uuid>', approvers: [uuid] }], fallback: [uuid] },
--     duties: { <key>: { people: [uuid], backup: uuid } } }
-- Leave goes to the first matching route (plus the person's reporting manager when useManager is on),
-- otherwise to the fallback people. If nobody is configured, the role rule from 0014 still applies.

create function leave_approver_ids(p_id uuid) returns uuid[]
  language plpgsql stable security definer set search_path = public as
$$ declare
  r leave_requests; cfg jsonb; route jsonb; grp text; dept uuid; mgr uuid; out uuid[] := '{}'; matched boolean := false;
begin
  select * into r from leave_requests where id = p_id;
  if not found then return null; end if;
  select settings->'8_approvers_and_responsibilities'->'leave' into cfg from companies where id = r.company_id;
  if cfg is null then return null; end if;
  select jt.crew_group, m.department_id, m.manager_id into grp, dept, mgr
    from company_members m left join job_titles jt on jt.id = m.job_title_id
    where m.company_id = r.company_id and m.user_id = r.user_id;
  if coalesce((cfg->>'useManager')::boolean, false) and mgr is not null then out := array[mgr]; end if;
  for route in select * from jsonb_array_elements(coalesce(cfg->'routes', '[]'::jsonb)) loop
    if route->>'applies' = 'All staff'
       or (route->>'applies' = 'Group:' || coalesce(grp, '-'))
       or (dept is not null and route->>'applies' = 'Dept:' || dept::text) then
      out := out || array(select (x)::uuid from jsonb_array_elements_text(coalesce(route->'approvers', '[]'::jsonb)) x);
      matched := true;
      exit;
    end if;
  end loop;
  if not matched then
    out := out || array(select (x)::uuid from jsonb_array_elements_text(coalesce(cfg->'fallback', '[]'::jsonb)) x);
  end if;
  -- Only active members of the company count, and never the requester themselves.
  out := array(select distinct u from unnest(out) u
               where u <> r.user_id and exists (select 1 from company_members m where m.company_id = r.company_id and m.user_id = u and m.active));
  return out;
end $$;
revoke execute on function leave_approver_ids(uuid) from anon, public;
grant execute on function leave_approver_ids(uuid) to authenticated;

-- Approvers can see the requests routed to them.
drop policy leave_select on leave_requests;
create policy leave_select on leave_requests for select to authenticated
  using (is_company_hr(company_id) or user_id = auth.uid() or auth.uid() = any(coalesce(leave_approver_ids(id), '{}')));

create or replace function decide_leave(p_id uuid, p_approve boolean, p_note text default null) returns void
  language plpgsql security definer set search_path = public as
$$ declare r leave_requests; w jsonb; v_role member_role; v_appr text; v_ok boolean; v_named uuid[];
begin
  select * into r from leave_requests where id = p_id;
  if not found then raise exception 'Leave request not found.'; end if;
  if r.status <> 'Pending' then raise exception 'That request has already been decided.'; end if;
  select settings->'8_leave_approval_workflow' into w from companies where id = r.company_id;
  if r.user_id = auth.uid() and not coalesce((w->>'self')::boolean, false) then
    raise exception 'You cannot approve or reject your own leave (see Leave Approval Workflow).';
  end if;
  if coalesce((w->>'comment')::boolean, false) and coalesce(btrim(p_note), '') = '' then
    raise exception 'A comment is required for leave decisions.';
  end if;
  select role into v_role from company_members where company_id = r.company_id and user_id = auth.uid() and active;
  v_named := leave_approver_ids(p_id);
  if is_platform_admin() or v_role = 'owner' then
    v_ok := true;                                   -- the owner and platform owner can always step in
  elsif v_named is not null and array_length(v_named, 1) > 0 then
    v_ok := auth.uid() = any(v_named);              -- named approvers decide
    if not v_ok then raise exception 'This request is routed to its named approvers (see Approvers & Responsibilities).'; end if;
  else
    if not is_company_hr(r.company_id) then raise exception 'Only HR, owners and admins can decide leave.'; end if;
    v_appr := coalesce(w->>'approver', 'HR');
    v_ok := case v_appr
      when 'Owner' then v_role = 'owner'
      when 'Admin' then v_role in ('owner', 'admin')
      when 'HR' then v_role in ('owner', 'admin', 'hr')
      when 'Operations' then v_role in ('owner', 'admin', 'operations')
      else v_role in ('owner', 'admin') end;
    if not coalesce(v_ok, false) then raise exception 'Only the % role can decide leave (see Leave Approval Workflow).', v_appr; end if;
  end if;
  update leave_requests set status = case when p_approve then 'Approved' else 'Rejected' end,
    decided_by = auth.uid(), decided_at = now(), decision_note = nullif(left(btrim(p_note), 200), '') where id = p_id;
  if p_approve and current_date between r.start_date and r.end_date then
    update company_members set duty_status = 'On leave' where company_id = r.company_id and user_id = r.user_id;
  end if;
  insert into company_audit (company_id, actor, action, detail)
    values (r.company_id, auth.uid(), case when p_approve then 'leave_approved' else 'leave_rejected' end, r.user_id::text);
end $$;
