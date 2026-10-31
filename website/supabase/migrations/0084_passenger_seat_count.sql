-- Renumbered by Claude 2026-10-30: was 0063 (taken — veyora already has 0001–0083 applied). Apply after 0083.
-- Merged with the live versions so nothing regresses: booking_create_core keeps the quick-add rule from 0080
-- (veyora.quick_add → name + phone only) and update_booking_passengers keeps ops_require_checkin from 0071.
-- Cursor 2026-10-30: extra seats stay on one passenger (meta.seats + seat_no).
-- They are not saved as another person. Seat totals count those seats.

create or replace function booking_line_seats(p_meta jsonb) returns integer
  language sql immutable as
$$ select least(30, greatest(1,
     case when coalesce(p_meta->>'seats', '') ~ '^[0-9]+$' then (p_meta->>'seats')::int else 1 end)) $$;
revoke execute on function booking_line_seats(jsonb) from anon, public;

create or replace function trip_recount(p_trip uuid) returns void
  language sql security definer set search_path = public as
$$ update trips set seats_booked = coalesce((
     select sum(booking_line_seats(bp.meta)) from booking_passengers bp
       join bookings b on b.id = bp.booking_id
      where bp.trip_id = p_trip and booking_holds_seat(b.status, bp.status)), 0)
   where id = p_trip $$;
revoke execute on function trip_recount(uuid) from anon, public, authenticated;

create or replace function booking_passengers_count() returns trigger
  language plpgsql security definer set search_path = public as
$$ declare bid uuid; tid uuid;
begin
  bid := coalesce(new.booking_id, old.booking_id); tid := coalesce(new.trip_id, old.trip_id);
  update bookings set passenger_count = coalesce((
    select sum(booking_line_seats(meta)) from booking_passengers where booking_id = bid and status <> 'Cancelled'), 0),
    updated_at = now() where id = bid;
  perform trip_recount(tid);
  if tg_op = 'UPDATE' and old.trip_id <> new.trip_id then perform trip_recount(old.trip_id); end if;
  return null;
end $$;

