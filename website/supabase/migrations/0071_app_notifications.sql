-- Notifications for the apps: a feed for the bell, new events (bookings, passengers, cancellations, attendance corrections),
-- and the groundwork for push (device registry and a send queue). The notifications table and the leave, swap, trip, maintenance
-- and IT notices already exist (0019 and later); this adds what was missing and a clean way for a phone to read them.

-- 1. The bell: the signed-in person's own notifications, newest first, with the unread count.
create function my_notifications(p_company uuid, p_limit integer default 60) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare items jsonb; unread integer;
begin
  if not is_company_member(p_company) then raise exception 'Not a member of this company.'; end if;
  select count(*) into unread from notifications where company_id = p_company and user_id = auth.uid() and read_at is null;
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'stage', n.stage, 'title', n.title, 'body', n.body,
           'subject_type', n.subject_type, 'subject_id', n.subject_id, 'read', n.read_at is not null, 'created_at', n.created_at) order by n.created_at desc), '[]'::jsonb)
    into items from (select * from notifications where company_id = p_company and user_id = auth.uid()
                     order by created_at desc limit greatest(least(coalesce(p_limit, 60), 200), 1)) n;
  return jsonb_build_object('unread', unread, 'items', items);
end $$;
revoke execute on function my_notifications(uuid, integer) from anon, public;
grant execute on function my_notifications(uuid, integer) to authenticated;

create function mark_all_notifications_read(p_company uuid) returns integer
  language plpgsql security definer set search_path = public as
$$ declare n integer;
begin
  update notifications set read_at = now() where company_id = p_company and user_id = auth.uid() and read_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function mark_all_notifications_read(uuid) from anon, public;
grant execute on function mark_all_notifications_read(uuid) to authenticated;

-- 2. New events.
-- Where a trip is going and when, in the company's own time, for the notice text.
create function trip_notice_label(p_trip uuid) returns text
  language sql stable security definer set search_path = public as
$$ select coalesce(r.name, 'Trip') || ' · ' || to_char(t.depart_at at time zone coalesce(c.timezone, 'Indian/Maldives'), 'DD Mon HH24:MI')
   from trips t join companies c on c.id = t.company_id left join routes r on r.id = t.route_id where t.id = p_trip $$;
revoke execute on function trip_notice_label(uuid) from anon, public, authenticated;

-- A new booking: Operations and the trip's captain hear about it, except the person who made it. Runs at commit, so the
-- passengers are already counted.
create function booking_notify() returns trigger
  language plpgsql security definer set search_path = public as
$$ declare b bookings; t trips; who uuid[];
begin
  select * into b from bookings where id = new.id;
  if not found or b.status = 'Cancelled' then return null; end if;
  select * into t from trips where id = b.trip_id;
  who := array(select distinct u from unnest(ops_user_ids(b.company_id) || array[t.captain_id]) u where u is not null and u is distinct from b.created_by);
  perform notify_many(b.company_id, who, 'new_booking', '', 'booking', b.id::text, 'New booking ' || b.reference,
    b.passenger_count || ' passenger' || case when b.passenger_count = 1 then '' else 's' end || coalesce(' · ' || nullif(btrim(b.contact_name), ''), '') || ' · ' || coalesce(trip_notice_label(b.trip_id), ''));
  return null;
end $$;
revoke execute on function booking_notify() from anon, public, authenticated;
create constraint trigger bk_notify after insert on bookings deferrable initially deferred for each row execute function booking_notify();

-- A passenger added to a booking some time after it was made.
create function booking_pax_notify() returns trigger
  language plpgsql security definer set search_path = public as
$$ declare b bookings; t trips; who uuid[];
begin
  select * into b from bookings where id = new.booking_id;
  if not found or b.created_at > now() - interval '2 minutes' then return null; end if;
  select * into t from trips where id = new.trip_id;
  who := array(select distinct u from unnest(ops_user_ids(new.company_id) || array[t.captain_id]) u where u is not null and u is distinct from auth.uid());
  perform notify_many(new.company_id, who, 'passenger_added', '', 'passenger', new.id::text, 'Passenger added to ' || b.reference,
    new.full_name || ' · ' || coalesce(trip_notice_label(new.trip_id), ''));
  return null;
end $$;
revoke execute on function booking_pax_notify() from anon, public, authenticated;
create constraint trigger bkp_notify after insert on booking_passengers deferrable initially deferred for each row execute function booking_pax_notify();

create function booking_cancel_notify() returns trigger
  language plpgsql security definer set search_path = public as
$$ declare t trips; who uuid[];
begin
  if new.status = 'Cancelled' and old.status is distinct from 'Cancelled' then
    select * into t from trips where id = new.trip_id;
    who := array(select distinct u from unnest(ops_user_ids(new.company_id) || array[t.captain_id]) u where u is not null and u is distinct from auth.uid());
    perform notify_many(new.company_id, who, 'booking_cancelled', '', 'booking', new.id::text, 'Booking cancelled ' || new.reference,
      coalesce(nullif(btrim(new.contact_name), '') || ' · ', '') || coalesce(trip_notice_label(new.trip_id), '') || coalesce(' · ' || nullif(btrim(new.cancel_reason), ''), ''));
  end if;
  return null;
