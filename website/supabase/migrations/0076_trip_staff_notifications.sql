-- Booking notices go to the staff assigned to that trip. Until now a new booking, an added passenger or a cancellation was
-- sent to Operations and the trip's captain only, so crew members rostered on the trip (trip_crew) never heard about them.
-- Now the recipients are the trip's captain and everyone in trip_crew (active members of the company), except the person who made
-- the change. If nobody is assigned to the trip yet, Operations is told instead so the notice is not lost.

create function trip_staff_ids(p_trip uuid) returns uuid[]
  language sql stable security definer set search_path = public as
$$ select coalesce(array_agg(distinct u), '{}')
   from (select t.captain_id as u, t.company_id as cid from trips t where t.id = p_trip
         union select c.user_id, c.company_id from trip_crew c where c.trip_id = p_trip) s
   where u is not null and exists (select 1 from company_members m where m.company_id = s.cid and m.user_id = s.u and m.active) $$;
revoke execute on function trip_staff_ids(uuid) from anon, public, authenticated;

-- Staff assigned to the trip, or Operations when none is.
create function trip_notice_audience(p_company uuid, p_trip uuid) returns uuid[]
  language plpgsql stable security definer set search_path = public as
$$ declare staff uuid[];
begin
  staff := trip_staff_ids(p_trip);
  if coalesce(array_length(staff, 1), 0) > 0 then return staff; end if;
  return coalesce(ops_user_ids(p_company), '{}');
end $$;
revoke execute on function trip_notice_audience(uuid, uuid) from anon, public, authenticated;

create or replace function booking_notify() returns trigger
  language plpgsql security definer set search_path = public as
$$ declare b bookings; who uuid[];
begin
  select * into b from bookings where id = new.id;
  if not found or b.status = 'Cancelled' then return null; end if;
  who := array(select u from unnest(trip_notice_audience(b.company_id, b.trip_id)) u where u is distinct from b.created_by);
  perform notify_many(b.company_id, who, 'new_booking', '', 'booking', b.id::text, 'New booking ' || b.reference,
    b.passenger_count || ' passenger' || case when b.passenger_count = 1 then '' else 's' end || coalesce(' · ' || nullif(btrim(b.contact_name), ''), '') || ' · ' || coalesce(trip_notice_label(b.trip_id), ''));
  return null;
end $$;

create or replace function booking_pax_notify() returns trigger
  language plpgsql security definer set search_path = public as
$$ declare b bookings; who uuid[];
begin
  select * into b from bookings where id = new.booking_id;
  if not found or b.created_at > now() - interval '2 minutes' then return null; end if;
  who := array(select u from unnest(trip_notice_audience(new.company_id, new.trip_id)) u where u is distinct from auth.uid());
  perform notify_many(new.company_id, who, 'passenger_added', '', 'passenger', new.id::text, 'Passenger added to ' || b.reference,
    new.full_name || ' · ' || coalesce(trip_notice_label(new.trip_id), ''));
  return null;
end $$;

create or replace function booking_cancel_notify() returns trigger
  language plpgsql security definer set search_path = public as
$$ declare who uuid[];
begin
  if new.status = 'Cancelled' and old.status is distinct from 'Cancelled' then
    who := array(select u from unnest(trip_notice_audience(new.company_id, new.trip_id)) u where u is distinct from auth.uid());
    perform notify_many(new.company_id, who, 'booking_cancelled', '', 'booking', new.id::text, 'Booking cancelled ' || new.reference,
      coalesce(nullif(btrim(new.contact_name), '') || ' · ', '') || coalesce(trip_notice_label(new.trip_id), '') || coalesce(' · ' || nullif(btrim(new.cancel_reason), ''), ''));
  end if;
  return null;
end $$;
