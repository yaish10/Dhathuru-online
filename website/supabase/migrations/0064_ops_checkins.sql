-- 0064: Operations check-in (staff activity) + look-up mode.
-- A staff member has two check-ins: the shift check-in (attendance, clock_punch) and the Operations check-in (this file).
-- Operations check-in records WHO worked Operations, on WHICH vessel, WHEN and from where. Without it the app is in
-- look-up mode (read only). Checking in unlocks Mark paid, Board, Check in passenger, No-show and Cancel.
-- Rule (Settings -> Operations Settings -> Operations Check-in, key 3_operations_check_in):
--   enabled  (default true)  the apps use the check-in / look-up split
--   enforce  (default false) the database itself refuses the five actions above without an open check-in
--                            (off by default so the website, which has no check-in button yet, keeps working)
--   hours    (default 16)    a check-in that was never closed stops counting after this many hours
-- The "Recent check-ins" list is for the website Operations page only (ops_checkins_recent); the apps do not show it.

create table ops_checkins (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies(id) on delete cascade,
  user_id        uuid not null,
  vessel_id      uuid references vessels(id) on delete set null,
  trip_id        uuid references trips(id) on delete set null,
  checked_in_at  timestamptz not null default now(),
  checked_out_at timestamptz,
  lat            numeric,
  lng            numeric,
  device         text check (device is null or char_length(device) <= 80),
  source         text not null default 'app' check (char_length(source) between 2 and 20),
  meta           jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 8192),
  foreign key (company_id, user_id) references company_members (company_id, user_id) on delete cascade,
  check (checked_out_at is null or checked_out_at >= checked_in_at)
);
create index on ops_checkins (company_id, checked_in_at desc);
create index on ops_checkins (company_id, user_id) where checked_out_at is null;
alter table ops_checkins enable row level security;
-- Everyone sees their own; Operations and HR see the company's (the website list). Writes go through the functions below.
create policy opsci_select on ops_checkins for select to authenticated
  using (user_id = auth.uid() or is_company_ops(company_id) or is_company_hr(company_id));
create trigger opsci_subscription before insert or update or delete on ops_checkins
  for each row execute function reject_if_subscription_expired();

create function ops_checkin_rules(p_company uuid) returns jsonb
  language sql stable security definer set search_path = public as
$$ select jsonb_build_object(
     'enabled', coalesce((settings->'3_operations_check_in'->>'enabled')::boolean, true),
     'enforce', coalesce((settings->'3_operations_check_in'->>'enforce')::boolean, false),
     'hours', coalesce(nullif(settings->'3_operations_check_in'->>'hours', '')::int, 16))
   from companies where id = p_company $$;
revoke execute on function ops_checkin_rules(uuid) from anon, public;
grant execute on function ops_checkin_rules(uuid) to authenticated;

-- The caller's open Operations check-in, if it is still inside the rule's hours.
create function ops_open_checkin(p_company uuid, p_user uuid) returns ops_checkins
  language sql stable security definer set search_path = public as
$$ select c.* from ops_checkins c
   where c.company_id = p_company and c.user_id = p_user and c.checked_out_at is null
     and c.checked_in_at > now() - make_interval(hours => (ops_checkin_rules(p_company)->>'hours')::int)
   order by c.checked_in_at desc limit 1 $$;
revoke execute on function ops_open_checkin(uuid, uuid) from anon, public, authenticated;

-- Used by the booking and passenger functions below. System calls (no signed-in user) and the platform owner pass.
create function ops_require_checkin(p_company uuid) returns void
  language plpgsql stable security definer set search_path = public as
$$ declare r jsonb := ops_checkin_rules(p_company);
begin
  if not (r->>'enabled')::boolean or not (r->>'enforce')::boolean then return; end if;
  if auth.uid() is null or is_platform_admin() then return; end if;
  if (ops_open_checkin(p_company, auth.uid())).id is not null then return; end if;
  raise exception 'Check in to Operations first. Without it you are in look-up mode and can only view.';
end $$;
revoke execute on function ops_require_checkin(uuid) from anon, public, authenticated;

