-- Quick add of passengers from the apps: pick a trip, then a name, a phone number (required) and the number of seats.
-- One booking with one passenger per seat: the lead passenger has the name, the other seats are "<name> (guest 2)", "(guest 3)"...
-- Passenger Settings → Required Passenger Information still applies to the customer page, the API and full bookings; a quick add
-- needs only a name and a phone number. The relaxed rule is switched on only inside quick_add_passengers (a transaction-local flag a client
-- cannot set), never by anything in a request.

create or replace function booking_create_core(p_company uuid, p_trip uuid, p_booking jsonb, p_pax jsonb, p_source text, p_staff boolean, p_key uuid default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare
  t trips; r routes; cut jsonb; req jsonb; n int; b bookings; p jsonb; pid uuid; fare numeric; total numeric := 0; seats int; sold int; i int := 0;
  missing text[];
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
  -- capacity
  seats := trip_sellable_seats(t.id);
  if seats is not null and t.seats_booked + jsonb_array_length(p_pax) > seats then
    raise exception 'Only % seat(s) left on this trip.', greatest(0, seats - t.seats_booked);
  end if;
  -- required passenger information
  -- A quick add from the apps (flag set by quick_add_passengers) needs only a name and a phone number; every other source follows the setting.
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
      -- add to the registry, matching an existing passenger by ID number
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
    fare := case when p_staff and nullif(p->>'fare', '') is not null then (p->>'fare')::numeric else route_fare(t.route_id, nullif(btrim(p->>'category'), '')) end;
    total := total + fare;
    insert into booking_passengers (company_id, booking_id, trip_id, passenger_id, full_name, category, id_number, nationality, phone, seat_no, fare, meta)
      values (p_company, b.id, t.id, pid, btrim(p->>'full_name'), nullif(btrim(p->>'category'), ''), nullif(btrim(p->>'id_number'), ''),
              nullif(btrim(p->>'nationality'), ''), nullif(btrim(p->>'phone'), ''), nullif(btrim(p->>'seat_no'), ''), fare,
              case when jsonb_typeof(p->'meta') = 'object' then p->'meta' else '{}'::jsonb end);
  end loop;
  update bookings set fare_total = total,
    payment_status = case when paid_amount >= total and total > 0 then 'Paid' when paid_amount > 0 then 'Partly paid' when total = 0 then 'Paid' else 'Unpaid' end
    where id = b.id returning * into b;
  insert into trip_events (company_id, trip_id, kind, detail, actor) values (p_company, t.id, 'booking', b.reference || ': ' || b.passenger_count || ' passenger(s), ' || p_source, auth.uid());
  return booking_json(b.id);
end $$;
revoke execute on function booking_create_core(uuid, uuid, jsonb, jsonb, text, boolean, uuid) from anon, public, authenticated;

create function quick_add_passengers(p_company uuid, p_trip uuid, p_name text, p_phone text, p_seats integer default 1) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare nm text := btrim(coalesce(p_name, '')); ph text := btrim(coalesce(p_phone, '')); seats int := coalesce(p_seats, 1); pax jsonb := '[]'::jsonb; i int; res jsonb;
begin
  if not is_company_member(p_company) then raise exception 'Not a member of this company.'; end if;
  if char_length(nm) < 2 then raise exception 'Enter the passenger name.'; end if;
  if ph !~ '[0-9]' or char_length(regexp_replace(ph, '[^0-9]', '', 'g')) < 6 then raise exception 'Enter a phone number (required).'; end if;
  if seats < 1 or seats > 20 then raise exception 'Seats must be between 1 and 20.'; end if;
  for i in 1 .. seats loop
    pax := pax || jsonb_build_array(jsonb_build_object('full_name', case when i = 1 then nm else nm || ' (guest ' || i || ')' end,
                                                       'category', 'Adult', 'phone', ph));
  end loop;
  perform set_config('veyora.quick_add', '1', true);
  res := booking_create_core(p_company, p_trip,
    jsonb_build_object('contact_name', nm, 'contact_phone', ph, 'source', 'Manual', 'status', 'Confirmed', 'meta', jsonb_build_object('quick', true, 'seats', seats)),
    pax, 'Manual', true, null);
  perform set_config('veyora.quick_add', '0', true);
  return res;
end $$;
revoke execute on function quick_add_passengers(uuid, uuid, text, text, integer) from anon, public;
grant execute on function quick_add_passengers(uuid, uuid, text, text, integer) to authenticated;

-- The website's Operations "Add passenger" form uses the same relaxed rule: a name and a phone number are enough, ID is optional.
create function create_booking_quick(p_company uuid, p_trip uuid, p_booking jsonb, p_passengers jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare res jsonb;
begin
  if not is_company_member(p_company) then raise exception 'Not a member of this company.'; end if;
  perform set_config('veyora.quick_add', '1', true);
  res := booking_create_core(p_company, p_trip, coalesce(p_booking, '{}'::jsonb), p_passengers,
                             coalesce(nullif(btrim(p_booking->>'source'), ''), 'Manual'), true, null);
  perform set_config('veyora.quick_add', '0', true);
  return res;
end $$;
revoke execute on function create_booking_quick(uuid, uuid, jsonb, jsonb) from anon, public;
grant execute on function create_booking_quick(uuid, uuid, jsonb, jsonb) to authenticated;
