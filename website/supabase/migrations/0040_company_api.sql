-- Company API: each company makes its own API keys and connects its website, booking page, agents or other systems.
-- Calls go to the normal Supabase REST endpoint with the project's publishable key, plus the company's own API key:
--   POST {SUPABASE_URL}/rest/v1/rpc/api_trips   headers: apikey: <publishable key>, Content-Type: application/json
--   body: {"p_key": "vk_pub_…", "p_from": "2026-10-22", "p_to": "2026-10-29"}
-- The API key decides the company; nothing else in the request can reach another company's data.
-- Key kinds:
--   public (vk_pub_…) — safe in a website: routes, timetable, availability, make a booking, look up / cancel a booking
--                       with its reference and the contact phone or email. Optional allowed website origins.
--   secret (vk_sec_…) — server to server only: everything above plus booking lists and trip manifests.
-- Keys are stored hashed (shown once when created), can be revoked, are rate limited per minute, and record last use.

create table company_api_keys (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  name            text not null check (char_length(btrim(name)) between 2 and 80),
  kind            text not null default 'public' check (kind in ('public', 'secret')),
  prefix          text not null,
  key_hash        text not null unique,
  allowed_origins text[] not null default '{}',
  rate_per_min    integer not null default 120 check (rate_per_min between 1 and 10000),
  active          boolean not null default true,
  last_used_at    timestamptz,
  use_count       bigint not null default 0,
  meta            jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 16384),
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz
);
alter table company_api_keys enable row level security;
create policy cak_select on company_api_keys for select to authenticated using (is_company_admin(company_id));
-- writes only through create_api_key / update_api_key / revoke_api_key

create table api_usage (
  key_id uuid not null references company_api_keys(id) on delete cascade,
  minute timestamptz not null,
  calls  integer not null default 0,
  primary key (key_id, minute)
);
alter table api_usage enable row level security;   -- no policies: internal only

create function api_hash(p_key text) returns text
  language sql immutable as $$ select encode(extensions.digest(p_key, 'sha256'), 'hex') $$;

-- Owners/admins create a key. The full key is returned once — store it; only the prefix is kept to recognise it.
create function create_api_key(p_company uuid, p_name text, p_kind text default 'public', p_origins text[] default '{}', p_rate integer default 120) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare k text; row_k company_api_keys;
begin
  if not is_company_admin(p_company) then raise exception 'Only owners and admins can create API keys.'; end if;
  if p_kind not in ('public', 'secret') then raise exception 'Key kind is public or secret.'; end if;
  k := 'vk_' || case when p_kind = 'public' then 'pub' else 'sec' end || '_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into company_api_keys (company_id, name, kind, prefix, key_hash, allowed_origins, rate_per_min, created_by)
    values (p_company, btrim(p_name), p_kind, left(k, 14), api_hash(k), coalesce(p_origins, '{}'), coalesce(p_rate, 120), auth.uid())
    returning * into row_k;
  insert into company_audit (company_id, actor, action, detail) values (p_company, auth.uid(), 'api_key_created', row_k.name || ' (' || row_k.kind || ', ' || row_k.prefix || '…)');
  return jsonb_build_object('id', row_k.id, 'name', row_k.name, 'kind', row_k.kind, 'prefix', row_k.prefix, 'key', k,
                            'note', 'Copy this key now. It will not be shown again.');
end $$;
revoke execute on function create_api_key(uuid, text, text, text[], integer) from anon, public;
grant execute on function create_api_key(uuid, text, text, text[], integer) to authenticated;

create function update_api_key(p_id uuid, p_patch jsonb) returns company_api_keys
  language plpgsql security definer set search_path = public as
$$ declare row_k company_api_keys;
begin
  select * into row_k from company_api_keys where id = p_id;
  if not found or not is_company_admin(row_k.company_id) then raise exception 'API key not found.'; end if;
  update company_api_keys set
    name = coalesce(nullif(btrim(p_patch->>'name'), ''), name),
    allowed_origins = case when jsonb_typeof(p_patch->'allowed_origins') = 'array' then array(select jsonb_array_elements_text(p_patch->'allowed_origins')) else allowed_origins end,
    rate_per_min = coalesce(nullif(p_patch->>'rate_per_min', '')::int, rate_per_min),
    meta = case when jsonb_typeof(p_patch->'meta') = 'object' then meta || (p_patch->'meta') else meta end
    where id = p_id returning * into row_k;
  return row_k;
end $$;
revoke execute on function update_api_key(uuid, jsonb) from anon, public;
grant execute on function update_api_key(uuid, jsonb) to authenticated;

create function revoke_api_key(p_id uuid) returns void
  language plpgsql security definer set search_path = public as