-- What the app needs on the Operations page: am I checked in, and what can I check in to.
create function my_ops_checkin(p_company uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare c ops_checkins; r jsonb; sug uuid; tz text;
begin
  if not is_company_member(p_company) then raise exception 'Not a member of this company.'; end if;
  r := ops_checkin_rules(p_company);
  c := ops_open_checkin(p_company, auth.uid());
  tz := company_tz(p_company);
  -- the vessel of the next trip that has not left yet is the likely one
  select t.vessel_id into sug from trips t
    where t.company_id = p_company and t.vessel_id is not null and not trip_closed(t.status) and t.status not in ('Departed', 'In transit')
      and t.depart_at between now() - interval '2 hours' and now() + interval '1 day'
    order by t.depart_at limit 1;
  return jsonb_build_object(
    'rules', r,
    'checked_in', c.id is not null,
    'current', case when c.id is null then null else jsonb_build_object('id', c.id, 'checked_in_at', c.checked_in_at, 'vessel_id', c.vessel_id,
        'vessel', (select v.name from vessels v where v.id = c.vessel_id), 'trip_id', c.trip_id) end,
    'suggested_vessel', sug,
    'vessels', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'code', v.code, 'name', v.name, 'status', v.status) order by v.name)
                         from vessels v where v.company_id = p_company), '[]'::jsonb));
end $$;
revoke execute on function my_ops_checkin(uuid) from anon, public;
grant execute on function my_ops_checkin(uuid) to authenticated;

