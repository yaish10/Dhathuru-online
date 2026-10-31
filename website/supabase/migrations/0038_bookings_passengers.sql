-- Passengers and bookings: passenger registry, bookings per trip (manual counter / walk-up / customer page / API),
-- passengers on each booking with check-in and boarding, seat counts kept on trips, capacity and cut-off rules,
-- refunds, trip manifest. Rules come from Passenger & Booking Settings (7_) and Operations Settings (3_):
--   7_booking_reference_format, 7_booking_cut_off_times, 7_required_passenger_information, 7_check_in_rules,
--   7_cancellation_and_refund_rules, 3_passenger_capacity_rules.
-- Extends without new SQL: every table has `meta jsonb`; statuses, sources, categories and ticket types are free text
-- (lists live in 7_ settings). Fixed meaning only for: booking Cancelled/Refunded and passenger Cancelled (seat freed).

-- 1. Shared helpers.
create function company_setting(p_company uuid, p_key text) returns jsonb
  language sql stable security definer set search_path = public as
$$ select coalesce((select settings->p_key from companies where id = p_company), '{}'::jsonb) $$;
revoke execute on function company_setting(uuid, text) from anon, public;

-- Number formats saved with the fmt() setting (prefix, sep, year, digits, start), e.g. BK-2026-000001.
create function fmt_code(p_company uuid, p_key text, p_prefix text, p_n int) returns text
  language sql stable security definer set search_path = public as
$$ select coalesce(nullif(f->>'prefix', ''), p_prefix)
       || case when coalesce(f->>'sep', '-') = 'none' then '' else coalesce(f->>'sep', '-') end
       || case when coalesce((f->>'year')::boolean, true) then to_char(current_date, 'YYYY') || case when coalesce(f->>'sep', '-') = 'none' then '' else coalesce(f->>'sep', '-') end else '' end
       || lpad(p_n::text, greatest(1, least(10, coalesce(nullif(f->>'digits', '')::int, 6))), '0')
   from (select company_setting(p_company, p_key) f) x $$;
revoke execute on function fmt_code(uuid, text, text, int) from anon, public;

-- 2. Passenger registry (filled automatically from bookings, or added by staff).
create table passengers (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  full_name         text not null check (char_length(btrim(full_name)) between 2 and 120),
  phone             text check (phone is null or char_length(phone) <= 40),
  email             text check (email is null or char_length(email) <= 160),
  id_number         text check (id_number is null or char_length(id_number) <= 60),
  nationality       text check (nationality is null or char_length(nationality) <= 60),
  dob               date,
  category          text check (category is null or char_length(category) <= 40),
  emergency_contact text check (emergency_contact is null or char_length(emergency_contact) <= 200),
  note              text check (note is null or char_length(note) <= 500),
  meta              jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 16384),
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index passengers_id_number on passengers (company_id, lower(id_number)) where id_number is not null;
create index on passengers (company_id, lower(full_name));
alter table passengers enable row level security;
create policy pax_select on passengers for select to authenticated using (is_company_member(company_id));
create policy pax_insert on passengers for insert to authenticated with check (is_company_member(company_id));
create policy pax_update on passengers for update to authenticated using (is_company_member(company_id)) with check (is_company_member(company_id));
create policy pax_delete on passengers for delete to authenticated using (is_company_ops(company_id));
create trigger pax_subscription before insert or update or delete on passengers for each row execute function reject_if_subscription_expired();

