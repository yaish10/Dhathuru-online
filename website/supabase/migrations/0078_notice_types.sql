-- One settings section per notification type. Company setting 11_notice_types, one block per notice kind:
--   { <kind>: { enabled:      true,          false = this notice is never sent
--               keepDefault:  true,          false = the people the system would normally tell are NOT told (only those added below)
--               teams:        ['operations','hr','it','maintenance'],   also tell these teams
--               designations: ['Cashier', ...],                         also tell everyone holding these job titles
--               rosteredOnly: true } }       designations: only people on the duty roster that day (shift not OFF / L); when the notice
--                                            belongs to a trip, the trip's departure day and, for a person with an assigned vessel,
--                                            only that vessel's trips
-- Every notice already goes through notify_user / notify_many (0019), so the rule lives there and no call site changes.
-- The booking notices' own setting (3_booking_notice_recipients, 0077) is converted into this one.

create function notice_cfg(p_company uuid, p_kind text) returns jsonb
  language sql stable security definer set search_path = public as
$$ select company_setting(p_company, '11_notice_types') -> p_kind $$;
revoke execute on function notice_cfg(uuid, text) from anon, public, authenticated;

-- The trip a notice is about, when it is about one.
create function notice_trip_of(p_subject_type text, p_subject_id text) returns uuid
  language plpgsql stable security definer set search_path = public as
$$ declare r uuid;
begin
  if p_subject_type = 'trip' then return p_subject_id::uuid;
  elsif p_subject_type = 'booking' then select trip_id into r from bookings where id = p_subject_id::uuid;
  elsif p_subject_type = 'passenger' then select trip_id into r from booking_passengers where id = p_subject_id::uuid;
  end if;
  return r;
exception when others then return null;
end $$;
revoke execute on function notice_trip_of(text, text) from anon, public, authenticated;

-- Insert one notification (checks only that in-app notices are on and the person is an active member).
create function notice_insert(p_company uuid, p_user uuid, p_kind text, p_stage text, p_subject_type text, p_subject_id text, p_title text, p_body text) returns boolean
  language plpgsql security definer set search_path = public as
$$ begin
  if p_user is null then return false; end if;
  if not in_app_notifications_on(p_company) then return false; end if;
  if not exists (select 1 from company_members where company_id = p_company and user_id = p_user and active) then return false; end if;
  insert into notifications (company_id, user_id, kind, stage, subject_type, subject_id, title, body)
    values (p_company, p_user, p_kind, coalesce(p_stage, ''), p_subject_type, p_subject_id, left(p_title, 120), nullif(left(p_body, 400), ''))
    on conflict (company_id, user_id, kind, stage, subject_id) do nothing;
  return found;
end $$;
revoke execute on function notice_insert(uuid, uuid, text, text, text, text, text, text) from anon, public, authenticated;

-- The people a notice's settings add: teams and designations. Never the person who caused it.
create function notice_extras(p_company uuid, p_kind text, p_subject_type text, p_subject_id text, p_title text, p_body text, p_stage text, p_cfg jsonb) returns integer
  language plpgsql security definer set search_path = public as
$$ declare
  trip uuid; t trips; v vessels; tz text; d date; titles text[]; teams text[]; rostered boolean; who uuid[] := '{}'; u uuid; n integer := 0;
begin
  if p_cfg is null then return 0; end if;
  select coalesce(timezone, 'Indian/Maldives') into tz from companies where id = p_company;
  trip := notice_trip_of(p_subject_type, p_subject_id);
  if trip is not null then
    select * into t from trips where id = trip;
    select * into v from vessels where id = t.vessel_id;
    d := (t.depart_at at time zone coalesce(tz, 'Indian/Maldives'))::date;
  else d := (now() at time zone coalesce(tz, 'Indian/Maldives'))::date; end if;
  teams := array(select jsonb_array_elements_text(coalesce(p_cfg->'teams', '[]'::jsonb)));
  if 'operations'  = any(teams) then who := who || coalesce(ops_user_ids(p_company), '{}'); end if;
  if 'hr'          = any(teams) then who := who || coalesce(hr_user_ids(p_company), '{}'); end if;
  if 'it'          = any(teams) then who := who || coalesce(it_user_ids(p_company), '{}'); end if;
  if 'maintenance' = any(teams) then who := who || coalesce(maint_user_ids(p_company), '{}'); end if;
  titles := array(select lower(btrim(x)) from jsonb_array_elements_text(coalesce(p_cfg->'designations', '[]'::jsonb)) x);
  rostered := coalesce((p_cfg->>'rosteredOnly')::boolean, true);
  if coalesce(array_length(titles, 1), 0) > 0 then
    who := who || array(
      select m.user_id from company_members m join job_titles jt on jt.id = m.job_title_id
      where m.company_id = p_company and m.active and lower(btrim(jt.title)) = any(titles)
        and (not rostered or exists (select 1 from roster_entries r where r.company_id = m.company_id and r.user_id = m.user_id
                                      and r.day = d and r.shift not in ('OFF', 'L')))
        and (trip is null or coalesce(btrim(m.assigned_vessel), '') = ''
             or lower(btrim(m.assigned_vessel)) in (lower(btrim(coalesce(v.name, ''))), lower(btrim(coalesce(v.code, ''))))));
  end if;
  for u in select distinct x from unnest(who) x where x is not null and x is distinct from auth.uid() loop
    if notice_insert(p_company, u, p_kind, p_stage, p_subject_type, p_subject_id, p_title, p_body) then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke execute on function notice_extras(uuid, text, text, text, text, text, text, jsonb) from anon, public, authenticated;

