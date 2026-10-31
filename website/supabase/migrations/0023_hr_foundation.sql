-- HR foundation (phase 1): employee status and contract dates, contact details, certificate issuer/number,
-- an activity history per employee, and one shared crew-availability check used by vessel assignment,
-- the roster and the Crew Management screen.

-- 1. Employee record fields
alter table company_members
  add column employment_status text not null default 'Active' check (employment_status in ('Active', 'Suspended', 'Former')),
  add column phone             text check (phone is null or char_length(phone) <= 40),
  add column emergency_contact text check (emergency_contact is null or char_length(emergency_contact) <= 120),
  add column probation_end     date,
  add column contract_end      date,
  add column end_date          date,
  add column end_reason        text check (end_reason is null or char_length(end_reason) <= 200);

alter table staff_certifications
  add column issuer  text check (issuer is null or char_length(issuer) <= 120),
  add column cert_no text check (cert_no is null or char_length(cert_no) <= 60);

-- 2. Activity history: one row per change to a person's record (written only by triggers below).
create table employee_events (
  id         bigint generated always as identity primary key,
  company_id uuid not null references companies(id) on delete cascade,
  user_id    uuid not null,
  kind       text not null check (char_length(kind) between 2 and 40),
  detail     text not null check (char_length(detail) <= 300),
  actor      uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on employee_events (company_id, user_id, created_at desc);
alter table employee_events enable row level security;
create policy emp_events_select on employee_events for select to authenticated
  using (is_company_hr(company_id) or user_id = auth.uid());

create function log_employee_event(p_company uuid, p_user uuid, p_kind text, p_detail text) returns void
  language sql security definer set search_path = public as
$$ insert into employee_events (company_id, user_id, kind, detail, actor)
   select p_company, p_user, p_kind, left(p_detail, 300), auth.uid()
   where exists (select 1 from companies where id = p_company) $$;
revoke execute on function log_employee_event(uuid, uuid, text, text) from anon, public, authenticated;

create function member_events() returns trigger
  language plpgsql security definer set search_path = public as
$$ declare a text; b text;
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
    perform log_employee_event(new.company_id, new.user_id, 'status', 'Status changed to ' || new.employment_status ||
      case when new.employment_status = 'Former' and new.end_date is not null then ' (left ' || to_char(new.end_date, 'DD Mon YYYY') || ')' else '' end ||
      case when new.end_reason is not null and new.employment_status <> 'Active' then ': ' || new.end_reason else '' end);
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
create trigger company_members_events after insert or update on company_members
  for each row execute function member_events();

create function cert_events() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  if tg_op = 'INSERT' then
    perform log_employee_event(new.company_id, new.user_id, 'qualification', 'Added ' || new.name || coalesce(' (valid until ' || to_char(new.valid_until, 'DD Mon YYYY') || ')', ''));
  elsif tg_op = 'DELETE' then
    perform log_employee_event(old.company_id, old.user_id, 'qualification', 'Removed ' || old.name);
  elsif new.valid_until is distinct from old.valid_until or new.name is distinct from old.name then
    perform log_employee_event(new.company_id, new.user_id, 'qualification', 'Updated ' || new.name || coalesce(' (valid until ' || to_char(new.valid_until, 'DD Mon YYYY') || ')', ''));
  end if;
  return coalesce(new, old);
end $$;
create trigger staff_certifications_events after insert or update or delete on staff_certifications
  for each row execute function cert_events();

create function leave_events() returns trigger
  language plpgsql security definer set search_path = public as
$$ declare span text;
begin
  span := new.leave_type || ' ' || to_char(new.start_date, 'DD Mon') || case when new.end_date <> new.start_date then ' – ' || to_char(new.end_date, 'DD Mon YYYY') else ' ' || to_char(new.start_date, 'YYYY') end;
  if tg_op = 'INSERT' then
    perform log_employee_event(new.company_id, new.user_id, 'leave', 'Requested ' || span);
  elsif new.status is distinct from old.status then
    perform log_employee_event(new.company_id, new.user_id, 'leave', new.status || ': ' || span || coalesce(' · ' || new.decision_note, ''));
  end if;
  return new;
end $$;
create trigger leave_requests_events after insert or update on leave_requests
  for each row execute function leave_events();

create function document_events() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  if tg_op = 'INSERT' then
    perform log_employee_event(new.company_id, new.user_id, 'document', 'Document added: ' || new.title || ' (' || new.category || ')');
  elsif tg_op = 'DELETE' then
    perform log_employee_event(old.company_id, old.user_id, 'document', 'Document removed: ' || old.title);
  end if;
  return coalesce(new, old);
end $$;
create trigger staff_documents_events after insert or delete on staff_documents
  for each row execute function document_events();

create function agreement_events() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  if new.staff_user_id is not null and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    perform log_employee_event(new.company_id, new.staff_user_id, 'agreement', 'Agreement ' || coalesce(new.number, '') || ' ' || new.title || ': ' || new.status);
  end if;
  return new;
end $$;
create trigger agreements_events after insert or update on agreements
  for each row execute function agreement_events();

-- Starting point for existing people: when they joined.
insert into employee_events (company_id, user_id, kind, detail, created_at)
select company_id, user_id, 'joined', 'Joined the company as ' || role, coalesce(start_date::timestamptz, created_at)
from company_members;

-- 3. HR can edit organization fields too (was owners/admins only). Same checks as 0008.
create or replace function set_member_org(p_company uuid, p_user uuid, p_patch jsonb) returns void
  language plpgsql security definer set search_path = public as
$$ declare
  v_role member_role; v_mgr uuid; v_cur uuid; v_hops int := 0; v_required boolean;
begin
  if not is_company_hr(p_company) then raise exception 'Only HR, owners and admins can change this.'; end if;
  select role into v_role from company_members where company_id = p_company and user_id = p_user;
  if not found then raise exception 'That person is not in this company.'; end if;

  if p_patch ? 'department_id' then
    if p_patch->>'department_id' is not null and not exists (select 1 from departments where id = (p_patch->>'department_id')::uuid and company_id = p_company) then
      raise exception 'Unknown department.'; end if;
    update company_members set department_id = (p_patch->>'department_id')::uuid where company_id = p_company and user_id = p_user;
  end if;
  if p_patch ? 'job_title_id' then
    if p_patch->>'job_title_id' is not null and not exists (select 1 from job_titles where id = (p_patch->>'job_title_id')::uuid and company_id = p_company) then
      raise exception 'Unknown job title.'; end if;
    update company_members set job_title_id = (p_patch->>'job_title_id')::uuid where company_id = p_company and user_id = p_user;
  end if;
  if p_patch ? 'manager_id' then
    v_mgr := (p_patch->>'manager_id')::uuid;
    if v_mgr is null then
      select coalesce((settings->'2_reporting_managers'->>'required')::boolean, true) into v_required from companies where id = p_company;
      if v_required and v_role <> 'owner' then raise exception 'A reporting manager is required (see Reporting Managers settings).'; end if;
    else
      if v_mgr = p_user then raise exception 'Someone cannot report to themselves.'; end if;
      if not exists (select 1 from company_members where company_id = p_company and user_id = v_mgr and active) then raise exception 'The manager must be an active member of this company.'; end if;
      v_cur := v_mgr;
      while v_cur is not null and v_hops < 100 loop
        if v_cur = p_user then raise exception 'That would create a reporting loop.'; end if;
        select manager_id into v_cur from company_members where company_id = p_company and user_id = v_cur;
        v_hops := v_hops + 1;
      end loop;
    end if;
    update company_members set manager_id = v_mgr where company_id = p_company and user_id = p_user;
  end if;
  if p_patch ? 'staff_category' then
    update company_members set staff_category = nullif(left(p_patch->>'staff_category', 60), '') where company_id = p_company and user_id = p_user; end if;
  if p_patch ? 'employment_type' then
    update company_members set employment_type = nullif(left(p_patch->>'employment_type', 60), '') where company_id = p_company and user_id = p_user; end if;
  if p_patch ? 'start_date' then
    update company_members set start_date = nullif(p_patch->>'start_date', '')::date where company_id = p_company and user_id = p_user; end if;
  if p_patch ? 'employee_no' then
    update company_members set employee_no = nullif(left(trim(p_patch->>'employee_no'), 40), '') where company_id = p_company and user_id = p_user; end if;
  insert into company_audit (company_id, actor, action, detail) values (p_company, auth.uid(), 'member_org_changed', p_user::text);
end $$;

-- 4. Contact details (HR, or the person themselves) and contract dates (HR).
create function set_member_profile(p_company uuid, p_user uuid, p_patch jsonb) returns void
  language plpgsql security definer set search_path = public as
$$ declare hr boolean := is_company_hr(p_company);
begin
  if not (hr or p_user = auth.uid()) then raise exception 'Only HR can change someone else''s details.'; end if;
  if not exists (select 1 from company_members where company_id = p_company and user_id = p_user) then
    raise exception 'That person is not in this company.'; end if;
  if p_patch ? 'phone' then
    update company_members set phone = nullif(left(btrim(p_patch->>'phone'), 40), '') where company_id = p_company and user_id = p_user; end if;
  if p_patch ? 'emergency_contact' then
    update company_members set emergency_contact = nullif(left(btrim(p_patch->>'emergency_contact'), 120), '') where company_id = p_company and user_id = p_user; end if;
  if (p_patch ? 'probation_end' or p_patch ? 'contract_end') and not hr then
    raise exception 'Only HR can change contract dates.'; end if;
  if p_patch ? 'probation_end' then
    update company_members set probation_end = nullif(p_patch->>'probation_end', '')::date where company_id = p_company and user_id = p_user; end if;
  if p_patch ? 'contract_end' then
    update company_members set contract_end = nullif(p_patch->>'contract_end', '')::date where company_id = p_company and user_id = p_user; end if;
end $$;

-- 5. Status: Active, Suspended (keeps access, cannot take working shifts or vessels) or Former (access removed,
--    roster shifts after the leaving date removed). Never the owner, never yourself.
create function set_member_status(p_company uuid, p_user uuid, p_status text, p_end_date date default null, p_reason text default null) returns integer
  language plpgsql security definer set search_path = public as
$$ declare v_role member_role; n integer := 0;
begin
  if not is_company_hr(p_company) then raise exception 'Only HR, owners and admins can change someone''s status.'; end if;
  if p_status not in ('Active', 'Suspended', 'Former') then raise exception 'Unknown status.'; end if;
  select role into v_role from company_members where company_id = p_company and user_id = p_user;
  if not found then raise exception 'That person is not in this company.'; end if;
  if v_role = 'owner' then raise exception 'The company owner''s status cannot be changed.'; end if;
  if p_user = auth.uid() then raise exception 'You cannot change your own status.'; end if;
  if p_status = 'Former' then
    update company_members set employment_status = 'Former', active = false, assigned_vessel = null, duty_status = 'Off duty',
      end_date = coalesce(p_end_date, current_date), end_reason = nullif(left(btrim(p_reason), 200), '')
      where company_id = p_company and user_id = p_user;
    delete from roster_entries where company_id = p_company and user_id = p_user and day > coalesce(p_end_date, current_date);
    get diagnostics n = row_count;
  elsif p_status = 'Suspended' then
    update company_members set employment_status = 'Suspended', active = true, assigned_vessel = null, duty_status = 'Off duty',
      end_reason = nullif(left(btrim(p_reason), 200), '')
      where company_id = p_company and user_id = p_user;
  else
    update company_members set employment_status = 'Active', active = true, end_date = null, end_reason = null
      where company_id = p_company and user_id = p_user;
  end if;
  insert into company_audit (company_id, actor, action, detail) values (p_company, auth.uid(), 'member_status_changed', p_user::text || ' ' || p_status);
  return n;
end $$;

-- 6. One availability check for crew work on a day. Returns null when the person can work, otherwise the reason.
create function crew_check(p_company uuid, p_user uuid, p_day date) returns text
  language plpgsql stable security definer set search_path = public as
$$ declare
  st jsonb; rules jsonb; m record; nm text; grp text; q jsonb; missing text[] := '{}'; att text;
begin
  select settings into st from companies where id = p_company;
  rules := coalesce(st->'8_crew_assignment_rules', '{}'::jsonb);
  select employment_status, active into m from company_members where company_id = p_company and user_id = p_user;
  if not found then return 'Not in this company.'; end if;
  select coalesce(p.full_name, split_part(p.email, '@', 1)) into nm from profiles p where p.id = p_user;
  if m.employment_status = 'Former' or not m.active then return nm || ' no longer works here.'; end if;
  if m.employment_status = 'Suspended' then return nm || ' is suspended.'; end if;
  if exists (select 1 from leave_requests where company_id = p_company and user_id = p_user and status = 'Approved' and p_day between start_date and end_date) then
    return nm || ' is on approved leave on ' || to_char(p_day, 'DD Mon') || '.'; end if;
  select status into att from attendance_records where company_id = p_company and user_id = p_user and day = p_day;
  if att = 'Absent' then return nm || ' is marked Absent on ' || to_char(p_day, 'DD Mon') || '.'; end if;
  if coalesce((rules->>'expired')::boolean, true) and has_expired_cert(p_company, p_user, p_day) then
    return nm || ' has an expired certificate (see Crew Assignment Rules).'; end if;
  if coalesce((rules->>'qualified')::boolean, true) then
    grp := member_crew_group(p_company, p_user);
    for q in select * from jsonb_array_elements(
               case when jsonb_typeof(st->'8_crew_qualification_types') = 'array' then st->'8_crew_qualification_types' else '[]'::jsonb end) loop
      if ((q->>'required') = 'All crew' and grp in ('Captain', 'Deck', 'Engineering')) or (q->>'required') = grp then
        if not has_valid_qual(p_company, p_user, q->>'name', p_day) then missing := missing || (q->>'name'); end if;
      end if;
    end loop;
    if array_length(missing, 1) > 0 then
      return nm || ' is missing ' || array_to_string(missing, ', ') || ' required for ' || grp || ' crew.'; end if;
  end if;
  return null;
end $$;
revoke execute on function crew_check(uuid, uuid, date) from anon, public;
grant execute on function crew_check(uuid, uuid, date) to authenticated;

-- Everyone's availability for a day, for the Crew Management screen (HR and roster editors).
create function crew_availability(p_company uuid, p_day date) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ begin
  if not (is_company_hr(p_company) or can_edit_roster(p_company)) then raise exception 'Only HR and roster editors can see crew availability.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('u', m.user_id, 'reason', crew_check(p_company, m.user_id, p_day),
             'shift', (select shift from roster_entries r where r.company_id = p_company and r.user_id = m.user_id and r.day = p_day)))
    from company_members m where m.company_id = p_company and m.active), '[]'::jsonb);