create or replace function booking_create_core(p_company uuid, p_trip uuid, p_booking jsonb, p_pax jsonb, p_source text, p_staff boolean, p_key uuid default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare
  t trips; r routes; cut jsonb; req jsonb; n int; b bookings; p jsonb; pid uuid; fare numeric; total numeric := 0; seats int; i int := 0;
  missing text[]; need int; sc int; line_meta jsonb;
begin
  select * into t from trips where id = p_trip and company_id = p_company;
  if not found then raise exception 'Trip not found.'; end if;
  if trip_closed(t.status) or t.status in ('Departed', 'In transit') then raise exception 'This trip is % and can no longer be booked.', lower(t.status); end if;
  if jsonb_typeof(p_pax) <> 'array' or jsonb_array_length(p_pax) = 0 then raise exception 'Add at least one passenger.'; end if;
  if jsonb_array_length(p_pax) > 100 then raise exception 'Book up to 100 passengers at a time.'; end if;
  select * into r from routes where id = t.route_id;
  cut := company_setting(p_company, '7_booking_cut_off_times');
  if not p_staff then
    if t.depart_at < now() + make_interval(mins => coalesce(nullif(cut->>'close', '')::int, 30)) then raise exception 'Bookings for this trip have closed.'; end if;
    if t.depart_at > now() + make_interval(days => coalesce(nullif(cut->>'advance', '')::int, 30)) then raise exception 'Bookings for this trip are not open yet.'; end if;
  elsif t.depart_at < now() and not coalesce((cut->>'walkup')::boolean, true) then
    raise exception 'Walk-up bookings are turned off.';
  end if;
  select coalesce(sum(booking_line_seats(jsonb_build_object('seats', x->>'seats'))), 0) into need from jsonb_array_elements(p_pax) x;
  seats := trip_sellable_seats(t.id);
  if seats is not null and t.seats_booked + need > seats then
    raise exception 'Only % seat(s) left on this trip.', greatest(0, seats - t.seats_booked);
  end if;
  -- A quick add from the apps (flag set by quick_add_passengers, 0080) needs only a name and a phone number; every other source follows the setting.
  req := case when p_staff and current_setting('veyora.quick_add', true) = '1' then '{"id": false, "phone": true}'::jsonb
              else company_setting(p_company, '7_required_passenger_information') end;
  for p in select * from jsonb_array_elements(p_pax) loop
    i := i + 1; missing := '{}';
    if coalesce(char_length(btrim(p->>'full_name')), 0) < 2 then missing := missing || 'full name'::text; end if;
    if coalesce((req->>'id')::boolean, true) and coalesce(btrim(p->>'id_number'), '') = '' and nullif(p->>'passenger_id', '') is null then missing := missing || 'ID / passport number'::text; end if;
    if coalesce((req->>'phone')::boolean, true) and coalesce(btrim(p->>'phone'), '') = '' and coalesce(btrim(p_booking->>'contact_phone'), '') = '' then missing := missing || 'phone number'::text; end if;
    if coalesce((req->>'email')::boolean, false) and coalesce(btrim(p->>'email'), '') = '' and coalesce(btrim(p_booking->>'contact_email'), '') = '' then missing := missing || 'email'::text; end if;
    if coalesce((req->>'nationality')::boolean, false) and coalesce(btrim(p->>'nationality'), '') = '' then missing := missing || 'nationality'::text; end if;
    if coalesce((req->>'dob')::boolean, false) and nullif(p->>'dob', '') is null then missing := missing || 'date of birth'::text; end if;
    if coalesce((req->>'emergency')::boolean, false) and coalesce(btrim(p->>'emergency_contact'), '') = '' then missing := missing || 'emergency contact'::text; end if;
    if cardinality(missing) > 0 then raise exception 'Passenger %: add %.', i, array_to_string(missing, ', '); end if;
  end loop;

  perform pg_advisory_xact_lock(hashtext('bkg_' || p_company::text));
  select greatest(coalesce(max(number), 0) + 1, coalesce(nullif(company_setting(p_company, '7_booking_reference_format')->>'start', '')::int, 1))
    into n from bookings where company_id = p_company;
  insert into bookings (company_id, number, reference, trip_id, source, status, contact_name, contact_phone, contact_email, ticket_type,
                        payment_method, paid_amount, note, api_key_id, meta, created_by)
    values (p_company, n, fmt_code(p_company, '7_booking_reference_format', 'BK', n), t.id, p_source,
            case when p_staff then coalesce(nullif(btrim(p_booking->>'status'), ''), 'Confirmed') else 'Confirmed' end,
            nullif(btrim(p_booking->>'contact_name'), ''), nullif(btrim(p_booking->>'contact_phone'), ''), nullif(btrim(p_booking->>'contact_email'), ''),
            nullif(btrim(p_booking->>'ticket_type'), ''),
            case when p_staff then nullif(btrim(p_booking->>'payment_method'), '') end,
            case when p_staff then coalesce(nullif(p_booking->>'paid_amount', '')::numeric, 0) else 0 end,
            nullif(btrim(p_booking->>'note'), ''), p_key,
            case when jsonb_typeof(p_booking->'meta') = 'object' then p_booking->'meta' else '{}'::jsonb end, auth.uid())
    returning * into b;
  for p in select * from jsonb_array_elements(p_pax) loop
    pid := nullif(p->>'passenger_id', '')::uuid;
    if pid is not null and not exists (select 1 from passengers where id = pid and company_id = p_company) then pid := null; end if;
    if pid is null and coalesce((p->>'save')::boolean, true) then
      if coalesce(btrim(p->>'id_number'), '') <> '' then
        select id into pid from passengers where company_id = p_company and lower(id_number) = lower(btrim(p->>'id_number'));
      end if;
      if pid is null then
        insert into passengers (company_id, full_name, phone, email, id_number, nationality, dob, category, emergency_contact, created_by)
          values (p_company, btrim(p->>'full_name'), nullif(btrim(coalesce(p->>'phone', p_booking->>'contact_phone')), ''), nullif(btrim(coalesce(p->>'email', p_booking->>'contact_email')), ''),
                  nullif(btrim(p->>'id_number'), ''), nullif(btrim(p->>'nationality'), ''), nullif(p->>'dob', '')::date, nullif(btrim(p->>'category'), ''),
                  nullif(btrim(p->>'emergency_contact'), ''), auth.uid())
          returning id into pid;
      end if;
    end if;
    sc := booking_line_seats(jsonb_build_object('seats', p->>'seats'));
    fare := case when p_staff and nullif(p->>'fare', '') is not null then (p->>'fare')::numeric else route_fare(t.route_id, nullif(btrim(p->>'category'), '')) end;
    fare := fare * sc;
    total := total + fare;
    line_meta := case when jsonb_typeof(p->'meta') = 'object' then p->'meta' else '{}'::jsonb end || jsonb_build_object('seats', sc);
    insert into booking_passengers (company_id, booking_id, trip_id, passenger_id, full_name, category, id_number, nationality, phone, seat_no, fare, meta)
      values (p_company, b.id, t.id, pid, btrim(p->>'full_name'), nullif(btrim(p->>'category'), ''), nullif(btrim(p->>'id_number'), ''),
              nullif(btrim(p->>'nationality'), ''), nullif(btrim(p->>'phone'), ''), nullif(btrim(p->>'seat_no'), ''), fare, line_meta);
  end loop;
  update bookings set fare_total = total,
    payment_status = case when paid_amount >= total and total > 0 then 'Paid' when paid_amount > 0 then 'Partly paid' when total = 0 then 'Paid' else 'Unpaid' end
    where id = b.id returning * into b;
  insert into trip_events (company_id, trip_id, kind, detail, actor) values (p_company, t.id, 'booking', b.reference || ': ' || b.passenger_count || ' seat(s), ' || p_source, auth.uid());
  return booking_json(b.id);
end $$;

create or replace function update_booking_passengers(p_booking uuid, p_add jsonb default '[]'::jsonb, p_remove uuid[] default '{}') returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare b bookings; t trips; p jsonb; fare numeric; seats int; need int; sc int; line_meta jsonb;
begin
  select * into b from bookings where id = p_booking;
  if not found then raise exception 'Booking not found.'; end if;
  if not is_company_member(b.company_id) then raise exception 'Not a member of this company.'; end if;
  perform ops_require_checkin(b.company_id);   -- kept from 0071 (Operations check-in)
  select * into t from trips where id = b.trip_id;
  update booking_passengers set status = 'Cancelled' where booking_id = b.id and id = any(coalesce(p_remove, '{}'));
  if jsonb_typeof(p_add) = 'array' and jsonb_array_length(p_add) > 0 then
    select * into t from trips where id = b.trip_id;
    seats := trip_sellable_seats(t.id);
    select coalesce(sum(booking_line_seats(jsonb_build_object('seats', x->>'seats'))), 0) into need from jsonb_array_elements(p_add) x;
    if seats is not null and t.seats_booked + need > seats then raise exception 'Only % seat(s) left on this trip.', greatest(0, seats - t.seats_booked); end if;
    for p in select * from jsonb_array_elements(p_add) loop
      if coalesce(char_length(btrim(p->>'full_name')), 0) < 2 then raise exception 'Each passenger needs a name.'; end if;
      sc := booking_line_seats(jsonb_build_object('seats', p->>'seats'));
      fare := coalesce(nullif(p->>'fare', '')::numeric, route_fare(t.route_id, nullif(btrim(p->>'category'), ''))) * sc;
      line_meta := case when jsonb_typeof(p->'meta') = 'object' then p->'meta' else '{}'::jsonb end || jsonb_build_object('seats', sc);
      insert into booking_passengers (company_id, booking_id, trip_id, passenger_id, full_name, category, id_number, nationality, phone, seat_no, fare, meta)
        values (b.company_id, b.id, t.id, nullif(p->>'passenger_id', '')::uuid, btrim(p->>'full_name'), nullif(btrim(p->>'category'), ''), nullif(btrim(p->>'id_number'), ''),
                nullif(btrim(p->>'nationality'), ''), nullif(btrim(p->>'phone'), ''), nullif(btrim(p->>'seat_no'), ''), fare, line_meta);
    end loop;
  end if;
  update bookings set fare_total = (select coalesce(sum(fare), 0) from booking_passengers where booking_id = b.id and status <> 'Cancelled') where id = b.id;
  return booking_json(b.id);
end $$;

create or replace function trip_manifest(p_trip uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare t trips;
begin
  select * into t from trips where id = p_trip;
  if not found then raise exception 'Trip not found.'; end if;
  if not is_company_member(t.company_id) then raise exception 'Not a member of this company.'; end if;
  return jsonb_build_object(
    'trip_id', t.id, 'code', t.code, 'seats_total', t.seats_total, 'seats_booked', t.seats_booked, 'sellable', trip_sellable_seats(t.id),
    'counts', (select jsonb_build_object(
                 'booked', coalesce(sum(booking_line_seats(bp.meta)) filter (where booking_holds_seat(b.status, bp.status)), 0),
                 'checked_in', coalesce(sum(booking_line_seats(bp.meta)) filter (where bp.status = 'Checked in'), 0),
                 'boarded', coalesce(sum(booking_line_seats(bp.meta)) filter (where bp.status = 'Boarded'), 0),
                 'no_show', coalesce(sum(booking_line_seats(bp.meta)) filter (where bp.status = 'No-show'), 0),
                 'cancelled', coalesce(sum(booking_line_seats(bp.meta)) filter (where not booking_holds_seat(b.status, bp.status)), 0),
                 'revenue', coalesce(sum(bp.fare) filter (where booking_holds_seat(b.status, bp.status)), 0))
               from booking_passengers bp join bookings b on b.id = bp.booking_id where bp.trip_id = t.id),
    'passengers', coalesce((select jsonb_agg(jsonb_build_object('id', bp.id, 'booking_id', b.id, 'reference', b.reference, 'source', b.source,
                 'booking_status', b.status, 'payment_status', b.payment_status, 'contact_phone', b.contact_phone,
                 'full_name', bp.full_name, 'category', bp.category, 'id_number', bp.id_number, 'nationality', bp.nationality, 'phone', bp.phone,
                 'seat_no', bp.seat_no, 'fare', bp.fare, 'status', bp.status, 'checked_in_at', bp.checked_in_at, 'boarded_at', bp.boarded_at,
                 'passenger_id', bp.passenger_id, 'meta', bp.meta) order by b.number, bp.created_at)
               from booking_passengers bp join bookings b on b.id = bp.booking_id where bp.trip_id = t.id), '[]'::jsonb));
end $$;