$$ declare row_k company_api_keys;
begin
  select * into row_k from company_api_keys where id = p_id;
  if not found or not is_company_admin(row_k.company_id) then raise exception 'API key not found.'; end if;
  update company_api_keys set active = false, revoked_at = now() where id = p_id;
  insert into company_audit (company_id, actor, action, detail) values (row_k.company_id, auth.uid(), 'api_key_revoked', row_k.name || ' (' || row_k.prefix || '…)');
end $$;
revoke execute on function revoke_api_key(uuid) from anon, public;
grant execute on function revoke_api_key(uuid) to authenticated;

-- Check a key: active, company active with an open subscription, origin allowed (public keys), within the rate limit.
create function api_auth(p_key text, p_secret boolean default false) returns company_api_keys
  language plpgsql security definer set search_path = public as
$$ declare row_k company_api_keys; origin text; calls int;
begin
  select * into row_k from company_api_keys where key_hash = api_hash(coalesce(p_key, ''));
  if not found or not row_k.active then raise exception 'Invalid API key.' using errcode = '28000'; end if;
  if p_secret and row_k.kind <> 'secret' then raise exception 'This needs a secret API key.' using errcode = '42501'; end if;
  if not exists (select 1 from companies c where c.id = row_k.company_id and c.status = 'Active') or not subscription_open(row_k.company_id) then
    raise exception 'This company is not accepting requests right now.' using errcode = '42501';
  end if;
  if row_k.kind = 'public' and cardinality(row_k.allowed_origins) > 0 then
    origin := coalesce(nullif(current_setting('request.headers', true), '')::json->>'origin', '');
    if not (origin = any(row_k.allowed_origins)) then raise exception 'This website is not allowed to use this key.' using errcode = '42501'; end if;
  end if;
  insert into api_usage (key_id, minute, calls) values (row_k.id, date_trunc('minute', now()), 1)
    on conflict (key_id, minute) do update set calls = api_usage.calls + 1 returning api_usage.calls into calls;
  if calls > row_k.rate_per_min then raise exception 'Too many requests. Try again in a minute.' using errcode = '53400'; end if;
  update company_api_keys set last_used_at = now(), use_count = use_count + 1 where id = row_k.id;
  delete from api_usage where key_id = row_k.id and minute < now() - interval '1 day';
  return row_k;
end $$;
revoke execute on function api_auth(text, boolean) from anon, public, authenticated;

-- Public view of a trip (no staff names).
create function api_trip_json(p_trip uuid) returns jsonb
  language sql stable security definer set search_path = public as
$$ select jsonb_build_object('id', t.id, 'code', t.code, 'route_id', t.route_id, 'route', r.name, 'origin', r.origin, 'destination', r.destination,
     'stops', to_jsonb(r.stops), 'kind', t.kind, 'status', t.status, 'depart_at', t.depart_at, 'arrive_at', t.arrive_at,
     'vessel', v.name, 'fare', r.fare, 'fares', coalesce(r.meta->'fares', '{}'::jsonb),
     'seats_left', case when trip_sellable_seats(t.id) is null then null else greatest(0, trip_sellable_seats(t.id) - t.seats_booked) end,
     'bookable', not trip_closed(t.status) and t.status not in ('Departed', 'In transit')
                 and t.depart_at >= now() + make_interval(mins => coalesce(nullif(cut->>'close', '')::int, 30))
                 and t.depart_at <= now() + make_interval(days => coalesce(nullif(cut->>'advance', '')::int, 30))
                 and (trip_sellable_seats(t.id) is null or trip_sellable_seats(t.id) > t.seats_booked))
   from trips t join routes r on r.id = t.route_id left join vessels v on v.id = t.vessel_id,
        lateral (select company_setting(t.company_id, '7_booking_cut_off_times') cut) z
   where t.id = p_trip $$;
revoke execute on function api_trip_json(uuid) from anon, public;

-- Booking as the API returns it (passengers without registry links).
create function api_booking_json(p_id uuid) returns jsonb
  language sql stable security definer set search_path = public as
$$ select jsonb_build_object('reference', b.reference, 'status', b.status, 'source', b.source, 'created_at', b.created_at,
     'contact_name', b.contact_name, 'contact_phone', b.contact_phone, 'contact_email', b.contact_email, 'ticket_type', b.ticket_type,
     'passenger_count', b.passenger_count, 'fare_total', b.fare_total, 'paid_amount', b.paid_amount, 'payment_status', b.payment_status,
     'refund_amount', b.refund_amount, 'cancel_reason', b.cancel_reason,
     'currency', coalesce(nullif(company_setting(b.company_id, '9_base_currency')->>'base', ''), 'MVR'),
     'meta', b.meta, 'trip', api_trip_json(b.trip_id),
     'passengers', coalesce((select jsonb_agg(jsonb_build_object('full_name', bp.full_name, 'category', bp.category, 'seat_no', bp.seat_no,
                     'fare', bp.fare, 'status', bp.status) order by bp.created_at) from booking_passengers bp where bp.booking_id = b.id), '[]'::jsonb))
   from bookings b where b.id = p_id $$;
