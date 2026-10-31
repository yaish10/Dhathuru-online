-- SAMPLE DATA for the Operations passenger list (Coral Line Ferries (Test) only).
-- Adds 6 bookings / 10 passengers to trip TR-2026-000340 (Male' - Thulusdhoo, 22:15 on 28 Oct 2026) through create_booking,
-- then sets a few passenger statuses so every status colour shows. Every booking is marked "SAMPLE" in its note and meta.
-- Run in the Supabase SQL editor. Safe to run once; to remove it, run the cleanup block at the bottom.

do $$
declare
  tid uuid := '9263165a-5136-4cf2-ae40-3150d949b70c';
  cid uuid;
  uid uuid;
  nm  text;
begin
  select company_id, code into cid, nm from trips where id = tid;
  if cid is null then raise exception 'Trip not found.'; end if;
  if (select name from companies where id = cid) <> 'Coral Line Ferries (Test)' then
    raise exception 'Refusing to add sample data to a company that is not the test company.';
  end if;
  if exists (select 1 from bookings where trip_id = tid and note like 'SAMPLE%') then
    raise exception 'Sample passengers were already added to this trip.';
  end if;
  select user_id into uid from company_members where company_id = cid and active order by (role = 'owner') desc, created_at limit 1;
  -- act as a company member so create_booking's membership check passes
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);

  perform create_booking(cid, tid,
    '{"contact_name":"Ahmed Naseem","contact_phone":"7771001","ticket_type":"Standard","note":"SAMPLE booking (family)","meta":{"sample":true}}',
    '[{"full_name":"Ahmed Naseem","category":"Adult","id_number":"A100001","nationality":"Maldivian","phone":"7771001","seat_no":"A1","save":false},
      {"full_name":"Aishath Shifa","category":"Adult","id_number":"A100002","nationality":"Maldivian","phone":"7771001","seat_no":"A2","save":false},
      {"full_name":"Ibrahim Naseem","category":"Child","id_number":"A100003","nationality":"Maldivian","phone":"7771001","seat_no":"A3","save":false}]');
  perform create_booking(cid, tid,
    '{"contact_name":"Mohamed Ismail","contact_phone":"7772002","ticket_type":"Standard","note":"SAMPLE booking","meta":{"sample":true}}',
    '[{"full_name":"Mohamed Ismail","category":"Senior","id_number":"A200001","nationality":"Maldivian","phone":"7772002","seat_no":"B1","save":false}]');
  perform create_booking(cid, tid,
    '{"contact_name":"Emma Johnson","contact_phone":"+447700900123","ticket_type":"Standard","source":"Walk-up","note":"SAMPLE booking (tourists)","meta":{"sample":true}}',
    '[{"full_name":"Emma Johnson","category":"Tourist","id_number":"GB5561234","nationality":"British","phone":"+447700900123","seat_no":"B2","save":false},
      {"full_name":"Lukas Meyer","category":"Tourist","id_number":"DE7712345","nationality":"German","phone":"+447700900123","seat_no":"B3","save":false}]');
  perform create_booking(cid, tid,
    '{"contact_name":"Fathimath Nuzla","contact_phone":"7773003","ticket_type":"Standard","note":"SAMPLE booking","meta":{"sample":true}}',
    '[{"full_name":"Fathimath Nuzla","category":"Student","id_number":"A300001","nationality":"Maldivian","phone":"7773003","seat_no":"C1","save":false}]');
  perform create_booking(cid, tid,
    '{"contact_name":"Hussain Adam","contact_phone":"7774004","ticket_type":"Standard","note":"SAMPLE booking","meta":{"sample":true}}',
    '[{"full_name":"Hussain Adam","category":"Resident","id_number":"A400001","nationality":"Maldivian","phone":"7774004","seat_no":"C2","save":false},
      {"full_name":"Mariyam Shaana","category":"Resident","id_number":"A400002","nationality":"Maldivian","phone":"7774004","seat_no":"C3","save":false}]');
  perform create_booking(cid, tid,
    '{"contact_name":"Hawwa Zuhra","contact_phone":"7775005","ticket_type":"Standard","note":"SAMPLE booking","meta":{"sample":true}}',
    '[{"full_name":"Hawwa Zuhra","category":"Adult","id_number":"A500001","nationality":"Maldivian","phone":"7775005","seat_no":"D1","save":false}]');

  -- a mix of statuses (check-in normally opens 60 minutes before departure, so these are set directly for the sample)
  update booking_passengers set status = 'Checked in', checked_in_at = now()
    where trip_id = tid and full_name in ('Ahmed Naseem', 'Aishath Shifa', 'Mohamed Ismail');
  update booking_passengers set status = 'Boarded', checked_in_at = now(), boarded_at = now()
    where trip_id = tid and full_name in ('Emma Johnson', 'Lukas Meyer');
  update booking_passengers set status = 'No-show' where trip_id = tid and full_name = 'Hawwa Zuhra';
end $$;

-- To remove the sample data again (run separately):
-- delete from booking_passengers where booking_id in (select id from bookings where note like 'SAMPLE%');
-- delete from bookings where note like 'SAMPLE%';
-- update trips set seats_booked = (select count(*) from booking_passengers where trip_id = trips.id) where id = '9263165a-5136-4cf2-ae40-3150d949b70c';
