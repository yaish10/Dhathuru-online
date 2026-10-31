-- One-time cleanup of the old test data created while building VEYORA.
-- Removes every account whose email matches veyora.test+...@gmail.com and every company they created
-- (with all of that company's staff links, invites, settings, HR, leave and roster data).
-- KEEPS: your own account and companies, and the test company "Coral Line Ferries (Test)" (@coralline.test).
-- This is permanent.

-- 1) Preview (read-only). Run this alone first and check the numbers.
select
  (select count(*) from auth.users where email like 'veyora.test+%@gmail.com') as users_to_delete,
  (select count(*) from companies c join auth.users u on u.id = c.created_by where u.email like 'veyora.test+%@gmail.com') as companies_to_delete,
  (select string_agg(email, ', ') from auth.users where email not like 'veyora.test+%@gmail.com' and email not like '%@coralline.test') as other_accounts_kept,
  (select string_agg(c.name, ', ') from companies c join auth.users u on u.id = c.created_by where u.email not like 'veyora.test+%@gmail.com') as companies_kept;

-- 2) Delete. Select ONLY this block and run it. It is one statement, so it either all happens or none of it does.
do $$
begin
  -- allow deleting expired test companies (the subscription lock would otherwise refuse)
  perform set_config('veyora.subscription_write', 'on', true);
  delete from companies
   where created_by in (select id from auth.users where email like 'veyora.test+%@gmail.com');
  delete from company_members
   where user_id in (select id from auth.users where email like 'veyora.test+%@gmail.com');
  delete from auth.users where email like 'veyora.test+%@gmail.com';
  raise notice 'Old test data removed.';
end $$;
