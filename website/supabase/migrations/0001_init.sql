-- VEYORA multi-tenant schema. Many companies share one database; every row is scoped by company_id.
create extension if not exists pgcrypto;

create type company_type   as enum ('Ferry Operator', 'Speedboat Operator', 'Both', 'Other');
create type company_status as enum ('Pending', 'Active', 'Suspended');
create type member_role    as enum ('owner', 'admin', 'operations', 'hr', 'staff');

create table companies (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null default ('VY-' || upper(substr(translate(encode(gen_random_bytes(6), 'base64'), '+/=OIl01', ''), 1, 6))),
  name        text not null check (char_length(name) between 2 and 120),
  type        company_type not null,
  email       text check (email is null or email ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  phone       text,
  logo_path   text,
  status      company_status not null default 'Active',
  created_by  uuid not null default auth.uid() references auth.users(id),
  created_at  timestamptz not null default now()
);

create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  created_at  timestamptz not null default now()
);

create table company_members (
  company_id  uuid not null references companies(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        member_role not null default 'staff',
  created_at  timestamptz not null default now(),
  primary key (company_id, user_id)
);
create index on company_members (user_id);

-- Helper functions (security definer avoids RLS recursion on company_members).
create function is_company_member(cid uuid) returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from company_members where company_id = cid and user_id = auth.uid()) $$;

create function is_company_admin(cid uuid) returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from company_members
       where company_id = cid and user_id = auth.uid() and role in ('owner','admin')) $$;

-- Creator becomes owner automatically.
create function add_creator_as_owner() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  insert into company_members (company_id, user_id, role) values (new.id, new.created_by, 'owner');
  return new;
end $$;
create trigger companies_owner after insert on companies
  for each row execute function add_creator_as_owner();

-- Profile row for every new auth user.
create function handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  insert into profiles (id, full_name) values (new.id, new.raw_user_meta_data->>'full_name');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

alter table companies        enable row level security;
alter table profiles         enable row level security;
alter table company_members  enable row level security;

create policy companies_select on companies for select to authenticated using (is_company_member(id));
create policy companies_insert on companies for insert to authenticated with check (created_by = auth.uid());
create policy companies_update on companies for update to authenticated using (is_company_admin(id)) with check (is_company_admin(id));

create policy profiles_select on profiles for select to authenticated using (id = auth.uid());
create policy profiles_update on profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy members_select on company_members for select to authenticated using (user_id = auth.uid() or is_company_member(company_id));
create policy members_insert on company_members for insert to authenticated with check (is_company_admin(company_id));
create policy members_update on company_members for update to authenticated using (is_company_admin(company_id)) with check (is_company_admin(company_id));
create policy members_delete on company_members for delete to authenticated using (is_company_admin(company_id));

-- Logo storage: public bucket, files live under <company_id>/..., writable only by company admins.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-logos', 'company-logos', true, 1048576, array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do nothing;

create policy logos_write on storage.objects for insert to authenticated
  with check (bucket_id = 'company-logos' and is_company_admin(((storage.foldername(name))[1])::uuid));
create policy logos_update on storage.objects for update to authenticated
  using (bucket_id = 'company-logos' and is_company_admin(((storage.foldername(name))[1])::uuid));
create policy logos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'company-logos' and is_company_admin(((storage.foldername(name))[1])::uuid));