-- 3. Bookings.
create table bookings (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  number          integer not null,
  reference       text not null,
  trip_id         uuid not null references trips(id) on delete restrict,
  source          text not null default 'Manual' check (char_length(btrim(source)) between 2 and 30),
  status          text not null default 'Confirmed' check (char_length(btrim(status)) between 2 and 30),
  contact_name    text check (contact_name is null or char_length(contact_name) <= 120),
  contact_phone   text check (contact_phone is null or char_length(contact_phone) <= 40),
  contact_email   text check (contact_email is null or char_length(contact_email) <= 160),
  ticket_type     text check (ticket_type is null or char_length(ticket_type) <= 40),
  passenger_count integer not null default 0,
  fare_total      numeric(12, 2) not null default 0 check (fare_total >= 0),
  paid_amount     numeric(12, 2) not null default 0 check (paid_amount >= 0),
  payment_method  text check (payment_method is null or char_length(payment_method) <= 40),
  payment_status  text not null default 'Unpaid' check (char_length(btrim(payment_status)) between 2 and 30),
  refund_amount   numeric(12, 2) check (refund_amount is null or refund_amount >= 0),
  cancel_reason   text check (cancel_reason is null or char_length(cancel_reason) <= 200),
  cancelled_at    timestamptz,
  note            text check (note is null or char_length(note) <= 500),
  api_key_id      uuid,
  meta            jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 16384),
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, number),
  unique (company_id, reference)
);
create index on bookings (trip_id);
create index on bookings (company_id, created_at desc);
alter table bookings enable row level security;
create policy bkg_select on bookings for select to authenticated using (is_company_member(company_id));
-- writes go through create_booking / cancel_booking / update_booking
create trigger bkg_subscription before insert or update or delete on bookings for each row execute function reject_if_subscription_expired();

create table booking_passengers (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  booking_id    uuid not null references bookings(id) on delete cascade,
  trip_id       uuid not null references trips(id) on delete restrict,
  passenger_id  uuid references passengers(id) on delete set null,
  full_name     text not null check (char_length(btrim(full_name)) between 2 and 120),
  category      text check (category is null or char_length(category) <= 40),
  id_number     text check (id_number is null or char_length(id_number) <= 60),
  nationality   text check (nationality is null or char_length(nationality) <= 60),
  phone         text check (phone is null or char_length(phone) <= 40),
  seat_no       text check (seat_no is null or char_length(seat_no) <= 10),
  fare          numeric(12, 2) not null default 0 check (fare >= 0),
  status        text not null default 'Booked' check (char_length(btrim(status)) between 2 and 30),
  checked_in_at timestamptz,
  checked_in_by uuid references auth.users(id) on delete set null,
  boarded_at    timestamptz,
  meta          jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 16384),
  created_at    timestamptz not null default now()
);
create index on booking_passengers (trip_id);
create index on booking_passengers (booking_id);
create index on booking_passengers (passenger_id);
alter table booking_passengers enable row level security;
create policy bkp_select on booking_passengers for select to authenticated using (is_company_member(company_id));
create trigger bkp_subscription before insert or update or delete on booking_passengers for each row execute function reject_if_subscription_expired();

-- A booking / passenger holds a seat unless cancelled.
create function booking_holds_seat(p_booking_status text, p_pax_status text) returns boolean
  language sql immutable as $$ select p_booking_status not in ('Cancelled', 'Refunded') and p_pax_status not in ('Cancelled') $$;

-- Keep trips.seats_booked and bookings.passenger_count in step.
create function trip_recount(p_trip uuid) returns void
  language sql security definer set search_path = public as
$$ update trips set seats_booked = (select count(*) from booking_passengers bp join bookings b on b.id = bp.booking_id
                                     where bp.trip_id = p_trip and booking_holds_seat(b.status, bp.status))
   where id = p_trip $$;

create function booking_passengers_count() returns trigger
  language plpgsql security definer set search_path = public as
$$ declare bid uuid; tid uuid;
begin
  bid := coalesce(new.booking_id, old.booking_id); tid := coalesce(new.trip_id, old.trip_id);
  update bookings set passenger_count = (select count(*) from booking_passengers where booking_id = bid and status <> 'Cancelled'), updated_at = now() where id = bid;
  perform trip_recount(tid);
  if tg_op = 'UPDATE' and old.trip_id <> new.trip_id then perform trip_recount(old.trip_id); end if;
  return null;
end $$;
create trigger bkp_count after insert or update or delete on booking_passengers for each row execute function booking_passengers_count();

create function bookings_count() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  if new.status is distinct from old.status or new.trip_id <> old.trip_id then
    perform trip_recount(new.trip_id);
    if new.trip_id <> old.trip_id then perform trip_recount(old.trip_id); end if;
  end if;
  return null;
end $$;
create trigger bkg_count after update on bookings for each row execute function bookings_count();

-- Seats that may be sold on a trip (Operations Settings → Passenger Capacity Rules: buffer %, seats kept for crew;
-- block = false allows overbooking). Null = no limit.
create function trip_sellable_seats(p_trip uuid) returns integer
  language sql stable security definer set search_path = public as
