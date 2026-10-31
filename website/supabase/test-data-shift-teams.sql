-- Test data for "Coral Line Ferries (Test)" (VY-BPWTJT), 22 Oct 2026:
-- each of Day, Evening and Night needs 1 Captain, 2 Crew and 1 Cashier, and the 4 crew get matching designations:
-- Ahmed Raza = Captain, Hassan Waheed = Crew, Ibrahim Sameer = Crew, Adam Faisal = Cashier. Adds and updates only.
do $$
declare cid uuid; t_crew uuid; t_cash uuid; t_capt uuid; sh jsonb;
begin
  select id into cid from companies where code = 'VY-BPWTJT';
  perform set_config('veyora.subscription_write', 'on', true);

  select id into t_crew from job_titles where company_id = cid and lower(title) = 'crew';
  if t_crew is null then insert into job_titles (company_id, title, crew_group) values (cid, 'Crew', 'Deck') returning id into t_crew; end if;
  select id into t_cash from job_titles where company_id = cid and lower(title) = 'cashier';
  if t_cash is null then insert into job_titles (company_id, title, crew_group) values (cid, 'Cashier', 'Shore') returning id into t_cash; end if;
  select id into t_capt from job_titles where company_id = cid and lower(title) = 'captain';

  update company_members set job_title_id = t_capt where company_id = cid and user_id = (select id from auth.users where email = 'ahmed@coralline.test');
  update company_members set job_title_id = t_crew where company_id = cid and user_id in (select id from auth.users where email in ('hassan@coralline.test', 'sameer@coralline.test'));
  update company_members set job_title_id = t_cash where company_id = cid and user_id = (select id from auth.users where email = 'adam@coralline.test');

  -- Team per shift on D, E and N (other shifts, like your "mobile" M, are left as they are).
  select jsonb_agg(case when s->>'code' in ('D', 'E', 'N') then s || '{"team": "1 Captain, 2 Crew, 1 Cashier"}'::jsonb else s end)
    into sh from companies, jsonb_array_elements(settings->'8_shift_definitions') s where id = cid;
  if sh is not null then update companies set settings = jsonb_set(settings, '{8_shift_definitions}', sh) where id = cid; end if;
end $$;

select u.email, jt.title, jt.crew_group from company_members m join auth.users u on u.id = m.user_id left join job_titles jt on jt.id = m.job_title_id
where m.company_id = (select id from companies where code = 'VY-BPWTJT') order by jt.title;
