-- Cursor 2026-10-26: salary account (Maldives bank, account name, account number)
-- on Add Employee and Edit Employee. Stored on member_pay so only HR and the person can read it.

alter table member_pay
  add column if not exists bank_name text,
  add column if not exists account_name text,
  add column if not exists account_number text;

alter table member_pay drop constraint if exists member_pay_bank_len;
alter table member_pay add constraint member_pay_bank_len check (
  (bank_name is null or char_length(bank_name) between 2 and 80)
  and (account_name is null or char_length(account_name) between 2 and 80)
  and (account_number is null or account_number ~ '^[A-Za-z0-9]{4,34}$')
);

create or replace function set_member_bank(p_company uuid, p_user uuid, p_bank text, p_account_name text, p_account_number text)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_bank text := nullif(left(btrim(coalesce(p_bank, '')), 80), '');
  v_name text := nullif(left(btrim(coalesce(p_account_name, '')), 80), '');
  v_no text := nullif(left(regexp_replace(coalesce(p_account_number, ''), '\s', '', 'g'), 34), '');
begin
  if not is_company_hr(p_company) and p_user is distinct from auth.uid() then
    raise exception 'Only HR can change someone else''s salary account.';
  end if;
  if not exists (select 1 from company_members where company_id = p_company and user_id = p_user) then
    raise exception 'That person is not in this company.';
  end if;
  if num_nonnulls(v_bank, v_name, v_no) not in (0, 3) then
    raise exception 'Choose the bank, account name, and account number together.';
  end if;
  if v_no is not null and v_no !~ '^[A-Za-z0-9]{4,34}$' then
    raise exception 'Account number should be 4 to 34 letters or digits.';
  end if;
  insert into member_pay (company_id, user_id, bank_name, account_name, account_number, updated_by, updated_at)
    values (p_company, p_user, v_bank, v_name, v_no, auth.uid(), now())
  on conflict (company_id, user_id) do update
    set bank_name = excluded.bank_name,
        account_name = excluded.account_name,
        account_number = excluded.account_number,
        updated_by = excluded.updated_by,
        updated_at = now();
end;
$$;

revoke all on function set_member_bank(uuid, uuid, text, text, text) from public, anon;
grant execute on function set_member_bank(uuid, uuid, text, text, text) to authenticated;

-- Invite accept applies the salary account saved on the Add Employee form.
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

  if p ? 'bank_name' or p ? 'account_name' or p ? 'account_number' then
    perform set_member_bank(p_company, p_user, coalesce(p->>'bank_name', ''), coalesce(p->>'account_name', ''), coalesce(p->>'account_number', ''));
  end if;
end;
$$;
