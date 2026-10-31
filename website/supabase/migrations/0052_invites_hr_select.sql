-- Cursor 2026-10-24: HR must list pending invites (employees who have not set a password yet).
-- create_employee_invite is already HR-capable (security definer); select was admin-only.

drop policy if exists invites_select on company_invites;
create policy invites_select on company_invites
  for select to authenticated
  using (is_company_hr(company_id));

-- Allow HR to remove unused invites from the directory.
drop policy if exists invites_delete on company_invites;
create policy invites_delete on company_invites
  for delete to authenticated
  using (is_company_hr(company_id));
