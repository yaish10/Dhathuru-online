-- HR settings wired into the database: designations with crew groups, leave workflow rules,
-- crew assignment rules, and HR staff allowed to manage HR settings.

-- 1. Designations: a job title belongs to a crew group (drives the HR directory tabs).
alter table job_titles add column crew_group text
  check (crew_group is null or crew_group in ('Captain', 'Deck', 'Engineering', 'Shore', 'Other'));

-- HR staff manage designations as well as owners and admins.
drop policy job_titles_insert on job_titles;
drop policy job_titles_update on job_titles;
drop policy job_titles_delete on job_titles;
create policy job_titles_insert on job_titles for insert to authenticated with check (is_company_hr(company_id));
create policy job_titles_update on job_titles for update to authenticated using (is_company_hr(company_id)) with check (is_company_hr(company_id));
create policy job_titles_delete on job_titles for delete to authenticated using (is_company_hr(company_id));

-- 2. HR staff may change HR & Crew settings (keys starting with 8_); everything else stays owner/admin.
create or replace function set_company_setting(p_company uuid, p_key text, p_value jsonb) returns void
  language plpgsql security definer set search_path = public as
$$ begin
  if not (is_company_admin(p_company) or (p_key like '8\_%' and is_company_hr(p_company))) then
    raise exception 'Only owners and admins can change settings.';
  end if;
  if p_key !~ '^[a-z0-9_]{1,60}$' then raise exception 'Invalid setting key.'; end if;
  if pg_column_size(p_value) > 100000 then raise exception 'Setting is too large.'; end if;
  update companies set settings = jsonb_set(coalesce(settings, '{}'::jsonb), array[p_key], p_value, true) where id = p_company;
  insert into company_audit (company_id, actor, action, detail) values (p_company, auth.uid(), 'setting_changed', p_key);
end $$;

-- 3. Leave workflow (setting 8_leave_approval_workflow: enabled, approver, comment, self).
alter table leave_requests add column decision_note text check (decision_note is null or char_length(decision_note) <= 200);

-- When approval is switched off, new requests are approved straight away.
create or replace function leave_requests_new() returns trigger language plpgsql security definer set search_path = public as
$$ declare w jsonb;
begin
  select settings->'8_leave_approval_workflow' into w from companies where id = new.company_id;
  new.decided_by := null; new.decided_at := null; new.decision_note := null;
  if coalesce((w->>'enabled')::boolean, true) then
    new.status := 'Pending';
  else
    new.status := 'Approved'; new.decided_at := now(); new.decision_note := 'Approved automatically (approval is off)';
  end if;
  return new;
end $$;

drop function decide_leave(uuid, boolean);
create function decide_leave(p_id uuid, p_approve boolean, p_note text default null) returns void
  language plpgsql security definer set search_path = public as
$$ declare r leave_requests; w jsonb; v_role member_role; v_appr text; v_ok boolean;
begin
  select * into r from leave_requests where id = p_id;
  if not found then raise exception 'Leave request not found.'; end if;
  if not is_company_hr(r.company_id) then raise exception 'Only HR, owners and admins can decide leave.'; end if;
  if r.status <> 'Pending' then raise exception 'That request has already been decided.'; end if;
  select settings->'8_leave_approval_workflow' into w from companies where id = r.company_id;
  if r.user_id = auth.uid() and not coalesce((w->>'self')::boolean, false) then
    raise exception 'You cannot approve or reject your own leave (see Leave Approval Workflow).';
  end if;
  if coalesce((w->>'comment')::boolean, false) and coalesce(btrim(p_note), '') = '' then
    raise exception 'A comment is required for leave decisions.';
  end if;
  -- Approver role: Owner < Admin < HR/Operations (the platform owner can always decide).
  if not is_platform_admin() then
    select role into v_role from company_members where company_id = r.company_id and user_id = auth.uid() and active;
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
revoke execute on function decide_leave(uuid, boolean, text) from anon, public;
grant execute on function decide_leave(uuid, boolean, text) to authenticated;

-- 4. Crew assignment rule (8_crew_assignment_rules.expired, default on): someone with an expired
--    certificate cannot be put on duty or assigned to a vessel.
create or replace function set_member_hr(p_company uuid, p_user uuid, p_patch jsonb) returns void
  language plpgsql security definer set search_path = public as
$$ declare v_block boolean; v_expired boolean;
begin
  if not is_company_hr(p_company) then raise exception 'Only HR, owners and admins can change this.'; end if;
  if not exists (select 1 from company_members where company_id = p_company and user_id = p_user) then
    raise exception 'That person is not in this company.'; end if;
  select coalesce((settings->'8_crew_assignment_rules'->>'expired')::boolean, true) into v_block from companies where id = p_company;
  select exists (select 1 from staff_certifications where company_id = p_company and user_id = p_user and valid_until < current_date) into v_expired;
  -- Blocked: going on duty, or getting a new (different, non-empty) vessel. Going off duty is always allowed.
  if v_block and v_expired and (
       p_patch->>'duty_status' = 'On duty'
       or (coalesce(btrim(p_patch->>'assigned_vessel'), '') <> ''
           and coalesce(btrim(p_patch->>'assigned_vessel'), '') is distinct from
               coalesce((select assigned_vessel from company_members where company_id = p_company and user_id = p_user), ''))) then
    raise exception 'This person has an expired certificate, so they cannot go on duty or be assigned a vessel (see Crew Assignment Rules).';
  end if;
  if p_patch ? 'duty_status' then
    if p_patch->>'duty_status' not in ('On duty', 'Off duty', 'On leave') then raise exception 'Unknown duty status.'; end if;
    update company_members set duty_status = p_patch->>'duty_status' where company_id = p_company and user_id = p_user;
  end if;
  if p_patch ? 'assigned_vessel' then
    update company_members set assigned_vessel = nullif(left(btrim(p_patch->>'assigned_vessel'), 60), '')
      where company_id = p_company and user_id = p_user;
  end if;
  insert into company_audit (company_id, actor, action, detail) values (p_company, auth.uid(), 'duty_changed', p_user::text);
end $$;
