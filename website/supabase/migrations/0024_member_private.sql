-- Private employee details. Every member can read company_members (the directory), so phone numbers,
-- emergency contacts and the reason for a status change move to their own table that only HR and the
-- person themselves can read. (The columns added in 0023 were empty when this ran.)

create table member_private (
  company_id        uuid not null,
  user_id           uuid not null,
  phone             text check (phone is null or char_length(phone) <= 40),
  emergency_contact text check (emergency_contact is null or char_length(emergency_contact) <= 120),
  status_reason     text check (status_reason is null or char_length(status_reason) <= 200),
  updated_at        timestamptz not null default now(),
  primary key (company_id, user_id),
  foreign key (company_id, user_id) references company_members (company_id, user_id) on delete cascade
);
alter table member_private enable row level security;
create policy member_private_select on member_private for select to authenticated
  using (is_company_hr(company_id) or user_id = auth.uid());
-- No insert/update/delete policies: changes go through set_member_profile() and set_member_status().

-- Status changes no longer read end_reason from company_members; the reason is passed in for the history line.
create or replace function member_events() returns trigger
  language plpgsql security definer set search_path = public as
$$ declare a text; b text; why text;
begin
  if tg_op = 'INSERT' then
    perform log_employee_event(new.company_id, new.user_id, 'joined', 'Joined the company as ' || new.role);
    return new;
  end if;
  if new.job_title_id is distinct from old.job_title_id then
    select title into b from job_titles where id = new.job_title_id;
    perform log_employee_event(new.company_id, new.user_id, 'designation', 'Designation changed to ' || coalesce(b, 'none'));
  end if;
  if new.department_id is distinct from old.department_id then
    select name into b from departments where id = new.department_id;
    perform log_employee_event(new.company_id, new.user_id, 'department', 'Department changed to ' || coalesce(b, 'none'));
  end if;
  if new.employment_type is distinct from old.employment_type then
    perform log_employee_event(new.company_id, new.user_id, 'employment', 'Employment type changed to ' || coalesce(new.employment_type, 'none'));
  end if;
  if new.employment_status is distinct from old.employment_status then
    why := nullif(current_setting('veyora.status_reason', true), '');
    perform log_employee_event(new.company_id, new.user_id, 'status', 'Status changed to ' || new.employment_status ||
      case when new.employment_status = 'Former' and new.end_date is not null then ' (left ' || to_char(new.end_date, 'DD Mon YYYY') || ')' else '' end ||
      case when why is not null and new.employment_status <> 'Active' then ': ' || why else '' end);
  end if;
  if new.assigned_vessel is distinct from old.assigned_vessel then
    perform log_employee_event(new.company_id, new.user_id, 'vessel', case when new.assigned_vessel is null then 'Removed from vessel ' || coalesce(old.assigned_vessel, '') else 'Assigned to vessel ' || new.assigned_vessel end);
  end if;
  if new.role is distinct from old.role then
    perform log_employee_event(new.company_id, new.user_id, 'role', 'Access role changed to ' || new.role);
  end if;
  if new.manager_id is distinct from old.manager_id then
    select coalesce(p.full_name, split_part(p.email, '@', 1)) into b from profiles p where p.id = new.manager_id;
    perform log_employee_event(new.company_id, new.user_id, 'manager', 'Reports to ' || coalesce(b, 'nobody'));
  end if;
  if new.start_date is distinct from old.start_date or new.probation_end is distinct from old.probation_end or new.contract_end is distinct from old.contract_end then
    a := concat_ws(' · ',
      case when new.start_date is distinct from old.start_date then 'joining date ' || coalesce(to_char(new.start_date, 'DD Mon YYYY'), 'cleared') end,
      case when new.probation_end is distinct from old.probation_end then 'probation ends ' || coalesce(to_char(new.probation_end, 'DD Mon YYYY'), 'cleared') end,
      case when new.contract_end is distinct from old.contract_end then 'contract ends ' || coalesce(to_char(new.contract_end, 'DD Mon YYYY'), 'cleared') end);
    perform log_employee_event(new.company_id, new.user_id, 'dates', 'Employment dates: ' || a);
  end if;
  return new;