end $$;
revoke execute on function crew_availability(uuid, date) from anon, public;
grant execute on function crew_availability(uuid, date) to authenticated;

-- 7. Vessel assignment and going on duty use the full check (status, leave, expired and missing qualifications).
create or replace function set_member_hr(p_company uuid, p_user uuid, p_patch jsonb) returns void
  language plpgsql security definer set search_path = public as
$fn$ declare why text; new_vessel boolean;
begin
  if not is_company_hr(p_company) then raise exception 'Only HR, owners and admins can change this.'; end if;
  if not exists (select 1 from company_members where company_id = p_company and user_id = p_user) then
    raise exception 'That person is not in this company.'; end if;
  new_vessel := coalesce(btrim(p_patch->>'assigned_vessel'), '') <> ''
    and coalesce(btrim(p_patch->>'assigned_vessel'), '') is distinct from
        coalesce((select assigned_vessel from company_members where company_id = p_company and user_id = p_user), '');
  if p_patch->>'duty_status' = 'On duty' or new_vessel then
    why := crew_check(p_company, p_user, current_date);
    if why is not null then
      raise exception '% They cannot % right now.', why, case when new_vessel then 'be assigned to a vessel' else 'go on duty' end;
    end if;
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
end $fn$;

-- 8. The roster also refuses working shifts for suspended people (keeps the attendance rule from 0021).
create or replace function roster_extra_block(p_company uuid, p_user uuid, p_day date, p_shift text) returns text
  language plpgsql stable security definer set search_path = public as
$$ declare st text; nm text; es text;
begin
  if p_shift in ('OFF', 'L') then return null; end if;
  select coalesce(p.full_name, split_part(p.email, '@', 1)) into nm from profiles p where p.id = p_user;
  select employment_status into es from company_members where company_id = p_company and user_id = p_user;
  if es = 'Suspended' then return nm || ' is suspended, so they cannot take a working shift.'; end if;
  select status into st from attendance_records where company_id = p_company and user_id = p_user and day = p_day;
  if st in ('Absent', 'On leave') then
    return nm || ' is marked ' || st || ' on ' || to_char(p_day, 'DD Mon') || ', so they cannot take a working shift.';
  end if;
  return null;
end $$;
