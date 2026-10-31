-- Minimal stand-ins for the Supabase / earlier-migration objects that 0058 uses, so the migration can be tested on a
-- plain local Postgres. Shapes follow 0001–0054; only the columns and functions 0058 touches are included.
-- Test-only: never apply this to the veyora project.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end $$;

create schema if not exists auth;
create table auth.users (id uuid primary key, email text);
-- auth.uid() reads the session setting test.uid (set per test).
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('test.uid', true), '')::uuid $$;

create table companies (
  id uuid primary key default gen_random_uuid(), name text, status text not null default 'Active',
  timezone text, settings jsonb not null default '{}'::jsonb);
create table company_members (
  company_id uuid references companies(id), user_id uuid, role text, active boolean default true,
  employment_status text default 'Active', duty_status text);
create table profiles (id uuid primary key, full_name text, email text);

-- Platform owner when the session setting test.platform = 'on' (Arrival Lab tests).
create function is_platform_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.platform', true), '') = 'on' $$;
create function is_company_member(cid uuid) returns boolean language sql stable as
$$ select exists (select 1 from company_members where company_id = cid and user_id = auth.uid() and active) $$;
create function is_company_admin(cid uuid) returns boolean language sql stable as
$$ select exists (select 1 from company_members where company_id = cid and user_id = auth.uid() and active and role in ('owner', 'admin')) $$;
create function is_company_ops(cid uuid) returns boolean language sql stable as
$$ select is_company_admin(cid) or exists (select 1 from company_members where company_id = cid and user_id = auth.uid() and active and role = 'operations') $$;
create function company_setting(p_company uuid, p_key text) returns jsonb language sql stable as
$$ select coalesce((select settings->p_key from companies where id = p_company), '{}'::jsonb) $$;
create function ops_setting(p_company uuid, p_key text) returns jsonb language sql stable as
$$ select coalesce((select settings->p_key from companies where id = p_company), '{}'::jsonb) $$;
create function company_tz(p_company uuid) returns text language sql stable as
$$ select coalesce((select nullif(timezone, '') from companies where id = p_company), 'Indian/Maldives') $$;
create function local_time(p_company uuid, p_at timestamptz) returns text language sql stable as
$$ select to_char(p_at at time zone company_tz(p_company), 'DD Mon HH24:MI') $$;
create function ops_user_ids(p_company uuid) returns uuid[] language sql stable as
$$ select coalesce(array_agg(user_id), '{}') from company_members where company_id = p_company and active and role in ('owner', 'admin', 'operations') $$;
create function trip_closed(p_status text) returns boolean language sql immutable as $$ select p_status in ('Cancelled', 'Arrived', 'Completed') $$;

create table notifications_sent (company_id uuid, users uuid[], kind text, stage text, subject_id text, title text, body text, at timestamptz default now());
create function notify_many(p_company uuid, p_users uuid[], p_kind text, p_stage text, p_subject_type text, p_subject_id text,
                            p_title text, p_body text) returns integer language sql as
$$ insert into notifications_sent (company_id, users, kind, stage, subject_id, title, body) values (p_company, p_users, p_kind, p_stage, p_subject_id, p_title, p_body); select 1 $$;

create table vessels (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id), name text not null,
  status text not null default 'Operational', passenger_capacity integer, meta jsonb not null default '{}'::jsonb);
create table routes (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id), code text, name text not null,
  origin text not null, destination text not null, duration_min integer, active boolean not null default true,
  meta jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
create table trips (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id), route_id uuid not null references routes(id),
  vessel_id uuid references vessels(id), captain_id uuid, kind text not null default 'Scheduled', status text not null default 'Scheduled',
  depart_at timestamptz not null, arrive_at timestamptz, seats_total integer, seats_booked integer not null default 0, status_reason text,
  note text, actual_depart timestamptz, actual_arrive timestamptz, meta jsonb not null default '{}'::jsonb,
  number integer, code text, cleared_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table trip_crew (trip_id uuid references trips(id) on delete cascade, company_id uuid, user_id uuid, role text default 'Crew', meta jsonb default '{}'::jsonb);
create table trip_events (
  id bigint generated always as identity primary key, company_id uuid, trip_id uuid references trips(id) on delete cascade, kind text,
  detail text, actor uuid, meta jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
create table dispatch_tasks (
  id uuid primary key default gen_random_uuid(), company_id uuid, trip_id uuid references trips(id) on delete cascade, title text, detail text,
  priority text default 'Review', blocks_dispatch boolean default false, status text default 'Open', due_at timestamptz,
  meta jsonb not null default '{}'::jsonb, created_by uuid, created_at timestamptz default now());
create table bookings (id uuid primary key default gen_random_uuid(), trip_id uuid references trips(id), status text, updated_at timestamptz);
create table booking_passengers (id uuid primary key default gen_random_uuid(), trip_id uuid references trips(id), status text, boarded_at timestamptz);
create table defects (id uuid primary key default gen_random_uuid(), vessel_id uuid, stops_operation boolean, status text);

create function trip_end(t trips) returns timestamptz language sql stable as
$$ select coalesce(t.arrive_at, t.depart_at + make_interval(mins => coalesce((select r.duration_min from routes r where r.id = t.route_id), 60))) $$;
create function trips_ahead(p_company uuid) returns integer language sql as $$ select 0 $$;
create function auto_assign_crew(p_company uuid) returns integer language sql as $$ select 0 $$;

-- The two lines of trips_guard (0038) that matter here: actual times are filled when a status is set without one.
create function trips_guard() returns trigger language plpgsql as
$$ begin
  new.updated_at := now();
  if new.status = 'Departed' and new.actual_depart is null then new.actual_depart := now(); end if;
  if new.status in ('Arrived', 'Completed') and new.actual_arrive is null then new.actual_arrive := now(); end if;
  return new;
end $$;
create trigger trp_guard before insert or update on trips for each row execute function trips_guard();

-- FollowMe objects from 0049 (no http extension here; the poll path is not exercised by the tests).
create table followme_links (vessel_id uuid primary key references vessels(id) on delete cascade, company_id uuid, url text not null, updated_at timestamptz default now());
create table followme_cache (company_id uuid, url text, status integer, body text, fetched_at timestamptz, tried_at timestamptz, last_error text, primary key (company_id, url));
create table followme_calls (company_id uuid primary key, last_call_at timestamptz not null);
create function followme_hint(p_url text) returns text language sql immutable as
$$ select regexp_replace(p_url, '^https?://([^/]+).*$', '\1') || ' · ••••' || right(regexp_replace(p_url, '/+$', ''), 4) $$;
