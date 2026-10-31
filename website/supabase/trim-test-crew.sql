-- Trim "Coral Line Ferries (Test)" (VY-BPWTJT) down to 4 crew for testing.
-- KEEPS the 4 office logins (owner, Shifa admin, Hana HR, Ali operations) and 4 crew:
--   Ahmed Raza (Captain), Hassan Waheed (Speedboat Operator), Adam Faisal (Chief Engineer), Ibrahim Sameer (Deckhand).
-- DELETES these 10 test accounts and everything tied to them (roster, leave, attendance, timesheets, crew on trips…):
--   riyan, naila, husain, ismail, imran, liya, ziyad, riyanali, shafna, rishfa  (all @coralline.test)
-- This is permanent.

-- 1) Preview (read-only). Run this alone first: it should list the 10 accounts.
select u.email, m.role, coalesce(jt.title, m.role_label) as designation
from auth.users u
join company_members m on m.user_id = u.id and m.company_id = (select id from companies where code = 'VY-BPWTJT')
left join job_titles jt on jt.id = m.job_title_id
where u.email in ('riyan@coralline.test', 'naila@coralline.test', 'husain@coralline.test', 'ismail@coralline.test', 'imran@coralline.test',
                  'liya@coralline.test', 'ziyad@coralline.test', 'riyanali@coralline.test', 'shafna@coralline.test', 'rishfa@coralline.test')
order by u.email;

-- 2) Delete. Select ONLY this block and run it. It is one statement, so it either all happens or none of it does.
do $$
declare n int;
begin
  perform set_config('veyora.subscription_write', 'on', true);  -- the subscription lock would otherwise refuse
  delete from company_members
   where user_id in (select id from auth.users where email in ('riyan@coralline.test', 'naila@coralline.test', 'husain@coralline.test', 'ismail@coralline.test', 'imran@coralline.test',
                   'liya@coralline.test', 'ziyad@coralline.test', 'riyanali@coralline.test', 'shafna@coralline.test', 'rishfa@coralline.test'));
  delete from auth.users
   where email in ('riyan@coralline.test', 'naila@coralline.test', 'husain@coralline.test', 'ismail@coralline.test', 'imran@coralline.test',
                   'liya@coralline.test', 'ziyad@coralline.test', 'riyanali@coralline.test', 'shafna@coralline.test', 'rishfa@coralline.test');
  get diagnostics n = row_count;
  raise notice '% test accounts removed.', n;
end $$;