end $$;

alter table company_members drop column phone, drop column emergency_contact, drop column end_reason;

create or replace function set_member_profile(p_company uuid, p_user uuid, p_patch jsonb) returns void
  language plpgsql security definer set search_path = public as
$$ declare hr boolean := is_company_hr(p_company);
begin
  if not (hr or p_user = auth.uid()) then raise exception 'Only HR can change someone else''s details.'; end if;
  if not exists (select 1 from company_members where company_id = p_company and user_id = p_user) then
    raise exception 'That person is not in this company.'; end if;
  if p_patch ? 'phone' or p_patch ? 'emergency_contact' then
    insert into member_private (company_id, user_id) values (p_company, p_user) on conflict do nothing;
    if p_patch ? 'phone' then
      update member_private set phone = nullif(left(btrim(p_patch->>'phone'), 40), ''), updated_at = now() where company_id = p_company and user_id = p_user; end if;
    if p_patch ? 'emergency_contact' then
      update member_private set emergency_contact = nullif(left(btrim(p_patch->>'emergency_contact'), 120), ''), updated_at = now() where company_id = p_company and user_id = p_user; end if;
  end if;
  if (p_patch ? 'probation_end' or p_patch ? 'contract_end') and not hr then
    raise exception 'Only HR can change contract dates.'; end if;
  if p_patch ? 'probation_end' then
    update company_members set probation_end = nullif(p_patch->>'probation_end', '')::date where company_id = p_company and user_id = p_user; end if;
  if p_patch ? 'contract_end' then
    update company_members set contract_end = nullif(p_patch->>'contract_end', '')::date where company_id = p_company and user_id = p_user; end if;
end $$;

create or replace function set_member_status(p_company uuid, p_user uuid, p_status text, p_end_date date default null, p_reason text default null) returns integer
  language plpgsql security definer set search_path = public as
$$ declare v_role member_role; n integer := 0; why text := nullif(left(btrim(coalesce(p_reason, '')), 200), '');
begin
  if not is_company_hr(p_company) then raise exception 'Only HR, owners and admins can change someone''s status.'; end if;
  if p_status not in ('Active', 'Suspended', 'Former') then raise exception 'Unknown status.'; end if;
  select role into v_role from company_members where company_id = p_company and user_id = p_user;
  if not found then raise exception 'That person is not in this company.'; end if;
  if v_role = 'owner' then raise exception 'The company owner''s status cannot be changed.'; end if;
  if p_user = auth.uid() then raise exception 'You cannot change your own status.'; end if;
  perform set_config('veyora.status_reason', coalesce(why, ''), true);
  insert into member_private (company_id, user_id) values (p_company, p_user) on conflict do nothing;
  update member_private set status_reason = case when p_status = 'Active' then null else why end, updated_at = now()
    where company_id = p_company and user_id = p_user;
  if p_status = 'Former' then
    update company_members set employment_status = 'Former', active = false, assigned_vessel = null, duty_status = 'Off duty',
      end_date = coalesce(p_end_date, current_date)
      where company_id = p_company and user_id = p_user;
    delete from roster_entries where company_id = p_company and user_id = p_user and day > coalesce(p_end_date, current_date);
    get diagnostics n = row_count;
  elsif p_status = 'Suspended' then
    update company_members set employment_status = 'Suspended', active = true, assigned_vessel = null, duty_status = 'Off duty'
      where company_id = p_company and user_id = p_user;
  else
    update company_members set employment_status = 'Active', active = true, end_date = null
      where company_id = p_company and user_id = p_user;
  end if;
  insert into company_audit (company_id, actor, action, detail) values (p_company, auth.uid(), 'member_status_changed', p_user::text || ' ' || p_status);
  return n;
end $$;
