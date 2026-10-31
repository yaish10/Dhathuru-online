-- Cursor 2026-10-23: Apply Add-Employee wizard fields when an invite is accepted.
-- Profile draft lives on company_invites.meta and/or companies.settings.8_pending_employee_invites.

alter table company_invites
  add column if not exists meta jsonb not null default '{}'::jsonb;

-- Overflow HR fields that are not first-class columns yet (gender, dob, addresses, shift, docs…).
alter table company_members
  add column if not exists hr_meta jsonb not null default '{}'::jsonb;

-- Apply an onboarding profile jsonb to an existing company member (security definer).
create or replace function apply_invite_profile(p_company uuid, p_user uuid, p_profile jsonb)
  returns void
  language plpgsql security definer set search_path = public as
$$
declare
  p jsonb := coalesce(p_profile, '{}'::jsonb);
  v_dept uuid;
  v_title uuid;
  v_mgr uuid;
  v_name text;
  v_phone text;
  v_emerg text;
  v_empno text;
  v_extra jsonb;
begin
  if p = '{}'::jsonb then return; end if;

  v_name := nullif(left(btrim(coalesce(p->>'full_name', '')), 120), '');
  if v_name is not null then
    update profiles set full_name = v_name where id = p_user
      and (full_name is null or btrim(full_name) = '' or full_name = split_part(coalesce(email, ''), '@', 1));
  end if;

  begin
    v_dept := nullif(p->>'department_id', '')::uuid;
  exception when others then v_dept := null; end;
  begin
    v_title := nullif(p->>'job_title_id', '')::uuid;
  exception when others then v_title := null; end;
  begin
    v_mgr := nullif(p->>'manager_id', '')::uuid;
  exception when others then v_mgr := null; end;

  if v_dept is not null and not exists (
    select 1 from departments where id = v_dept and company_id = p_company
  ) then v_dept := null; end if;
  if v_title is not null and not exists (
    select 1 from job_titles where id = v_title and company_id = p_company
  ) then v_title := null; end if;
  if v_mgr is not null and (
    v_mgr = p_user or not exists (
      select 1 from company_members where company_id = p_company and user_id = v_mgr and active
    )
  ) then v_mgr := null; end if;

  v_empno := nullif(left(btrim(coalesce(p->>'employee_no', '')), 40), '');

  update company_members set
    department_id   = coalesce(v_dept, department_id),
    job_title_id    = coalesce(v_title, job_title_id),
    manager_id      = coalesce(v_mgr, manager_id),
    employee_no     = coalesce(v_empno, employee_no),
    staff_category  = coalesce(nullif(left(btrim(coalesce(p->>'staff_category', '')), 60), ''), staff_category),
    employment_type = coalesce(nullif(left(btrim(coalesce(p->>'employment_type', '')), 60), ''), employment_type),
    start_date      = coalesce(nullif(p->>'start_date', '')::date, start_date),
    probation_end   = coalesce(nullif(p->>'probation_end', '')::date, probation_end),
    hr_meta = coalesce(hr_meta, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      'preferred_name', nullif(p->>'preferred_name', ''),
      'dob', nullif(p->>'dob', ''),
      'gender', nullif(p->>'gender', ''),
      'id_kind', nullif(p->>'id_kind', ''),
      'id_number', nullif(p->>'id_number', ''),
      'address', nullif(p->>'address', ''),
      'current_address', nullif(p->>'current_address', ''),
      'nationality', nullif(p->>'nationality', ''),
      'blood_group', nullif(p->>'blood_group', ''),
      'shift', nullif(p->>'shift', ''),
      'roster', nullif(p->>'roster', ''),
      'attendance_method', nullif(p->>'attendance_method', ''),
      'work_days', p->'work_days',
      'notes', nullif(p->>'notes', ''),
      'docs_checklist', p->'docs_checklist',
      'flags', p->'flags'
    ))
  where company_id = p_company and user_id = p_user;

  v_phone := nullif(left(btrim(coalesce(p->>'phone', '')), 40), '');
  v_emerg := nullif(left(btrim(coalesce(p->>'emergency_contact', '')), 120), '');
  if v_phone is not null or v_emerg is not null then
    insert into member_private (company_id, user_id) values (p_company, p_user)
      on conflict do nothing;
    update member_private set
      phone = coalesce(v_phone, phone),
      emergency_contact = coalesce(v_emerg, emergency_contact),
      updated_at = now()
    where company_id = p_company and user_id = p_user;
  end if;
end;
$$;
revoke execute on function apply_invite_profile(uuid, uuid, jsonb) from anon, public;
grant execute on function apply_invite_profile(uuid, uuid, jsonb) to authenticated;

create or replace function accept_invite(p_token text) returns uuid
  language plpgsql security definer set search_path = public as
$$
declare
  inv company_invites;
  prof jsonb := '{}'::jsonb;
  settings jsonb;
  pending jsonb;
  item jsonb;
  kept jsonb := '[]'::jsonb;
