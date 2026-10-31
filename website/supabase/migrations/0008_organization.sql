-- Organization & Departments: real records, scoped to a company.
create table departments (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 80),
  head_user_id uuid,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (company_id, name)
);
create table job_titles (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  title         text not null check (char_length(title) between 1 and 80),
  department_id uuid references departments(id) on delete set null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (company_id, title)
);
create index on departments (company_id);
create index on job_titles (company_id);

alter table company_members
  add column department_id   uuid references departments(id) on delete set null,
  add column job_title_id    uuid references job_titles(id) on delete set null,
  add column manager_id      uuid,
  add column employee_no     text,
  add column staff_category  text,
  add column employment_type text,
  add column start_date      date;
create unique index company_members_employee_no on company_members (company_id, employee_no) where employee_no is not null;

alter table departments enable row level security;
alter table job_titles  enable row level security;
create policy departments_select on departments for select to authenticated using (is_company_member(company_id));
create policy departments_insert on departments for insert to authenticated with check (is_company_admin(company_id));
create policy departments_update on departments for update to authenticated using (is_company_admin(company_id)) with check (is_company_admin(company_id));
create policy departments_delete on departments for delete to authenticated using (is_company_admin(company_id));
create policy job_titles_select on job_titles for select to authenticated using (is_company_member(company_id));
create policy job_titles_insert on job_titles for insert to authenticated with check (is_company_admin(company_id));
create policy job_titles_update on job_titles for update to authenticated using (is_company_admin(company_id)) with check (is_company_admin(company_id));
create policy job_titles_delete on job_titles for delete to authenticated using (is_company_admin(company_id));

-- Clear dangling references when someone leaves the company.
create function company_members_cleanup() returns trigger language plpgsql security definer set search_path = public as
$$ begin
  update company_members set manager_id = null where company_id = old.company_id and manager_id = old.user_id;
  update departments set head_user_id = null where company_id = old.company_id and head_user_id = old.user_id;
  return old;
end $$;
create trigger company_members_after_delete after delete on company_members
  for each row execute function company_members_cleanup();

-- Edit a member's organization fields (also works for the owner row, which direct updates cannot touch).
create function set_member_org(p_company uuid, p_user uuid, p_patch jsonb) returns void
  language plpgsql security definer set search_path = public as
$$ declare
  v_role member_role; v_mgr uuid; v_cur uuid; v_hops int := 0; v_required boolean;
begin
  if not is_company_admin(p_company) then raise exception 'Only owners and admins can change this.'; end if;
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

-- Next employee ID from the company's "Employee ID Format" settings.
create function assign_employee_no(p_company uuid, p_user uuid) returns text
  language plpgsql security definer set search_path = public as
$$ declare
  f jsonb; v_prefix text; v_sep text; v_year boolean; v_digits int; v_next bigint; v_id text; v_existing text; v_tries int := 0;
begin
  if not is_company_admin(p_company) then raise exception 'Only owners and admins can change this.'; end if;
  select employee_no into v_existing from company_members where company_id = p_company and user_id = p_user;
  if not found then raise exception 'That person is not in this company.'; end if;
  if v_existing is not null then return v_existing; end if;
  select coalesce(settings->'2_employee_id_format', '{}'::jsonb) into f from companies where id = p_company for update;
  v_prefix := coalesce(nullif(f->>'prefix', ''), 'EMP');
  v_sep    := case coalesce(f->>'sep', '-') when 'none' then '' else coalesce(f->>'sep', '-') end;
  v_year   := coalesce((f->>'year')::boolean, true);
  v_digits := greatest(1, least(coalesce((f->>'digits')::int, 6), 12));
  v_next   := greatest(1, coalesce((f->>'start')::numeric, 1)::bigint);
  loop
    v_id := v_prefix || v_sep || case when v_year then to_char(now(), 'YYYY') || v_sep else '' end || lpad(v_next::text, v_digits, '0');
    exit when not exists (select 1 from company_members where company_id = p_company and employee_no = v_id) or v_tries > 1000;
    v_next := v_next + 1; v_tries := v_tries + 1;
  end loop;
  update company_members set employee_no = v_id where company_id = p_company and user_id = p_user;
  update companies set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{2_employee_id_format}', f || jsonb_build_object('start', v_next + 1), true) where id = p_company;
  insert into company_audit (company_id, actor, action, detail) values (p_company, auth.uid(), 'employee_no_assigned', v_id);
  return v_id;
end $$;
revoke execute on function set_member_org(uuid, uuid, jsonb), assign_employee_no(uuid, uuid) from anon;
