-- Cursor 2026-10-23: Company owners always have full access helpers (ops / IT / HR / maint / finance).
-- is_company_admin already includes owner; fold admin into the other helpers so owner never misses a module.

create or replace function is_company_owner(cid uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select is_platform_admin()
     or exists (select 1 from company_members
       where company_id = cid and user_id = auth.uid() and active and role = 'owner') $$;
revoke execute on function is_company_owner(uuid) from anon, public;
grant execute on function is_company_owner(uuid) to authenticated;

create or replace function is_company_hr(cid uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select is_company_admin(cid)
     or exists (select 1 from company_members
       where company_id = cid and user_id = auth.uid() and active and role = 'hr') $$;

create or replace function is_company_ops(cid uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select is_company_admin(cid)
     or exists (select 1 from company_members
       where company_id = cid and user_id = auth.uid() and active and role::text = 'operations') $$;

create or replace function is_company_it(cid uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select is_company_admin(cid)
     or exists (select 1 from company_members
       where company_id = cid and user_id = auth.uid() and active and role::text = 'it') $$;

create or replace function is_company_maint(cid uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select is_company_admin(cid)
     or exists (select 1 from company_members
       where company_id = cid and user_id = auth.uid() and active and role::text = 'operations')
     or auth.uid() = any(maint_named(cid)) $$;

create or replace function is_company_finance(cid uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select is_company_ops(cid) $$;

create or replace function is_company_reports(cid uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select is_company_ops(cid) or is_company_hr(cid) $$;