$$ select case when coalesce((r->>'block')::boolean, true) is false or t.seats_total is null then null
               else greatest(0, floor(t.seats_total * (1 - coalesce(nullif(r->>'buffer', '')::numeric, 0) / 100.0))::int - coalesce(nullif(r->>'crewSeats', '')::int, 0)) end
   from trips t, lateral (select company_setting(t.company_id, '3_passenger_capacity_rules') r) z where t.id = p_trip $$;
revoke execute on function trip_sellable_seats(uuid) from anon, public;

-- Fare for a passenger: route.meta.fares[category] if set (e.g. {"fares": {"Child": 50}}), else route.fare.
create function route_fare(p_route uuid, p_category text) returns numeric
  language sql stable security definer set search_path = public as
$$ select coalesce(nullif(meta->'fares'->>coalesce(p_category, ''), '')::numeric, fare, 0) from routes where id = p_route $$;
revoke execute on function route_fare(uuid, text) from anon, public;

-- 4. Make a booking. Used by staff (create_booking), the customer page and the API (api_*), with p_source telling which.
-- p_booking: {contact_name, contact_phone, contact_email, ticket_type, status, payment_method, paid_amount, note, meta}
-- p_pax: [{passenger_id?, full_name, category, id_number, nationality, phone, email, dob, emergency_contact, seat_no, fare?, meta, save?}]
-- Staff may set fare and status; public sources get route fares and the default status.
create function booking_create_core(p_company uuid, p_trip uuid, p_booking jsonb, p_pax jsonb, p_source text, p_staff boolean, p_key uuid default null) returns jsonb
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
  req := company_setting(p_company, '7_required_passenger_information');
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

-- A booking with its trip and passengers, as the UI and the API return it.
create function booking_json(p_id uuid) returns jsonb
  language sql stable security definer set search_path = public as
$$ select to_jsonb(b) - 'api_key_id' || jsonb_build_object(
     'trip', (select jsonb_build_object('id', t.id, 'code', t.code, 'route', r.name, 'origin', r.origin, 'destination', r.destination,
                'depart_at', t.depart_at, 'arrive_at', t.arrive_at, 'status', t.status, 'vessel', v.name)
              from trips t join routes r on r.id = t.route_id left join vessels v on v.id = t.vessel_id where t.id = b.trip_id),
     'passengers', coalesce((select jsonb_agg(to_jsonb(bp) - 'company_id' order by bp.created_at, bp.full_name) from booking_passengers bp where bp.booking_id = b.id), '[]'::jsonb))
   from bookings b where b.id = p_id $$;
revoke execute on function booking_json(uuid) from anon, public;