create or replace function notify_user(
  p_company uuid, p_user uuid, p_kind text, p_stage text,
  p_subject_type text, p_subject_id text, p_title text, p_body text
) returns boolean
  language plpgsql security definer set search_path = public as
$$ declare cfg jsonb := notice_cfg(p_company, p_kind); ok boolean := false;
begin
  if cfg is not null and cfg->>'enabled' = 'false' then return false; end if;
  if p_user is not null and coalesce(cfg->>'keepDefault', 'true') <> 'false' then
    ok := notice_insert(p_company, p_user, p_kind, p_stage, p_subject_type, p_subject_id, p_title, p_body);
  end if;
  -- A single call adds the extra people itself; inside notify_many they are added once for the whole list.
  if cfg is not null and current_setting('veyora.notice_busy', true) is distinct from '1' then
    perform notice_extras(p_company, p_kind, p_subject_type, p_subject_id, p_title, p_body, p_stage, cfg);
  end if;
  return ok;
end $$;

create or replace function notify_many(
  p_company uuid, p_users uuid[], p_kind text, p_stage text,
  p_subject_type text, p_subject_id text, p_title text, p_body text
) returns integer
  language plpgsql security definer set search_path = public as
$$ declare u uuid; n integer := 0; cfg jsonb := notice_cfg(p_company, p_kind);
begin
  if cfg is not null and cfg->>'enabled' = 'false' then return 0; end if;
  perform set_config('veyora.notice_busy', '1', true);
  if p_users is not null then
    foreach u in array p_users loop
      if notify_user(p_company, u, p_kind, p_stage, p_subject_type, p_subject_id, p_title, p_body) then n := n + 1; end if;
    end loop;
  end if;
  perform set_config('veyora.notice_busy', '0', true);
  if cfg is not null then n := n + notice_extras(p_company, p_kind, p_subject_type, p_subject_id, p_title, p_body, p_stage, cfg); end if;
  return n;
end $$;

-- Booking notices: the default people are the trip's captain and crew, or Operations when nobody is assigned (0076).
-- Designations, teams and the on/off switch now come from 11_notice_types like every other notice.
create or replace function trip_notice_audience(p_company uuid, p_trip uuid, p_kind text) returns uuid[]
  language plpgsql stable security definer set search_path = public as
$$ declare staff uuid[] := trip_staff_ids(p_trip);
begin
  if coalesce(array_length(staff, 1), 0) > 0 then return staff; end if;
  return coalesce(ops_user_ids(p_company), '{}');
end $$;

-- Convert the 0077 booking setting. tripStaff = false becomes keepDefault = false; operations = true becomes the Operations team.
do $$ declare c record; k text; old jsonb; blk jsonb; res jsonb;
begin
  for c in select id, settings from companies where settings ? '3_booking_notice_recipients' loop
    old := c.settings->'3_booking_notice_recipients'; res := coalesce(c.settings->'11_notice_types', '{}'::jsonb);
    foreach k in array array['new_booking', 'passenger_added', 'booking_cancelled'] loop
      if old ? k then
        blk := jsonb_build_object('enabled', true, 'keepDefault', coalesce((old->k->>'tripStaff')::boolean, true),
          'teams', case when coalesce((old->k->>'operations')::boolean, false) then jsonb_build_array('operations') else '[]'::jsonb end,
          'designations', coalesce(old->k->'designations', '[]'::jsonb), 'rosteredOnly', coalesce((old->k->>'rosteredOnly')::boolean, true));
        res := jsonb_set(res, array[k], blk, true);
      end if;
    end loop;
    update companies set settings = jsonb_set(settings - '3_booking_notice_recipients', '{11_notice_types}', res, true) where id = c.id;
  end loop;
end $$;
