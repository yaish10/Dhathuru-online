-- Platform owner: VEYORA staff who approve/suspend companies and monitor the platform.
create table platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table platform_admins enable row level security;
create function is_platform_admin() returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from platform_admins where user_id = auth.uid()) $$;
create policy platform_admins_self on platform_admins for select to authenticated using (user_id = auth.uid());

create table platform_settings (
  id                boolean primary key default true check (id),
  approval_required boolean not null default false
);
insert into platform_settings default values;
alter table platform_settings enable row level security;
create policy platform_settings_read on platform_settings for select to authenticated using (is_platform_admin());

create table platform_audit (
  id         bigint generated always as identity primary key,
  actor      uuid references auth.users(id) on delete set null,
  action     text not null,
  company_id uuid references companies(id) on delete set null,
  detail     text,
  created_at timestamptz not null default now()
);
alter table platform_audit enable row level security;
create policy platform_audit_read on platform_audit for select to authenticated using (is_platform_admin());

-- Status is decided by the server, never by the client.
create function companies_guard_status() returns trigger language plpgsql security definer set search_path = public as
$$ begin
  if tg_op = 'INSERT' then
    new.status := case when (select approval_required from platform_settings) then 'Pending' else 'Active' end;
  elsif new.status is distinct from old.status and not is_platform_admin() then
    raise exception 'Only the platform owner can change company status.';
  end if;
  return new;
end $$;
create trigger companies_status_guard before insert or update on companies
  for each row execute function companies_guard_status();

create policy companies_platform_select on companies for select to authenticated using (is_platform_admin());
create policy companies_platform_update on companies for update to authenticated using (is_platform_admin()) with check (is_platform_admin());

create function platform_overview() returns table (
  id uuid, code text, name text, type company_type, status company_status, created_at timestamptz,
  members bigint, owner_email text)
  language sql stable security definer set search_path = public as
$$ select c.id, c.code, c.name, c.type, c.status, c.created_at,
     (select count(*) from company_members m where m.company_id = c.id),
     (select p.email from company_members m join profiles p on p.id = m.user_id where m.company_id = c.id and m.role = 'owner' limit 1)
   from companies c where is_platform_admin() order by c.created_at desc $$;

create function platform_set_status(p_company uuid, p_status company_status) returns void
  language plpgsql security definer set search_path = public as
$$ begin
  if not is_platform_admin() then raise exception 'Not allowed.'; end if;
  update companies set status = p_status where id = p_company;
  insert into platform_audit (actor, action, company_id, detail) values (auth.uid(), 'company_status', p_company, p_status::text);
end $$;

create function platform_set_approval(p_required boolean) returns void
  language plpgsql security definer set search_path = public as
$$ begin
  if not is_platform_admin() then raise exception 'Not allowed.'; end if;
  update platform_settings set approval_required = p_required;
  insert into platform_audit (actor, action, detail) values (auth.uid(), 'approval_required', p_required::text);
end $$;

create function platform_stats() returns table (companies bigint, pending bigint, users bigint, memberships bigint)
  language sql stable security definer set search_path = public as
$$ select (select count(*) from companies), (select count(*) from companies where status = 'Pending'),
          (select count(*) from profiles), (select count(*) from company_members) where is_platform_admin() $$;

-- Helper for future company-data tables: only active members of an Active company.
create function is_company_active_member(cid uuid) returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from company_members m join companies c on c.id = m.company_id
       where m.company_id = cid and m.user_id = auth.uid() and m.active and c.status = 'Active') $$;

revoke execute on function platform_overview(), platform_set_status(uuid, company_status), platform_set_approval(boolean), platform_stats() from anon;