revoke execute on function api_booking_json(uuid) from anon, public;

-- Find a booking by reference; public keys must also give the contact phone or email used when booking.
create function api_find_booking(row_k company_api_keys, p_reference text, p_contact text) returns bookings
  language plpgsql stable security definer set search_path = public as
$$ declare b bookings;
begin
  select * into b from bookings where company_id = row_k.company_id and upper(reference) = upper(btrim(coalesce(p_reference, '')));
  if not found then raise exception 'Booking not found.'; end if;
  if row_k.kind = 'public' and not (
       coalesce(btrim(p_contact), '') <> '' and (
         regexp_replace(coalesce(b.contact_phone, ''), '\D', '', 'g') = regexp_replace(p_contact, '\D', '', 'g') and regexp_replace(p_contact, '\D', '', 'g') <> ''
         or lower(coalesce(b.contact_email, '')) = lower(btrim(p_contact)))) then
    raise exception 'Booking not found.';
  end if;
  return b;
end $$;
revoke execute on function api_find_booking(company_api_keys, text, text) from anon, public;

-- ── Endpoints (anon + authenticated may call; the key does the rest) ──────────────────────────────

-- Company details and the booking rules a booking page needs.
create function api_info(p_key text) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare k company_api_keys;
begin
  k := api_auth(p_key);
  return (select jsonb_build_object('company', c.name, 'code', c.code, 'timezone', company_tz(c.id),
            'currency', coalesce(nullif(company_setting(c.id, '9_base_currency')->>'base', ''), 'MVR'),
            'key', jsonb_build_object('name', k.name, 'kind', k.kind),
            'booking_rules', jsonb_build_object('cut_off', company_setting(c.id, '7_booking_cut_off_times'),
                              'required_passenger_information', company_setting(c.id, '7_required_passenger_information'),
                              'cancellation', company_setting(c.id, '7_cancellation_and_refund_rules'),
                              'passenger_categories', company_setting(c.id, '7_passenger_categories'),
                              'ticket_types', company_setting(c.id, '7_ticket_types')))
          from companies c where c.id = k.company_id);
end $$;

create function api_routes(p_key text) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare k company_api_keys;
begin
  k := api_auth(p_key);
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'name', r.name, 'origin', r.origin, 'destination', r.destination,
            'stops', to_jsonb(r.stops), 'duration_min', r.duration_min, 'distance_nm', r.distance_nm, 'fare', r.fare,
            'fares', coalesce(r.meta->'fares', '{}'::jsonb)) order by r.name)
          from routes r where r.company_id = k.company_id and r.active), '[]'::jsonb);
end $$;

