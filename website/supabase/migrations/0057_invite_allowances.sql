-- Cursor 2026-10-26: when an invited employee accepts, copy the allowances chosen
-- on Add Employee onto member_pay so they show under Allowances and in pay runs.
-- set_member_pay() is HR-only, so this security-definer function writes the row itself.

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
  v_item jsonb;
  v_alw_name text;
  v_alw_amt numeric;
  v_clean jsonb := '[]'::jsonb;
  v_old jsonb;
  v_kept jsonb;
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

  if p ? 'bank_name' or p ? 'account_name' or p ? 'account_number' then
    perform set_member_bank(p_company, p_user, coalesce(p->>'bank_name', ''), coalesce(p->>'account_name', ''), coalesce(p->>'account_number', ''));
  end if;

  if jsonb_typeof(p->'allowances') = 'array' then
    for v_item in select value from jsonb_array_elements(p->'allowances') loop
      v_alw_name := left(btrim(coalesce(v_item->>'name', '')), 60);
      if char_length(v_alw_name) < 1 then continue; end if;
      begin
        v_alw_amt := round(coalesce(nullif(v_item->>'amount', '')::numeric, 0), 2);
      exception when others then
        v_alw_amt := -1;
      end;
      if v_alw_amt < 0 or v_alw_amt > 10000000 then continue; end if;
      v_clean := v_clean || jsonb_build_object('name', v_alw_name, 'amount', v_alw_amt);
    end loop;
    if jsonb_array_length(v_clean) > 20 then
      select coalesce(jsonb_agg(x), '[]'::jsonb) into v_clean
        from (select value as x from jsonb_array_elements(v_clean) limit 20) q;
    end if;
    if jsonb_array_length(v_clean) > 0 then
      select coalesce(allowances, '[]'::jsonb) into v_old
        from member_pay where company_id = p_company and user_id = p_user;
      v_old := coalesce(v_old, '[]'::jsonb);
      select coalesce(jsonb_agg(x), '[]'::jsonb) into v_kept
        from jsonb_array_elements(v_old) x
        where lower(btrim(x->>'name')) not in (
          select lower(btrim(c->>'name')) from jsonb_array_elements(v_clean) c
        );
      insert into member_pay (company_id, user_id, allowances, updated_by, updated_at)
        values (p_company, p_user, coalesce(v_kept, '[]'::jsonb) || v_clean, auth.uid(), now())
      on conflict (company_id, user_id) do update
        set allowances = excluded.allowances,
            updated_by = excluded.updated_by,
            updated_at = now();
    end if;
  end if;
end;
$$;
