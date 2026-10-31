-- Who hears about bookings, chosen by designation. Company setting 3_booking_notice_recipients (Operations Settings → Notification
-- Recipients), one block per notice: new_booking, passenger_added, booking_cancelled:
--   { designations: ['Cashier', ...],  job titles whose holders receive it
--     rosteredOnly: true,              only those on the duty roster that day (shift not OFF / L) on the trip's departure day
--     tripStaff:    true,              also the trip's captain and assigned crew (trip_crew)
--     operations:   false }            also everyone in Operations
-- A person with an assigned vessel (HR record) counts only for trips of that vessel; with none, for every vessel. If nobody
-- qualifies, Operations is told so the notice is not lost. With no setting saved the notice goes to the trip's captain and crew
-- (the 0076 behaviour). The person who made the change is never told.

create function trip_notice_audience(p_company uuid, p_trip uuid, p_kind text) returns uuid[]
  language plpgsql stable security definer set search_path = public as
$$ declare
  cfg jsonb := company_setting(p_company, '3_booking_notice_recipients') -> p_kind;
  t trips; v vessels; tz text; trip_day date; titles text[]; rostered boolean; out uuid[] := '{}';
begin
  select * into t from trips where id = p_trip;
  if not found then return coalesce(ops_user_ids(p_company), '{}'); end if;
  select * into v from vessels where id = t.vessel_id;
  select coalesce(timezone, 'Indian/Maldives') into tz from companies where id = p_company;
  trip_day := (t.depart_at at time zone coalesce(tz, 'Indian/Maldives'))::date;
  rostered := coalesce((cfg->>'rosteredOnly')::boolean, true);
  titles := array(select lower(btrim(x)) from jsonb_array_elements_text(coalesce(cfg->'designations', '[]'::jsonb)) x);

  if coalesce((cfg->>'tripStaff')::boolean, true) then out := out || trip_staff_ids(p_trip); end if;
  if coalesce((cfg->>'operations')::boolean, false) then out := out || coalesce(ops_user_ids(p_company), '{}'); end if;
  if coalesce(array_length(titles, 1), 0) > 0 then
    out := out || array(
      select m.user_id from company_members m join job_titles jt on jt.id = m.job_title_id
      where m.company_id = p_company and m.active and lower(btrim(jt.title)) = any(titles)
        and (not rostered or exists (select 1 from roster_entries r where r.company_id = m.company_id and r.user_id = m.user_id
                                      and r.day = trip_day and r.shift not in ('OFF', 'L')))
        and (coalesce(btrim(m.assigned_vessel), '') = ''
             or lower(btrim(m.assigned_vessel)) in (lower(btrim(coalesce(v.name, ''))), lower(btrim(coalesce(v.code, ''))))));
  end if;
  out := array(select distinct u from unnest(out) u where u is not null);
  if coalesce(array_length(out, 1), 0) = 0 then return coalesce(ops_user_ids(p_company), '{}'); end if;
  return out;
end $$;
revoke execute on function trip_notice_audience(uuid, uuid, text) from anon, public, authenticated;

create or replace function booking_notify() returns trigger
  language plpgsql security definer set search_path = public as
$$ declare b bookings; who uuid[];
begin
  select * into b from bookings where id = new.id;
  if not found or b.status = 'Cancelled' then return null; end if;
  who := array(select u from unnest(trip_notice_audience(b.company_id, b.trip_id, 'new_booking')) u where u is distinct from b.created_by);
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
  who := array(select u from unnest(trip_notice_audience(new.company_id, new.trip_id, 'passenger_added')) u where u is distinct from auth.uid());
  perform notify_many(new.company_id, who, 'passenger_added', '', 'passenger', new.id::text, 'Passenger added to ' || b.reference,
    new.full_name || ' · ' || coalesce(trip_notice_label(new.trip_id), ''));
  return null;
end $$;

create or replace function booking_cancel_notify() returns trigger
  language plpgsql security definer set search_path = public as
$$ declare who uuid[];
begin
  if new.status = 'Cancelled' and old.status is distinct from 'Cancelled' then
    who := array(select u from unnest(trip_notice_audience(new.company_id, new.trip_id, 'booking_cancelled')) u where u is distinct from auth.uid());
    perform notify_many(new.company_id, who, 'booking_cancelled', '', 'booking', new.id::text, 'Booking cancelled ' || new.reference,
      coalesce(nullif(btrim(new.contact_name), '') || ' · ', '') || coalesce(trip_notice_label(new.trip_id), '') || coalesce(' · ' || nullif(btrim(new.cancel_reason), ''), ''));
  end if;
  return null;
end $$;

drop function trip_notice_audience(uuid, uuid);   -- the 0076 two-argument version, replaced above