-- Staff booking (counter, phone, walk-up). Any member of the company.
create function create_booking(p_company uuid, p_trip uuid, p_booking jsonb, p_passengers jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$ begin
  if not is_company_member(p_company) then raise exception 'Not a member of this company.'; end if;
  return booking_create_core(p_company, p_trip, coalesce(p_booking, '{}'::jsonb), p_passengers,
                             coalesce(nullif(btrim(p_booking->>'source'), ''), 'Manual'), true, null);
end $$;
revoke execute on function create_booking(uuid, uuid, jsonb, jsonb) from anon, public;
grant execute on function create_booking(uuid, uuid, jsonb, jsonb) to authenticated;

-- Edit contact, payment, status, note and meta of a booking (staff). Moving to another trip: p_patch.trip_id.
create function update_booking(p_id uuid, p_patch jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare b bookings; t trips; seats int;
begin
  select * into b from bookings where id = p_id;
  if not found then raise exception 'Booking not found.'; end if;
  if not is_company_member(b.company_id) then raise exception 'Not a member of this company.'; end if;
  if p_patch ? 'trip_id' and nullif(p_patch->>'trip_id', '')::uuid is distinct from b.trip_id then
    select * into t from trips where id = (p_patch->>'trip_id')::uuid and company_id = b.company_id;
    if not found then raise exception 'Trip not found.'; end if;
    if trip_closed(t.status) or t.status in ('Departed', 'In transit') then raise exception 'That trip can no longer be booked.'; end if;
    seats := trip_sellable_seats(t.id);
    if seats is not null and t.seats_booked + b.passenger_count > seats then raise exception 'Only % seat(s) left on that trip.', greatest(0, seats - t.seats_booked); end if;
    update booking_passengers set trip_id = t.id where booking_id = b.id;
    update bookings set trip_id = t.id where id = b.id;
    insert into trip_events (company_id, trip_id, kind, detail, actor) values (b.company_id, t.id, 'booking', b.reference || ' moved here', auth.uid());
  end if;
  update bookings set
    contact_name = case when p_patch ? 'contact_name' then nullif(btrim(p_patch->>'contact_name'), '') else contact_name end,
    contact_phone = case when p_patch ? 'contact_phone' then nullif(btrim(p_patch->>'contact_phone'), '') else contact_phone end,
    contact_email = case when p_patch ? 'contact_email' then nullif(btrim(p_patch->>'contact_email'), '') else contact_email end,
    ticket_type = case when p_patch ? 'ticket_type' then nullif(btrim(p_patch->>'ticket_type'), '') else ticket_type end,
    status = case when p_patch ? 'status' and nullif(btrim(p_patch->>'status'), '') is not null then btrim(p_patch->>'status') else status end,
    payment_method = case when p_patch ? 'payment_method' then nullif(btrim(p_patch->>'payment_method'), '') else payment_method end,
    paid_amount = case when p_patch ? 'paid_amount' then coalesce(nullif(p_patch->>'paid_amount', '')::numeric, 0) else paid_amount end,
    note = case when p_patch ? 'note' then nullif(btrim(p_patch->>'note'), '') else note end,
    meta = case when jsonb_typeof(p_patch->'meta') = 'object' then meta || (p_patch->'meta') else meta end,
    updated_at = now()
    where id = p_id returning * into b;
  update bookings set payment_status = case when payment_status = 'Refunded' then payment_status when paid_amount >= fare_total and fare_total > 0 then 'Paid'
                                            when paid_amount > 0 then 'Partly paid' when fare_total = 0 then 'Paid' else 'Unpaid' end
    where id = p_id;
  return booking_json(p_id);
end $$;
revoke execute on function update_booking(uuid, jsonb) from anon, public;
grant execute on function update_booking(uuid, jsonb) to authenticated;

-- Refund owed when a booking is cancelled now (Passenger Settings → Cancellation & Refund Rules):
-- full refund up to `full` hours before departure (default 24), `partialPct` % up to `partial` hours (default 50% / 6 h),
-- nothing after; a full refund always when the operator cancels (operator = true, default on).
create function booking_refund(p_id uuid, p_operator boolean default false) returns numeric
  language sql stable security definer set search_path = public as
$$ select case
     when p_operator and coalesce((r->>'operator')::boolean, true) then b.paid_amount
     when t.depart_at - now() >= make_interval(hours => coalesce(nullif(r->>'full', '')::int, 24)) then b.paid_amount
     when t.depart_at - now() >= make_interval(hours => coalesce(nullif(r->>'partial', '')::int, 6)) then round(b.paid_amount * coalesce(nullif(r->>'partialPct', '')::numeric, 50) / 100, 2)
     else 0 end
   from bookings b join trips t on t.id = b.trip_id, lateral (select company_setting(b.company_id, '7_cancellation_and_refund_rules') r) z
   where b.id = p_id $$;
revoke execute on function booking_refund(uuid, boolean) from anon, public;

create function booking_cancel_core(p_id uuid, p_reason text, p_refund numeric, p_operator boolean) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare b bookings; rf numeric;
begin
  select * into b from bookings where id = p_id;
  if b.status in ('Cancelled', 'Refunded') then raise exception 'This booking is already %.', lower(b.status); end if;
  rf := coalesce(p_refund, booking_refund(p_id, p_operator));
  update bookings set status = 'Cancelled', cancel_reason = nullif(btrim(p_reason), ''), cancelled_at = now(), refund_amount = rf,
    payment_status = case when rf > 0 then 'Refund due' else payment_status end, updated_at = now()
    where id = p_id;
  insert into trip_events (company_id, trip_id, kind, detail, actor) values (b.company_id, b.trip_id, 'booking', b.reference || ' cancelled' || coalesce(': ' || nullif(btrim(p_reason), ''), ''), auth.uid());
  return booking_json(p_id);
end $$;
revoke execute on function booking_cancel_core(uuid, text, numeric, boolean) from anon, public, authenticated;

create function cancel_booking(p_id uuid, p_reason text default null, p_refund numeric default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare b bookings;
begin
  select * into b from bookings where id = p_id;
  if not found then raise exception 'Booking not found.'; end if;
  if not is_company_member(b.company_id) then raise exception 'Not a member of this company.'; end if;
  return booking_cancel_core(p_id, p_reason, p_refund, false);
end $$;
revoke execute on function cancel_booking(uuid, text, numeric) from anon, public;
grant execute on function cancel_booking(uuid, text, numeric) to authenticated;

-- Mark the refund as paid out.
create function refund_booking(p_id uuid, p_amount numeric default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare b bookings;
begin
  select * into b from bookings where id = p_id;
  if not found then raise exception 'Booking not found.'; end if;
  if not is_company_ops(b.company_id) then raise exception 'Only Operations can record refunds.'; end if;
  update bookings set status = 'Refunded', payment_status = 'Refunded', refund_amount = coalesce(p_amount, refund_amount, paid_amount), updated_at = now() where id = p_id;
  return booking_json(p_id);
end $$;
revoke execute on function refund_booking(uuid, numeric) from anon, public;
grant execute on function refund_booking(uuid, numeric) to authenticated;

-- 5. Passenger status on a trip: check-in (Passenger Settings → Check-in Rules: opens `opens` minutes before departure,
-- default 60), boarding, no-show, cancel one passenger. Any status text is allowed (list in 7_booking_statuses).
create function set_passenger_status(p_id uuid, p_status text) returns booking_passengers
  language plpgsql security definer set search_path = public as
$$ declare bp booking_passengers; t trips; ci jsonb;
begin
  select * into bp from booking_passengers where id = p_id;
  if not found then raise exception 'Passenger not found.'; end if;
  if not is_company_member(bp.company_id) then raise exception 'Not a member of this company.'; end if;
  p_status := btrim(coalesce(p_status, ''));
  if char_length(p_status) < 2 then raise exception 'Choose a status.'; end if;
  select * into t from trips where id = bp.trip_id;
  if p_status = 'Checked in' then
    ci := company_setting(bp.company_id, '7_check_in_rules');
    if t.depart_at > now() + make_interval(mins => coalesce(nullif(ci->>'opens', '')::int, 60)) then
      raise exception 'Check-in opens % minutes before departure.', coalesce(nullif(ci->>'opens', '')::int, 60);
    end if;
  end if;
  update booking_passengers set status = p_status,
    checked_in_at = case when p_status in ('Checked in', 'Boarded') then coalesce(checked_in_at, now()) else checked_in_at end,
    checked_in_by = case when p_status in ('Checked in', 'Boarded') then coalesce(checked_in_by, auth.uid()) else checked_in_by end,
    boarded_at = case when p_status = 'Boarded' then coalesce(boarded_at, now()) else boarded_at end
    where id = p_id returning * into bp;
  return bp;
end $$;
revoke execute on function set_passenger_status(uuid, text) from anon, public;
grant execute on function set_passenger_status(uuid, text) to authenticated;

-- Add or remove passengers on an existing booking (staff). p_add like create_booking passengers; p_remove = booking_passengers ids.
create function update_booking_passengers(p_booking uuid, p_add jsonb default '[]'::jsonb, p_remove uuid[] default '{}') returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare b bookings; t trips; p jsonb; fare numeric; seats int;
begin
  select * into b from bookings where id = p_booking;
  if not found then raise exception 'Booking not found.'; end if;
  if not is_company_member(b.company_id) then raise exception 'Not a member of this company.'; end if;
  select * into t from trips where id = b.trip_id;
  update booking_passengers set status = 'Cancelled' where booking_id = b.id and id = any(coalesce(p_remove, '{}'));
  if jsonb_typeof(p_add) = 'array' and jsonb_array_length(p_add) > 0 then
    select * into t from trips where id = b.trip_id;
    seats := trip_sellable_seats(t.id);
    if seats is not null and t.seats_booked + jsonb_array_length(p_add) > seats then raise exception 'Only % seat(s) left on this trip.', greatest(0, seats - t.seats_booked); end if;
    for p in select * from jsonb_array_elements(p_add) loop
      if coalesce(char_length(btrim(p->>'full_name')), 0) < 2 then raise exception 'Each passenger needs a name.'; end if;
      fare := coalesce(nullif(p->>'fare', '')::numeric, route_fare(t.route_id, nullif(btrim(p->>'category'), '')));
      insert into booking_passengers (company_id, booking_id, trip_id, passenger_id, full_name, category, id_number, nationality, phone, seat_no, fare, meta)
        values (b.company_id, b.id, t.id, nullif(p->>'passenger_id', '')::uuid, btrim(p->>'full_name'), nullif(btrim(p->>'category'), ''), nullif(btrim(p->>'id_number'), ''),
                nullif(btrim(p->>'nationality'), ''), nullif(btrim(p->>'phone'), ''), nullif(btrim(p->>'seat_no'), ''), fare,
                case when jsonb_typeof(p->'meta') = 'object' then p->'meta' else '{}'::jsonb end);
    end loop;
  end if;
  update bookings set fare_total = (select coalesce(sum(fare), 0) from booking_passengers where booking_id = b.id and status <> 'Cancelled') where id = b.id;
  return booking_json(b.id);
end $$;
revoke execute on function update_booking_passengers(uuid, jsonb, uuid[]) from anon, public;
grant execute on function update_booking_passengers(uuid, jsonb, uuid[]) to authenticated;

-- 6. Trip manifest: everyone booked on a trip, with counts. Any member.
create function trip_manifest(p_trip uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare t trips;
begin
  select * into t from trips where id = p_trip;
  if not found then raise exception 'Trip not found.'; end if;
  if not is_company_member(t.company_id) then raise exception 'Not a member of this company.'; end if;
  return jsonb_build_object(
    'trip_id', t.id, 'code', t.code, 'seats_total', t.seats_total, 'seats_booked', t.seats_booked, 'sellable', trip_sellable_seats(t.id),
    'counts', (select jsonb_build_object('booked', count(*) filter (where booking_holds_seat(b.status, bp.status)),
                 'checked_in', count(*) filter (where bp.status = 'Checked in'), 'boarded', count(*) filter (where bp.status = 'Boarded'),
                 'no_show', count(*) filter (where bp.status = 'No-show'), 'cancelled', count(*) filter (where not booking_holds_seat(b.status, bp.status)),
                 'revenue', coalesce(sum(bp.fare) filter (where booking_holds_seat(b.status, bp.status)), 0))
               from booking_passengers bp join bookings b on b.id = bp.booking_id where bp.trip_id = t.id),
    'passengers', coalesce((select jsonb_agg(jsonb_build_object('id', bp.id, 'booking_id', b.id, 'reference', b.reference, 'source', b.source,
                 'booking_status', b.status, 'payment_status', b.payment_status, 'contact_phone', b.contact_phone,
                 'full_name', bp.full_name, 'category', bp.category, 'id_number', bp.id_number, 'nationality', bp.nationality, 'phone', bp.phone,
                 'seat_no', bp.seat_no, 'fare', bp.fare, 'status', bp.status, 'checked_in_at', bp.checked_in_at, 'boarded_at', bp.boarded_at,
                 'passenger_id', bp.passenger_id, 'meta', bp.meta) order by b.number, bp.created_at)
               from booking_passengers bp join bookings b on b.id = bp.booking_id where bp.trip_id = t.id), '[]'::jsonb));
end $$;
revoke execute on function trip_manifest(uuid) from anon, public;
grant execute on function trip_manifest(uuid) to authenticated;

-- 7. When a trip is cancelled, its bookings are cancelled too (operator cancellation → full refund by default).
create function trips_cancel_bookings() returns trigger
  language plpgsql security definer set search_path = public as
$$ declare b record;
begin
  if new.status = 'Cancelled' and old.status is distinct from 'Cancelled' then
    for b in select id from bookings where trip_id = new.id and status not in ('Cancelled', 'Refunded') loop
      perform booking_cancel_core(b.id, 'Trip cancelled' || coalesce(': ' || new.status_reason, ''), null, true);
    end loop;
  end if;
  return null;
end $$;
create trigger trp_cancel_bookings after update on trips for each row execute function trips_cancel_bookings();

-- 8. trips_guard (same as 0037) skips the clash checks when nothing that matters changed — e.g. only seats_booked —
--    so bookings never fail because of an unrelated vessel issue.
create or replace function trips_guard() returns trigger
  language plpgsql security definer set search_path = public as
$$ declare v vessels; r routes; x trips; wo work_orders; e timestamptz;
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and (new.vessel_id is distinct from old.vessel_id or new.captain_id is distinct from old.captain_id or new.depart_at <> old.depart_at) then
    new.cleared_at := null; new.cleared_by := null; new.clearance := '{}'::jsonb;
  end if;
  if tg_op = 'UPDATE' and new.vessel_id is not distinct from old.vessel_id and new.captain_id is not distinct from old.captain_id
     and new.depart_at = old.depart_at and new.arrive_at is not distinct from old.arrive_at and new.route_id = old.route_id
     and new.status = old.status and new.seats_total is not distinct from old.seats_total then
    return new;
  end if;
  select * into r from routes where id = new.route_id;
  if r.company_id is distinct from new.company_id then raise exception 'Choose one of your routes.'; end if;
  if new.arrive_at is null and r.duration_min is not null then new.arrive_at := new.depart_at + make_interval(mins => r.duration_min); end if;
  if new.status = 'Departed' and new.actual_depart is null then new.actual_depart := now(); end if;
  if new.status in ('Arrived', 'Completed') and new.actual_arrive is null then new.actual_arrive := now(); end if;
  if trip_closed(new.status) then return new; end if;
  if tg_op = 'UPDATE' and new.status = old.status and new.status in ('Departed', 'In transit')
     and new.vessel_id is not distinct from old.vessel_id and new.depart_at = old.depart_at then return new; end if;
  e := trip_end(new);
  if new.vessel_id is not null then
    select * into v from vessels where id = new.vessel_id;
    if v.company_id is distinct from new.company_id then raise exception 'Choose one of your vessels.'; end if;
    if v.status = 'Out of service' and new.depart_at < now() + interval '24 hours' and new.status not in ('Delayed') then
      raise exception '% is out of service%. Choose another vessel or return it to service first.', v.name, coalesce(' (' || v.status_reason || ')', '');
    end if;
    select * into wo from work_orders w where w.vessel_id = new.vessel_id and w.takes_out_of_service and w.status not in ('Completed', 'Closed')
      and w.planned_start < e and coalesce(w.planned_end, w.planned_start) > new.depart_at limit 1;
    if wo.id is not null then
      raise exception '% is booked for maintenance then (% %, % to %).', v.name, wo.code, wo.title, local_time(new.company_id, wo.planned_start), local_time(new.company_id, wo.planned_end);
    end if;
    select * into x from trips t where t.vessel_id = new.vessel_id and t.id <> new.id and not trip_closed(t.status)
      and t.depart_at < e and trip_end(t) > new.depart_at order by t.depart_at limit 1;
    if x.id is not null then
      raise exception '% already has a trip at % (%).', v.name, local_time(new.company_id, x.depart_at), (select name from routes where id = x.route_id);
    end if;
    if new.seats_total is null and v.passenger_capacity is not null then new.seats_total := v.passenger_capacity; end if;
    if v.passenger_capacity is not null and new.seats_total > v.passenger_capacity then
      raise exception '% carries up to % passengers.', v.name, v.passenger_capacity;
    end if;
  end if;
  if new.captain_id is not null then
    if not exists (select 1 from company_members where company_id = new.company_id and user_id = new.captain_id and active and employment_status = 'Active') then
      raise exception 'The captain must be an active member of staff.';
    end if;
    select * into x from trips t where t.id <> new.id and not trip_closed(t.status) and t.depart_at < e and trip_end(t) > new.depart_at
      and (t.captain_id = new.captain_id or exists (select 1 from trip_crew c where c.trip_id = t.id and c.user_id = new.captain_id)) limit 1;
    if x.id is not null then raise exception 'The captain is already on another trip at %.', local_time(new.company_id, x.depart_at); end if;
    if exists (select 1 from leave_requests l where l.company_id = new.company_id and l.user_id = new.captain_id and l.status = 'Approved'
               and l.start_date <= e::date and l.end_date >= new.depart_at::date) then
      raise exception 'The captain is on approved leave then.';
    end if;
  end if;
  return new;
end $$;
