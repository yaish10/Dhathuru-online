-- SAMPLE DATA, part 2: give the sample passengers (bookings whose note starts with SAMPLE) fares so "Mark as paid" can be tested.
-- Test company only. All bookings stay Unpaid. Fares in MVR: Adult 120, Child 60, Senior 60, Student 80, Resident 100, Tourist 250.
do $$
declare cid uuid;
begin
  select company_id into cid from bookings where note like 'SAMPLE%' limit 1;
  if cid is null then raise exception 'No sample bookings found.'; end if;
  if (select name from companies where id = cid) <> 'Coral Line Ferries (Test)' then raise exception 'Not the test company.'; end if;
  update booking_passengers bp set fare = case bp.category when 'Adult' then 120 when 'Child' then 60 when 'Senior' then 60
      when 'Student' then 80 when 'Resident' then 100 when 'Tourist' then 250 else 100 end
    where bp.booking_id in (select id from bookings where note like 'SAMPLE%');
  update bookings b set fare_total = (select coalesce(sum(fare), 0) from booking_passengers where booking_id = b.id and status <> 'Cancelled'),
      paid_amount = 0, payment_status = 'Unpaid'
    where note like 'SAMPLE%';
end $$;