begin
  select * into inv from company_invites
    where token = p_token and accepted_at is null and expires_at > now();
  if not found then raise exception 'This invite is invalid or has expired.'; end if;
  if lower(inv.email) <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'This invite was sent to a different email address.';
  end if;

  insert into company_members (company_id, user_id, role, role_label)
  values (inv.company_id, auth.uid(), inv.role, inv.role_label)
  on conflict (company_id, user_id) do update
    set role = excluded.role, role_label = excluded.role_label, active = true;

  -- Prefer invite.meta.profile; fall back to companies.settings pending list.
  if jsonb_typeof(inv.meta->'profile') = 'object' then
    prof := inv.meta->'profile';
  end if;
  select c.settings into settings from companies c where c.id = inv.company_id;
  pending := coalesce(settings->'8_pending_employee_invites', '[]'::jsonb);
  if jsonb_typeof(pending) = 'array' then
    for item in select * from jsonb_array_elements(pending) loop
      if (item->>'invite_id') = inv.id::text
         or lower(coalesce(item->>'email', '')) = lower(inv.email) then
        if prof = '{}'::jsonb and jsonb_typeof(item->'profile') = 'object' then
          prof := item->'profile';
        end if;
      else
        kept := kept || jsonb_build_array(item);
      end if;
    end loop;
    update companies set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{8_pending_employee_invites}', kept)
      where id = inv.company_id;
  end if;

  perform apply_invite_profile(inv.company_id, auth.uid(), prof);

  update company_invites set accepted_at = now() where id = inv.id;
  return inv.company_id;
end;
$$;
revoke execute on function accept_invite(text) from anon;
grant execute on function accept_invite(text) to authenticated;

-- One-shot invite + profile (used by Add Employee wizard).
create or replace function create_employee_invite(
  p_company uuid,
  p_email text,
  p_role member_role default 'staff',
  p_profile jsonb default '{}'::jsonb,
  p_role_label text default null
) returns company_invites
  language plpgsql security definer set search_path = public as
$$
declare
  inv company_invites;
  mail text := lower(btrim(p_email));
  role_ok member_role := coalesce(p_role, 'staff');
  pending jsonb;
  settings jsonb;
begin
  if not is_company_hr(p_company) then
    raise exception 'Only HR, owners and admins can invite employees.';
  end if;
  if role_ok = 'owner' then raise exception 'Cannot invite as owner.'; end if;
  if mail !~* '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Enter a valid email.'; end if;

  insert into company_invites (company_id, email, role, role_label, meta, created_by)
  values (
    p_company, mail, role_ok,
    nullif(left(btrim(coalesce(p_role_label, '')), 40), ''),
    jsonb_build_object('profile', coalesce(p_profile, '{}'::jsonb)),
    auth.uid()
  )
  returning * into inv;

  select c.settings into settings from companies c where c.id = p_company;
  pending := coalesce(settings->'8_pending_employee_invites', '[]'::jsonb);
  if jsonb_typeof(pending) <> 'array' then pending := '[]'::jsonb; end if;
  pending := (
    select coalesce(jsonb_agg(x), '[]'::jsonb)
    from jsonb_array_elements(pending) x
    where lower(coalesce(x->>'email', '')) <> mail
  );
  pending := pending || jsonb_build_array(jsonb_build_object(
    'invite_id', inv.id,
    'email', mail,
    'created_at', now(),
    'profile', coalesce(p_profile, '{}'::jsonb)
  ));
  if jsonb_array_length(pending) > 40 then
    pending := (
      select coalesce(jsonb_agg(e), '[]'::jsonb)
      from (
        select e from jsonb_array_elements(pending) with ordinality t(e, ord)
        order by ord desc limit 40
      ) s
    );
  end if;
  update companies
    set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{8_pending_employee_invites}', pending)
    where id = p_company;

  return inv;
end;
$$;
revoke execute on function create_employee_invite(uuid, text, member_role, jsonb, text) from anon, public;
grant execute on function create_employee_invite(uuid, text, member_role, jsonb, text) to authenticated;

-- HR backfill: apply pending drafts for people who already accepted before 0050.
create or replace function apply_pending_employee_profiles(p_company uuid) returns integer
  language plpgsql security definer set search_path = public as
$$
declare
  settings jsonb;
  pending jsonb;
  item jsonb;
  kept jsonb := '[]'::jsonb;
  uid uuid;
  n int := 0;
begin
  if not is_company_hr(p_company) then
    raise exception 'Only HR, owners and admins can apply pending profiles.';
  end if;
  select c.settings into settings from companies c where c.id = p_company;
  pending := coalesce(settings->'8_pending_employee_invites', '[]'::jsonb);
  if jsonb_typeof(pending) <> 'array' then return 0; end if;

  for item in select * from jsonb_array_elements(pending) loop
    select p.id into uid
    from profiles p
    join company_members m on m.user_id = p.id and m.company_id = p_company
    where lower(p.email) = lower(coalesce(item->>'email', ''))
    limit 1;
    if uid is not null and jsonb_typeof(item->'profile') = 'object' then
      perform apply_invite_profile(p_company, uid, item->'profile');
      n := n + 1;
    else
      kept := kept || jsonb_build_array(item);
    end if;
  end loop;

  update companies
    set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{8_pending_employee_invites}', kept)
    where id = p_company;
  return n;
end;
$$;
revoke execute on function apply_pending_employee_profiles(uuid) from anon, public;
grant execute on function apply_pending_employee_profiles(uuid) to authenticated;
