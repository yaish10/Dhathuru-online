-- Trip seats follow the assigned vessel (22 Oct 2026).
--  * Assigning or changing a trip's vessel sets trips.seats_total to that vessel's passenger_capacity.
--    Moving a trip onto a vessel with fewer seats than are already booked is refused with a clear message.
--    Taking the vessel off a trip keeps the last seat count (bookings stay protected).
--  * Changing a vessel's passenger_capacity updates the seats on its open trips that have not left yet.
--    Trips with more bookings than the new capacity keep their old seat count, and the change is logged on the trip.
--  * A trip can keep its own seat count with trips.meta.seats_override = true (then nothing above changes it).
--  * One-off: open future trips with a vessel are brought in line with their vessel now.
-- Trigger order matters: trp_capacity runs before trp_guard (alphabetical), so the guard sees the new seat count.

create or replace function trips_capacity() returns trigger
  language plpgsql security definer set search_path = public as
$$ declare cap int; vname text;
begin
  if coalesce((new.meta->>'seats_override')::boolean, false) then return new; end if;
  if new.vessel_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.vessel_id is not distinct from old.vessel_id then return new; end if;
  select passenger_capacity, coalesce(code, name) into cap, vname from vessels where id = new.vessel_id;
  if cap is null then return new; end if;
  if coalesce(new.seats_booked, 0) > cap then
    raise exception '% has % passenger seats, but % passengers are already booked on this trip. Choose a bigger vessel or move some bookings first.',
      vname, cap, new.seats_booked;
  end if;
  new.seats_total := cap;
  return new;
end $$;
create trigger trp_capacity before insert or update on trips for each row execute function trips_capacity();

create or replace function vessels_capacity_to_trips() returns trigger
  language plpgsql security definer set search_path = public as
$$ declare t record;
begin
  if new.passenger_capacity is not distinct from old.passenger_capacity or new.passenger_capacity is null then return new; end if;
  for t in select id, company_id, seats_booked, seats_total from trips
            where vessel_id = new.id and not trip_closed(status) and status in ('Scheduled', 'Boarding', 'Delayed')
              and depart_at > now() and not coalesce((meta->>'seats_override')::boolean, false)
              and seats_total is distinct from new.passenger_capacity loop
    if coalesce(t.seats_booked, 0) > new.passenger_capacity then
      insert into trip_events (company_id, trip_id, kind, detail)
      values (t.company_id, t.id, 'auto', coalesce(new.code, new.name) || ' now has ' || new.passenger_capacity || ' seats but ' || t.seats_booked
              || ' are booked; seats kept at ' || coalesce(t.seats_total::text, 'none') || '. Move some passengers or change the vessel.');
    else
      begin
        update trips set seats_total = new.passenger_capacity where id = t.id;
      exception when others then null;
      end;
    end if;
  end loop;
  return new;
end $$;
create trigger ves_capacity_to_trips after update of passenger_capacity on vessels for each row execute function vessels_capacity_to_trips();

-- One-off sync.
do $$ declare t record; begin
  perform set_config('veyora.subscription_write', 'on', true);
  for t in select tr.id, v.passenger_capacity cap from trips tr join vessels v on v.id = tr.vessel_id
            where v.passenger_capacity is not null and not trip_closed(tr.status) and tr.status in ('Scheduled', 'Boarding', 'Delayed')
              and tr.depart_at > now() and not coalesce((tr.meta->>'seats_override')::boolean, false)
              and tr.seats_total is distinct from v.passenger_capacity and coalesce(tr.seats_booked, 0) <= v.passenger_capacity loop
    begin
      update trips set seats_total = t.cap where id = t.id;
    exception when others then null;
    end;
  end loop;
end $$;
