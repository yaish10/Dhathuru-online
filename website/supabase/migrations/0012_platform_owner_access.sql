-- The platform owner can open any company (company switcher) and work with its data as an admin.
-- Policies already route through these helpers, so widening them covers members, invites,
-- departments, job titles, the company audit log, settings RPCs and logo uploads.
create or replace function is_company_member(cid uuid) returns boolean
  language sql stable security definer set search_path = public as
  $$ select is_platform_admin()
     or exists (select 1 from company_members where company_id = cid and user_id = auth.uid() and active) $$;

create or replace function is_company_admin(cid uuid) returns boolean
  language sql stable security definer set search_path = public as
  $$ select is_platform_admin()
     or exists (select 1 from company_members
       where company_id = cid and user_id = auth.uid() and active and role in ('owner','admin')) $$;

-- Names and emails of a company's people are visible to the platform owner too.
drop policy profiles_select on profiles;
create policy profiles_select on profiles for select to authenticated
  using (id = auth.uid() or shares_company_with(id) or is_platform_admin());