-- Timetable and seats. Filter by route id, or by origin / destination text. Up to 31 days per call.
create function api_trips(p_key text, p_from date, p_to date default null, p_route uuid default null, p_origin text default null, p_destination text default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare k company_api_keys; tz text; f timestamptz; t timestamptz;
begin
  k := api_auth(p_key);
  tz := company_tz(k.company_id);
  if p_from is null then raise exception 'Give p_from (YYYY-MM-DD).'; end if;
  if coalesce(p_to, p_from) < p_from or coalesce(p_to, p_from) - p_from > 31 then raise exception 'Choose up to 31 days.'; end if;
  f := p_from::timestamp at time zone tz; t := (coalesce(p_to, p_from) + 1)::timestamp at time zone tz;
  return coalesce((select jsonb_agg(api_trip_json(tr.id) order by tr.depart_at)
          from trips tr join routes r on r.id = tr.route_id
          where tr.company_id = k.company_id and tr.depart_at >= f and tr.depart_at < t
            and (p_route is null or tr.route_id = p_route)
            and (p_origin is null or lower(r.origin) = lower(btrim(p_origin)))
            and (p_destination is null or lower(r.destination) = lower(btrim(p_destination)))), '[]'::jsonb);
end $$;

create function api_trip(p_key text, p_trip uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare k company_api_keys;
begin
  k := api_auth(p_key);
  if not exists (select 1 from trips where id = p_trip and company_id = k.company_id) then raise exception 'Trip not found.'; end if;
  return api_trip_json(p_trip);
end $$;

-- Make a booking. p_contact: {name, phone, email}; p_passengers: [{full_name, category, id_number, nationality, phone,
-- email, dob, emergency_contact, seat_no, meta}]; p_options: {ticket_type, note, meta}. Fares come from the route.
-- Source is "Customer" for public keys and "API" for secret keys (or p_options.source with a secret key).
create function api_book(p_key text, p_trip uuid, p_contact jsonb, p_passengers jsonb, p_options jsonb default '{}'::jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare k company_api_keys; res jsonb;
begin
  k := api_auth(p_key);
  if not exists (select 1 from trips where id = p_trip and company_id = k.company_id) then raise exception 'Trip not found.'; end if;
  if coalesce(btrim(p_contact->>'phone'), '') = '' and coalesce(btrim(p_contact->>'email'), '') = '' then
    raise exception 'Give a contact phone or email.';
  end if;
  res := booking_create_core(k.company_id, p_trip,
           jsonb_build_object('contact_name', p_contact->>'name', 'contact_phone', p_contact->>'phone', 'contact_email', p_contact->>'email',
                              'ticket_type', p_options->>'ticket_type', 'note', p_options->>'note',
                              'meta', coalesce(case when jsonb_typeof(p_options->'meta') = 'object' then p_options->'meta' end, '{}'::jsonb) || jsonb_build_object('api_key', k.prefix)),
           (select coalesce(jsonb_agg(x - 'fare' - 'passenger_id' - 'save' || '{"save": true}'::jsonb), '[]'::jsonb) from jsonb_array_elements(coalesce(p_passengers, '[]'::jsonb)) x),
           case when k.kind = 'secret' then coalesce(nullif(btrim(p_options->>'source'), ''), 'API') else 'Customer' end,
           false, k.id);
  return api_booking_json((res->>'id')::uuid);
end $$;

create function api_booking(p_key text, p_reference text, p_contact text default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare k company_api_keys; b bookings;
begin
  k := api_auth(p_key);
  b := api_find_booking(k, p_reference, p_contact);
  return api_booking_json(b.id);
end $$;

-- Cancel a booking (refund worked out from Cancellation & Refund Rules).
create function api_cancel(p_key text, p_reference text, p_contact text default null, p_reason text default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare k company_api_keys; b bookings;
begin
  k := api_auth(p_key);
  b := api_find_booking(k, p_reference, p_contact);
  perform booking_cancel_core(b.id, coalesce(nullif(btrim(p_reason), ''), 'Cancelled by customer'), null, false);
  return api_booking_json(b.id);
end $$;

-- Secret keys: bookings made in a period (by departure date), and a trip's passenger list.
create function api_bookings(p_key text, p_from date, p_to date default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare k company_api_keys; tz text;
begin
  k := api_auth(p_key, true);
  if p_from is null or coalesce(p_to, p_from) - p_from > 31 then raise exception 'Choose up to 31 days.'; end if;
  tz := company_tz(k.company_id);
  return coalesce((select jsonb_agg(api_booking_json(b.id) order by t.depart_at, b.number)
          from bookings b join trips t on t.id = b.trip_id
          where b.company_id = k.company_id and t.depart_at >= p_from::timestamp at time zone tz and t.depart_at < (coalesce(p_to, p_from) + 1)::timestamp at time zone tz), '[]'::jsonb);
end $$;

create function api_manifest(p_key text, p_trip uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare k company_api_keys;
begin
  k := api_auth(p_key, true);
  if not exists (select 1 from trips where id = p_trip and company_id = k.company_id) then raise exception 'Trip not found.'; end if;
  return api_trip_json(p_trip) || jsonb_build_object('passengers', coalesce((select jsonb_agg(jsonb_build_object(
            'reference', b.reference, 'full_name', bp.full_name, 'category', bp.category, 'id_number', bp.id_number, 'nationality', bp.nationality,
            'phone', bp.phone, 'seat_no', bp.seat_no, 'status', bp.status, 'booking_status', b.status) order by b.number, bp.created_at)
          from booking_passengers bp join bookings b on b.id = bp.booking_id where bp.trip_id = p_trip and booking_holds_seat(b.status, bp.status)), '[]'::jsonb));
end $$;

-- Only the endpoints are callable from outside.
do $g$ declare f text; begin
  foreach f in array array['api_info(text)', 'api_routes(text)', 'api_trips(text, date, date, uuid, text, text)', 'api_trip(text, uuid)',
                           'api_book(text, uuid, jsonb, jsonb, jsonb)', 'api_booking(text, text, text)', 'api_cancel(text, text, text, text)',
                           'api_bookings(text, date, date)', 'api_manifest(text, uuid)'] loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $g$;

-- Internal helpers from 0038 that should not be callable from outside.
revoke execute on function trip_recount(uuid) from anon, public, authenticated;
