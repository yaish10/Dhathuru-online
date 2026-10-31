-- Staff management: every staff member belongs to a company via company_members; RLS keeps data per company.

-- 1. Profiles carry the email so teammates can be listed.
alter table profiles add column email text;
update profiles p set email = u.email from auth.users u where u.id = p.id;

create or replace function handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  insert into profiles (id, full_name, email) values (new.id, new.raw_user_meta_data->>'full_name', new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;

-- 2. Suspension: inactive members lose all access to the company.
alter table company_members add column active boolean not null default true;

create or replace function is_company_member(cid uuid) returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from company_members where company_id = cid and user_id = auth.uid() and active) $$;

create or replace function is_company_admin(cid uuid) returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from company_members
       where company_id = cid and user_id = auth.uid() and active and role in ('owner','admin')) $$;

-- 3. Colleagues can read each other's profile (same company only).
create function shares_company_with(uid uuid) returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from company_members a join company_members b on a.company_id = b.company_id
       where a.user_id = auth.uid() and a.active and b.user_id = uid) $$;

drop policy profiles_select on profiles;
create policy profiles_select on profiles for select to authenticated
  using (id = auth.uid() or shares_company_with(id));

-- 4. Admins manage members, but never the owner row and never grant ownership.
drop policy members_select on company_members;
create policy members_select on company_members for select to authenticated
  using (user_id = auth.uid() or is_company_member(company_id));
drop policy members_update on company_members;
create policy members_update on company_members for update to authenticated
  using (is_company_admin(company_id) and role <> 'owner')
  with check (is_company_admin(company_id) and role <> 'owner');
drop policy members_delete on company_members;
create policy members_delete on company_members for delete to authenticated
  using (is_company_admin(company_id) and role <> 'owner');
drop policy members_insert on company_members;  -- members join only through accept_invite()

-- 5. Invites.
create table company_invites (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  email       text not null check (email ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  role        member_role not null default 'staff' check (role <> 'owner'),
  token       text not null unique default encode(gen_random_bytes(16), 'hex'),
  created_by  uuid not null default auth.uid() references auth.users(id),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz
);
create index on company_invites (company_id);
alter table company_invites enable row level security;
create policy invites_select on company_invites for select to authenticated using (is_company_admin(company_id));
create policy invites_insert on company_invites for insert to authenticated
  with check (is_company_admin(company_id) and created_by = auth.uid());
create policy invites_delete on company_invites for delete to authenticated using (is_company_admin(company_id));

-- Public lookup used by the invite page (reveals only company name, role and invited email).
create function get_invite(p_token text) returns table (company_name text, role member_role, email text)
  language sql stable security definer set search_path = public as
  $$ select c.name, i.role, i.email from company_invites i join companies c on c.id = i.company_id
     where i.token = p_token and i.accepted_at is null and i.expires_at > now() $$;
grant execute on function get_invite(text) to anon, authenticated;

-- Accepting requires being signed in as the invited email.
create function accept_invite(p_token text) returns uuid
  language plpgsql security definer set search_path = public as
$$ declare inv company_invites; begin
  select * into inv from company_invites where token = p_token and accepted_at is null and expires_at > now();
  if not found then raise exception 'This invite is invalid or has expired.'; end if;
  if lower(inv.email) <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'This invite was sent to a different email address.';
  end if;
  insert into company_members (company_id, user_id, role) values (inv.company_id, auth.uid(), inv.role)
    on conflict (company_id, user_id) do update set role = excluded.role, active = true;
  update company_invites set accepted_at = now() where id = inv.id;
  return inv.company_id;
end $$;
revoke execute on function accept_invite(text) from anon;
grant execute on function accept_invite(text) to authenticated;
