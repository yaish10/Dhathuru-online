-- HR can assign a person's designation (job title) from the HR & Crew page.
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
  if p_patch ? 'job_title_id' then
    if p_patch->>'job_title_id' is not null and not exists (select 1 from job_titles where id = (p_patch->>'job_title_id')::uuid and company_id = p_company) then
      raise exception 'Unknown designation.'; end if;
    update company_members set job_title_id = (p_patch->>'job_title_id')::uuid where company_id = p_company and user_id = p_user;
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