create function ops_checkin(p_company uuid, p_vessel uuid default null, p_trip uuid default null,
                            p_lat numeric default null, p_lng numeric default null, p_device text default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare r jsonb; c ops_checkins; tz text; vname text;
begin
  if not exists (select 1 from company_members where company_id = p_company and user_id = auth.uid() and active) then
    raise exception 'Only active staff can check in to Operations.'; end if;
  r := ops_checkin_rules(p_company);
  if not (r->>'enabled')::boolean then raise exception 'Operations check-in is switched off (see Operations Check-in settings).'; end if;
  if p_vessel is not null and not exists (select 1 from vessels where id = p_vessel and company_id = p_company) then raise exception 'Choose one of your vessels.'; end if;
  if p_trip is not null and not exists (select 1 from trips where id = p_trip and company_id = p_company) then raise exception 'Trip not found.'; end if;
  c := ops_open_checkin(p_company, auth.uid());
  if c.id is not null then
    tz := company_tz(p_company);
    select name into vname from vessels where id = c.vessel_id;
    raise exception 'You are already checked in to Operations% since %. Check out first.', coalesce(' (' || vname || ')', ''), to_char(c.checked_in_at at time zone tz, 'HH24:MI');
  end if;
  -- close any stale open rows so there is one open check-in per person
  update ops_checkins set checked_out_at = checked_in_at + interval '0 seconds', meta = meta || '{"auto_closed": true}'
    where company_id = p_company and user_id = auth.uid() and checked_out_at is null;
  insert into ops_checkins (company_id, user_id, vessel_id, trip_id, lat, lng, device)
    values (p_company, auth.uid(), p_vessel, p_trip, p_lat, p_lng, left(p_device, 80)) returning * into c;
  insert into company_audit (company_id, actor, action, detail) values (p_company, auth.uid(), 'ops_checkin', c.id::text);
  return my_ops_checkin(p_company);
end $$;
revoke execute on function ops_checkin(uuid, uuid, uuid, numeric, numeric, text) from anon, public;
grant execute on function ops_checkin(uuid, uuid, uuid, numeric, numeric, text) to authenticated;

create function ops_checkout(p_company uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare c ops_checkins;
begin
  if not is_company_member(p_company) then raise exception 'Not a member of this company.'; end if;
  c := ops_open_checkin(p_company, auth.uid());
  if c.id is null then raise exception 'You are not checked in to Operations.'; end if;
  update ops_checkins set checked_out_at = now() where id = c.id;
  insert into company_audit (company_id, actor, action, detail) values (p_company, auth.uid(), 'ops_checkout', c.id::text);
  return my_ops_checkin(p_company);
end $$;
revoke execute on function ops_checkout(uuid) from anon, public;
grant execute on function ops_checkout(uuid) to authenticated;

-- The website's "Recent check-ins" list (Operations and HR only). Newest first.
create function ops_checkins_recent(p_company uuid, p_limit integer default 50) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare hrs int;
begin
  if not (is_company_ops(p_company) or is_company_hr(p_company)) then raise exception 'Only Operations and HR can see check-ins.'; end if;
  hrs := (ops_checkin_rules(p_company)->>'hours')::int;
  return coalesce((select jsonb_agg(x order by x->>'checked_in_at' desc) from (
    select jsonb_build_object('id', c.id, 'user_id', c.user_id, 'name', swap_name(c.user_id), 'designation', swap_title(c.company_id, c.user_id),
        'vessel', v.name, 'vessel_code', v.code, 'trip', t.code, 'checked_in_at', c.checked_in_at, 'checked_out_at', c.checked_out_at,
        'open', c.checked_out_at is null and c.checked_in_at > now() - make_interval(hours => hrs),
        'minutes', round(extract(epoch from (coalesce(c.checked_out_at, least(now(), c.checked_in_at + make_interval(hours => hrs))) - c.checked_in_at)) / 60),
        'lat', c.lat, 'lng', c.lng, 'source', c.source) as x
      from ops_checkins c left join vessels v on v.id = c.vessel_id left join trips t on t.id = c.trip_id
      where c.company_id = p_company order by c.checked_in_at desc limit greatest(1, least(coalesce(p_limit, 50), 200))) q), '[]'::jsonb);
end $$;
revoke execute on function ops_checkins_recent(uuid, integer) from anon, public;
grant execute on function ops_checkins_recent(uuid, integer) to authenticated;

-- The five actions Operations check-in unlocks: same bodies as 0038 plus ops_require_checkin (a no-op unless `enforce` is on).
create or replace function update_booking(p_id uuid, p_patch jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare b bookings; t trips; seats int;
begin
  select * into b from bookings where id = p_id;
  if not found then raise exception 'Booking not found.'; end if;
  if not is_company_member(b.company_id) then raise exception 'Not a member of this company.'; end if;
  perform ops_require_checkin(b.company_id);
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

create or replace function cancel_booking(p_id uuid, p_reason text default null, p_refund numeric default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare b bookings;
begin
  select * into b from bookings where id = p_id;
  if not found then raise exception 'Booking not found.'; end if;
  if not is_company_member(b.company_id) then raise exception 'Not a member of this company.'; end if;
  perform ops_require_checkin(b.company_id);
  return booking_cancel_core(p_id, p_reason, p_refund, false);
end $$;

create or replace function refund_booking(p_id uuid, p_amount numeric default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare b bookings;
begin
  select * into b from bookings where id = p_id;
  if not found then raise exception 'Booking not found.'; end if;
  if not is_company_ops(b.company_id) then raise exception 'Only Operations can record refunds.'; end if;
  perform ops_require_checkin(b.company_id);
  update bookings set status = 'Refunded', payment_status = 'Refunded', refund_amount = coalesce(p_amount, refund_amount, paid_amount), updated_at = now() where id = p_id;
  return booking_json(p_id);
end $$;

create or replace function set_passenger_status(p_id uuid, p_status text) returns booking_passengers
  language plpgsql security definer set search_path = public as
$$ declare bp booking_passengers; t trips; ci jsonb;
begin
  select * into bp from booking_passengers where id = p_id;
  if not found then raise exception 'Passenger not found.'; end if;
  if not is_company_member(bp.company_id) then raise exception 'Not a member of this company.'; end if;
  perform ops_require_checkin(bp.company_id);
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

create or replace function update_booking_passengers(p_booking uuid, p_add jsonb default '[]'::jsonb, p_remove uuid[] default '{}') returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare b bookings; t trips; p jsonb; fare numeric; seats int;
begin
  select * into b from bookings where id = p_booking;
  if not found then raise exception 'Booking not found.'; end if;
  if not is_company_member(b.company_id) then raise exception 'Not a member of this company.'; end if;
  perform ops_require_checkin(b.company_id);
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