end $$;
revoke execute on function booking_cancel_notify() from anon, public, authenticated;
create trigger bk_cancel_notify after update of status on bookings for each row execute function booking_cancel_notify();

-- Attendance corrections: HR hears about a request; the person hears the decision.
create function attendance_correction_notify() returns trigger
  language plpgsql security definer set search_path = public as
$$ declare nm text;
begin
  nm := swap_name(new.user_id);
  if tg_op = 'INSERT' and new.status_now = 'Pending' then
    perform notify_many(new.company_id, array(select u from unnest(hr_user_ids(new.company_id)) u where u is distinct from new.created_by), 'attendance_correction', 'submitted',
      'attendance_correction', new.id::text, 'Attendance correction from ' || nm, nm || ' · ' || to_char(new.day, 'DD Mon') || ' · ' || new.reason);
  elsif tg_op = 'UPDATE' and old.status_now = 'Pending' and new.status_now in ('Approved', 'Rejected') then
    perform notify_user(new.company_id, new.user_id, 'attendance_decision', lower(new.status_now), 'attendance_correction', new.id::text,
      'Attendance correction ' || lower(new.status_now), 'Your correction for ' || to_char(new.day, 'DD Mon') || ' was ' || lower(new.status_now) || '.');
  end if;
  return null;
end $$;
revoke execute on function attendance_correction_notify() from anon, public, authenticated;
create trigger att_corr_notify after insert or update of status_now on attendance_corrections for each row execute function attendance_correction_notify();

-- 3. Push groundwork. A phone registers its token; every new notification for a person with a device is queued in push_outbox.
-- The queue is emptied by the edge function `send-push` (supabase/functions/send-push), which needs your Apple and Firebase keys.
create table push_devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  platform     text not null check (platform in ('ios', 'android')),
  token        text not null check (char_length(token) between 20 and 4096),
  environment  text not null default 'production' check (environment in ('production', 'sandbox')),
  device_key   text check (device_key is null or char_length(device_key) <= 64),
  app_version  text check (app_version is null or char_length(app_version) <= 40),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (platform, token)
);
create index on push_devices (user_id);
alter table push_devices enable row level security;
create policy push_dev_select on push_devices for select to authenticated using (user_id = auth.uid());
-- Writes go through the two functions below.

create function register_push_device(p_platform text, p_token text, p_environment text default 'production', p_device text default null, p_version text default null) returns void
  language plpgsql security definer set search_path = public as
$$ begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  insert into push_devices (user_id, platform, token, environment, device_key, app_version)
    values (auth.uid(), p_platform, p_token, coalesce(p_environment, 'production'), left(p_device, 64), left(p_version, 40))
    on conflict (platform, token) do update set user_id = auth.uid(), environment = excluded.environment, device_key = excluded.device_key,
      app_version = excluded.app_version, last_seen_at = now();
end $$;
revoke execute on function register_push_device(text, text, text, text, text) from anon, public;
grant execute on function register_push_device(text, text, text, text, text) to authenticated;

create function unregister_push_device(p_token text) returns void
  language sql security definer set search_path = public as
$$ delete from push_devices where user_id = auth.uid() and token = p_token $$;
revoke execute on function unregister_push_device(text) from anon, public;
grant execute on function unregister_push_device(text) to authenticated;

create table push_outbox (
  id              bigint generated always as identity primary key,
  notification_id uuid not null references notifications(id) on delete cascade,
  user_id         uuid not null,
  company_id      uuid not null,
  title           text not null,
  body            text,
  kind            text not null,
  subject_type    text,
  subject_id      text,
  attempts        integer not null default 0,
  sent_at         timestamptz,
  error           text,
  created_at      timestamptz not null default now()
);
create index on push_outbox (created_at) where sent_at is null;
alter table push_outbox enable row level security;   -- no policies: only the service role (the send-push function) reads it
revoke all on push_outbox from anon, authenticated, public;

create function push_enqueue() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  if exists (select 1 from push_devices where user_id = new.user_id) then
    insert into push_outbox (notification_id, user_id, company_id, title, body, kind, subject_type, subject_id)
      values (new.id, new.user_id, new.company_id, new.title, new.body, new.kind, new.subject_type, new.subject_id);
  end if;
  return null;
end $$;
revoke execute on function push_enqueue() from anon, public, authenticated;
create trigger notif_push_enqueue after insert on notifications for each row execute function push_enqueue();

-- 0. Fix: update_booking_passengers (0038, again in 0064) failed on every call with "column reference fare is ambiguous" because the
-- function has a variable called fare and its last statement summed the column fare. The column is now qualified; nothing else changes.
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
  update bookings set fare_total = (select coalesce(sum(bp.fare), 0) from booking_passengers bp where bp.booking_id = b.id and bp.status <> 'Cancelled') where id = b.id;
  return booking_json(b.id);
end $$;
revoke execute on function update_booking_passengers(uuid, jsonb, uuid[]) from anon, public;
grant execute on function update_booking_passengers(uuid, jsonb, uuid[]) to authenticated;

-- 4. Realtime: the apps listen for new notifications over Supabase Realtime (a live connection) so an alert shows the moment
-- it is written. Row security still applies: a listener only receives rows its own select policy allows, and the apps ask for
-- their own user's rows only.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table notifications;
  end if;
end $$;
