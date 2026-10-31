-- 0053: Staff-ID login.
-- Staff can sign in with a staff code instead of their email.
-- Preferred form (HR Add Employee):  <prefix>-<4 digits>  e.g.  vy-1000
--   stored on company_members.employee_no (unique per company).
-- Legacy form:  <company code>-<employee_no> when employee_no is not already prefix-digits.
--
-- The "staff-login" Edge Function resolves the code to the account email (service
-- role) and signs in. This view is readable ONLY by the service role, so emails can
-- never be enumerated from the browser.
--
-- Cursor 2026-10-26: the number stored on the member is itself a login code
-- (vy-1000, EMP-2026-000001). Also keep companycode-employee_no for older IDs.

create or replace view staff_login_lookup
  with (security_invoker = true) as
select lower(m.employee_no) as login_code,
       p.email              as email,
       c.status             as company_status
from company_members m
join companies c on c.id = m.company_id
join profiles  p on p.id = m.user_id
where m.employee_no is not null
  and m.employee_no <> ''
  and p.email is not null
union
select lower(c.code || '-' || m.employee_no),
       p.email,
       c.status
from company_members m
join companies c on c.id = m.company_id
join profiles  p on p.id = m.user_id
where m.employee_no is not null
  and m.employee_no <> ''
  and p.email is not null
  and lower(c.code || '-' || m.employee_no) <> lower(m.employee_no);

revoke all on staff_login_lookup from anon, authenticated;
grant select on staff_login_lookup to service_role;
