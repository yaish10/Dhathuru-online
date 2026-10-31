-- Test data for "Coral Line Ferries (Test)" (VY-BPWTJT): a Thulusdhoo ⇄ Malé speedboat timetable.
-- Saturday–Thursday: from Thulusdhoo 08:00 10:15 14:15 17:00 20:00 · from Malé 09:15 12:15 16:00 18:30 22:15
-- Friday:            from Thulusdhoo 08:00 14:15 17:00 20:00       · from Malé 09:15 16:00 18:30 22:15
-- One speedboat (SB-07) runs the whole day; each crossing takes 40 minutes. Adds only; deletes nothing.
-- Trips are made for the next 30 days with generate_trips (run as the test company owner so its rules apply).
do $$
declare
  cid uuid; owner_id uuid; boat uuid; r_tm uuid; r_mt uuid; t uuid; res jsonb; made int := 0; skipped int := 0;
  rec record;
begin
  select id into cid from companies where code = 'VY-BPWTJT';
  if cid is null then raise exception 'Test company VY-BPWTJT not found.'; end if;
  select u.id into owner_id from auth.users u where u.email = 'owner@coralline.test';
  select id into boat from vessels where company_id = cid and code = 'SB-07';

  -- Routes: reuse "Male' - Thulusdhoo", add the return direction.
  select id into r_mt from routes where company_id = cid and origin = 'Male''' and destination = 'Thulusdhoo' limit 1;
  if r_mt is null then
    insert into routes (company_id, code, name, origin, destination, duration_min, fare)
      values (cid, 'M-T', 'Male'' - Thulusdhoo', 'Male''', 'Thulusdhoo', 40, 150) returning id into r_mt;
  end if;
  select id into r_tm from routes where company_id = cid and origin = 'Thulusdhoo' and destination = 'Male''' limit 1;
  if r_tm is null then
    insert into routes (company_id, code, name, origin, destination, duration_min, fare)
      values (cid, 'T-M', 'Thulusdhoo - Male''', 'Thulusdhoo', 'Male''', 40, 150) returning id into r_tm;
  end if;

  -- Timetable (ISO weekdays: 1 = Mon … 5 = Fri … 7 = Sun).
  for rec in select * from (values
      (r_tm, 'Thulusdhoo - Male'' · 08:00', '08:00'::time, '{1,2,3,4,5,6,7}'::smallint[]),
      (r_tm, 'Thulusdhoo - Male'' · 10:15', '10:15', '{1,2,3,4,6,7}'),
      (r_tm, 'Thulusdhoo - Male'' · 14:15', '14:15', '{1,2,3,4,5,6,7}'),
      (r_tm, 'Thulusdhoo - Male'' · 17:00', '17:00', '{1,2,3,4,5,6,7}'),
      (r_tm, 'Thulusdhoo - Male'' · 20:00', '20:00', '{1,2,3,4,5,6,7}'),
      (r_mt, 'Male'' - Thulusdhoo · 09:15', '09:15', '{1,2,3,4,5,6,7}'),
      (r_mt, 'Male'' - Thulusdhoo · 12:15', '12:15', '{1,2,3,4,6,7}'),
      (r_mt, 'Male'' - Thulusdhoo · 16:00', '16:00', '{1,2,3,4,5,6,7}'),
      (r_mt, 'Male'' - Thulusdhoo · 18:30', '18:30', '{1,2,3,4,5,6,7}'),
      (r_mt, 'Male'' - Thulusdhoo · 22:15', '22:15', '{1,2,3,4,5,6,7}')
    ) v(route_id, name, dep, days)
  loop
    select id into t from schedule_templates where company_id = cid and name = rec.name;
    if t is null then
      insert into schedule_templates (company_id, name, route_id, vessel_id, kind, depart_time, duration_min, weekdays, meta)
        values (cid, rec.name, rec.route_id, boat, 'Fixed', rec.dep, 40, rec.days, '{"test": true}') returning id into t;
    end if;
    -- generate_trips checks Operations rights with auth.uid(), so run it as the test owner.
    perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
    res := generate_trips(t, current_date, current_date + 30);
    made := made + (res->>'created')::int;
    skipped := skipped + jsonb_array_length(res->'skipped');
  end loop;
  raise notice 'Timetable ready: % trips created, % skipped because of clashes.', made, skipped;
end $$;

-- Check: today's sailings on the two Thulusdhoo routes.
select to_char(t.depart_at at time zone 'Indian/Maldives', 'Dy DD Mon HH24:MI') as departs, r.name as route, v.code as boat, t.status
from trips t join routes r on r.id = t.route_id left join vessels v on v.id = t.vessel_id
where t.company_id = (select id from companies where code = 'VY-BPWTJT')
  and (t.depart_at at time zone 'Indian/Maldives')::date = (now() at time zone 'Indian/Maldives')::date
order by t.depart_at;
