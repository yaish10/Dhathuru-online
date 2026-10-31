-- Attendance: one record per person per day, clock-in/out, corrections, CSV import.

create table attendance_records (
  company_id       uuid not null,
  user_id          uuid not null,
  day              date not null,
  status           text not null check (status in ('Present', 'Late', 'Absent', 'On leave', 'Rest day', 'Missed punch')),
  clock_in         timestamptz,
  clock_out        timestamptz,
  scheduled_shift  text check (scheduled_shift is null or char_length(scheduled_shift) between 1 and 6),
  source           text not null default 'auto' check (source in ('self', 'hr', 'auto', 'csv')),
  lat              numeric,
  lng              numeric,
  note             text check (note is null or char_length(note) <= 200),
  updated_by       uuid references auth.users(id) on delete set null,
  updated_at       timestamptz not null default now(),
  primary key (company_id, user_id, day),
  foreign key (company_id, user_id) references company_members (company_id, user_id) on delete cascade,
  check (clock_out is null or clock_in is null or clock_out >= clock_in)
);
create index on attendance_records (company_id, day);
alter table attendance_records enable row level security;
create policy att_select on attendance_records for select to authenticated
  using (is_company_hr(company_id) or user_id = auth.uid());
create trigger att_subscription before insert or update or delete on attendance_records
  for each row execute function reject_if_subscription_expired();

create table attendance_corrections (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null,
  user_id      uuid not null,
  day          date not null,
  clock_in     timestamptz,
  clock_out    timestamptz,
  status       text check (status is null or status in ('Present', 'Late', 'Absent', 'On leave', 'Rest day', 'Missed punch')),
  reason       text not null check (char_length(btrim(reason)) between 2 and 200),
  status_now   text not null default 'Pending' check (status_now in ('Pending', 'Approved', 'Rejected')),
  decided_by   uuid references auth.users(id) on delete set null,
  decided_at   timestamptz,
  created_by   uuid not null references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  foreign key (company_id, user_id) references company_members (company_id, user_id) on delete cascade
);
create index on attendance_corrections (company_id, status_now);
alter table attendance_corrections enable row level security;
create policy attc_select on attendance_corrections for select to authenticated
  using (is_company_hr(company_id) or user_id = auth.uid() or created_by = auth.uid());
create trigger attc_subscription before insert or update or delete on attendance_corrections
  for each row execute function reject_if_subscription_expired();

create function attendance_rules_of(p_company uuid) returns jsonb
  language sql stable as
$$ select coalesce(settings->'8_attendance_rules', '{}'::jsonb) from companies where id = p_company $$;

create function attendance_derive_status(
  p_company uuid, p_user uuid, p_day date,
  p_in timestamptz, p_out timestamptz, p_shift text
) returns text
  language plpgsql stable as
$$ declare
  rules jsonb; late_m int; abs_m int; start_t text; end_t text; sh jsonb; st jsonb;
  start_at timestamptz; end_at timestamptz; tz text;
begin
  if exists (select 1 from leave_requests where company_id = p_company and user_id = p_user and status = 'Approved' and p_day between start_date and end_date) then
    return 'On leave';
  end if;
  if p_shift is null or p_shift = '' or p_shift = 'OFF' then
    if p_in is not null then
      -- punching on a rest day still records presence
      return 'Present';
    end if;
    return 'Rest day';
  end if;
  if p_shift = 'L' then return 'On leave'; end if;
  select settings into st from companies where id = p_company;
  rules := coalesce(st->'8_attendance_rules', '{}'::jsonb);
  late_m := coalesce(nullif(rules->>'late', '')::int, 10);
  abs_m := coalesce(nullif(rules->>'absent', '')::int, 60);
  tz := coalesce((select timezone from companies where id = p_company), 'Indian/Maldives');
  sh := roster_shift_json(st, p_shift);
  start_t := coalesce(sh->>'start', '08:00');
  end_t := coalesce(sh->>'end', '17:00');
  begin
    start_at := (p_day::text || ' ' || start_t)::timestamp AT TIME ZONE tz;
    end_at := (p_day::text || ' ' || end_t)::timestamp AT TIME ZONE tz;
    if end_at <= start_at then end_at := end_at + interval '1 day'; end if;
  exception when others then
    start_at := (p_day::text || ' 08:00')::timestamp AT TIME ZONE 'Indian/Maldives';
    end_at := start_at + interval '8 hours';
  end;
  if p_in is null then
    if p_day > current_date then return null; end if;
    if p_day = current_date and now() <= start_at + make_interval(mins => abs_m) then return null; end if;
    return 'Absent';
  end if;
  if p_out is null and now() > end_at + interval '15 minutes' then
    return 'Missed punch';
  end if;
  if p_in > start_at + make_interval(mins => late_m) then
    return 'Late';
  end if;
  return 'Present';
end $$;

create function attendance_shift_of(p_company uuid, p_user uuid, p_day date) returns text
  language sql stable as
$$ select shift from roster_entries where company_id = p_company and user_id = p_user and day = p_day $$;

create or replace function roster_extra_block(p_company uuid, p_user uuid, p_day date, p_shift text) returns text
  language plpgsql stable security definer set search_path = public as
$$ declare st text; nm text;
begin
  if p_shift in ('OFF', 'L') then return null; end if;
  select status into st from attendance_records where company_id = p_company and user_id = p_user and day = p_day;
  if st in ('Absent', 'On leave') then
    select coalesce(p.full_name, split_part(p.email, '@', 1)) into nm from profiles p where p.id = p_user;
    return nm || ' is marked ' || st || ' on ' || to_char(p_day, 'DD Mon') || ', so they cannot take a working shift.';
  end if;
  return null;
end $$;

create function upsert_attendance(
  p_company uuid, p_user uuid, p_day date,
  p_in timestamptz, p_out timestamptz, p_source text, p_lat numeric, p_lng numeric, p_note text
) returns attendance_records
  language plpgsql security definer set search_path = public as
$$ declare
  sh text; st text; rec attendance_records;
begin
  sh := attendance_shift_of(p_company, p_user, p_day);
  st := attendance_derive_status(p_company, p_user, p_day, p_in, p_out, sh);
  insert into attendance_records (company_id, user_id, day, status, clock_in, clock_out, scheduled_shift, source, lat, lng, note, updated_by)
    values (p_company, p_user, p_day, st, p_in, p_out, sh, coalesce(p_source, 'auto'), p_lat, p_lng, nullif(left(btrim(p_note), 200), ''), auth.uid())
    on conflict (company_id, user_id, day) do update set
      status = excluded.status, clock_in = excluded.clock_in, clock_out = excluded.clock_out,
      scheduled_shift = excluded.scheduled_shift, source = excluded.source,
      lat = coalesce(excluded.lat, attendance_records.lat), lng = coalesce(excluded.lng, attendance_records.lng),
      note = coalesce(excluded.note, attendance_records.note), updated_by = excluded.updated_by, updated_at = now()
    returning * into rec;
  return rec;
end $$;
revoke execute on function upsert_attendance(uuid, uuid, date, timestamptz, timestamptz, text, numeric, numeric, text) from anon, public;

create function clock_punch(p_company uuid, p_kind text, p_lat numeric default null, p_lng numeric default null) returns attendance_records
  language plpgsql security definer set search_path = public as
$$ declare
  rec attendance_records; rules jsonb; sh text;
begin
  if p_kind not in ('in', 'out') then raise exception 'Clock in or out.'; end if;
  if not is_company_member(p_company) then raise exception 'Not a member of this company.'; end if;
  if not exists (select 1 from company_members where company_id = p_company and user_id = auth.uid() and active) then
    raise exception 'Only active staff can clock in.';
  end if;
  rules := attendance_rules_of(p_company);
  if coalesce((rules->>'geo')::boolean, false) and (p_lat is null or p_lng is null) then
    raise exception 'Location is required to clock in (see Attendance Rules).';
  end if;
  select * into rec from attendance_records where company_id = p_company and user_id = auth.uid() and day = current_date;
  if p_kind = 'in' then
    if found and rec.clock_in is not null then raise exception 'Already clocked in today at %. Ask HR to correct it.', to_char(rec.clock_in, 'HH24:MI'); end if;
    rec := upsert_attendance(p_company, auth.uid(), current_date, now(), case when found then rec.clock_out end, 'self', p_lat, p_lng, case when found then rec.note end);
  else
    if not found or rec.clock_in is null then raise exception 'Clock in before clocking out.'; end if;
    if rec.clock_out is not null then raise exception 'Already clocked out today.'; end if;
    rec := upsert_attendance(p_company, auth.uid(), current_date, rec.clock_in, now(), 'self', p_lat, p_lng, rec.note);
  end if;
  insert into company_audit (company_id, actor, action, detail)
    values (p_company, auth.uid(), 'clock_' || p_kind, current_date::text);
  return rec;
end $$;
revoke execute on function clock_punch(uuid, text, numeric, numeric) from anon, public;
grant execute on function clock_punch(uuid, text, numeric, numeric) to authenticated;

create function refresh_attendance(p_company uuid, p_day date) returns integer
  language plpgsql security definer set search_path = public as
$$ declare m record; n int := 0; rec attendance_records; sh text; st text;
begin
  if not (is_company_hr(p_company) or is_company_member(p_company) or is_platform_admin()) then
    raise exception 'Not a member of this company.';
  end if;
  for m in select user_id from company_members where company_id = p_company and active loop
    select * into rec from attendance_records where company_id = p_company and user_id = m.user_id and day = p_day;
    sh := coalesce(rec.scheduled_shift, attendance_shift_of(p_company, m.user_id, p_day));
    if rec.company_id is null then
      st := attendance_derive_status(p_company, m.user_id, p_day, null, null, sh);
      if st is null then continue; end if;
      insert into attendance_records (company_id, user_id, day, status, scheduled_shift, source, updated_by)
        values (p_company, m.user_id, p_day, st, sh, 'auto', auth.uid())
        on conflict do nothing;
      n := n + 1;
    elsif rec.source = 'auto' or rec.clock_in is not null then
      st := attendance_derive_status(p_company, m.user_id, p_day, rec.clock_in, rec.clock_out, sh);
      if st is null then continue; end if;
      if st is distinct from rec.status or sh is distinct from rec.scheduled_shift then
        update attendance_records set status = st, scheduled_shift = sh, updated_at = now()
          where company_id = p_company and user_id = m.user_id and day = p_day;
        n := n + 1;
      end if;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function refresh_attendance(uuid, date) from anon, public;
grant execute on function refresh_attendance(uuid, date) to authenticated;

create function correct_attendance(
  p_company uuid, p_user uuid, p_day date,
  p_in timestamptz, p_out timestamptz, p_status text, p_reason text
) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare
  rules jsonb; need boolean; rec attendance_records; cid uuid;
begin
  if not is_company_member(p_company) then raise exception 'Not a member of this company.'; end if;
  if p_user <> auth.uid() and not is_company_hr(p_company) then
    raise exception 'Only HR can correct someone else''s attendance.';
  end if;
  if coalesce(btrim(p_reason), '') = '' or char_length(btrim(p_reason)) < 2 then
    raise exception 'Give a reason for the correction.';
  end if;
  if p_status is not null and p_status not in ('Present', 'Late', 'Absent', 'On leave', 'Rest day', 'Missed punch') then
    raise exception 'Unknown attendance status.';
  end if;
  rules := attendance_rules_of(p_company);
  need := coalesce((rules->>'approval')::boolean, true) and not is_company_hr(p_company);
  if need then
    insert into attendance_corrections (company_id, user_id, day, clock_in, clock_out, status, reason, created_by)
      values (p_company, p_user, p_day, p_in, p_out, p_status, btrim(p_reason), auth.uid())
      returning id into cid;
    insert into company_audit (company_id, actor, action, detail) values (p_company, auth.uid(), 'attendance_correction', p_day::text);
    return jsonb_build_object('pending', true, 'id', cid);
  end if;
  rec := upsert_attendance(p_company, p_user, p_day, p_in, p_out, case when is_company_hr(p_company) then 'hr' else 'self' end, null, null, p_reason);
  if p_status is not null then
    update attendance_records set status = p_status, note = btrim(p_reason), source = 'hr', updated_by = auth.uid(), updated_at = now()
      where company_id = p_company and user_id = p_user and day = p_day
      returning * into rec;
  end if;
  insert into attendance_corrections (company_id, user_id, day, clock_in, clock_out, status, reason, status_now, decided_by, decided_at, created_by)
    values (p_company, p_user, p_day, p_in, p_out, coalesce(p_status, rec.status), btrim(p_reason), 'Approved', auth.uid(), now(), auth.uid());
  insert into company_audit (company_id, actor, action, detail) values (p_company, auth.uid(), 'attendance_corrected', p_day::text);
  return jsonb_build_object('pending', false, 'status', rec.status);
end $$;
revoke execute on function correct_attendance(uuid, uuid, date, timestamptz, timestamptz, text, text) from anon, public;
grant execute on function correct_attendance(uuid, uuid, date, timestamptz, timestamptz, text, text) to authenticated;

create function decide_attendance_correction(p_id uuid, p_approve boolean) returns void
  language plpgsql security definer set search_path = public as
$$ declare c attendance_corrections;
begin
  select * into c from attendance_corrections where id = p_id;
  if not found then raise exception 'Correction not found.'; end if;
  if not is_company_hr(c.company_id) then raise exception 'Only HR, owners and admins can decide attendance corrections.'; end if;
  if c.status_now <> 'Pending' then raise exception 'That correction has already been decided.'; end if;
  if p_approve then
    perform upsert_attendance(c.company_id, c.user_id, c.day, c.clock_in, c.clock_out, 'hr', null, null, c.reason);
    if c.status is not null then
      update attendance_records set status = c.status, note = c.reason, source = 'hr', updated_by = auth.uid(), updated_at = now()
        where company_id = c.company_id and user_id = c.user_id and day = c.day;
    end if;
  end if;
  update attendance_corrections set status_now = case when p_approve then 'Approved' else 'Rejected' end,
    decided_by = auth.uid(), decided_at = now() where id = p_id;
  insert into company_audit (company_id, actor, action, detail)
    values (c.company_id, auth.uid(), case when p_approve then 'attendance_approved' else 'attendance_rejected' end, c.day::text);
end $$;
revoke execute on function decide_attendance_correction(uuid, boolean) from anon, public;
grant execute on function decide_attendance_correction(uuid, boolean) to authenticated;

create function import_attendance(p_company uuid, p_rows jsonb) returns integer
  language plpgsql security definer set search_path = public as
$$ declare rw jsonb; uid uuid; d date; tin timestamptz; tout timestamptz; n int := 0; emp text;
begin
  if not is_company_hr(p_company) then raise exception 'Only HR, owners and admins can import attendance.'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then raise exception 'Send up to 2000 rows.'; end if;
  for rw in select * from jsonb_array_elements(p_rows) loop
    emp := btrim(rw->>'employee_no');
    d := (rw->>'date')::date;
    select user_id into uid from company_members where company_id = p_company and employee_no = emp and active;
    if uid is null then raise exception 'Unknown employee ID "%".', emp; end if;
    tin := nullif(rw->>'clock_in', '')::timestamptz;
    tout := nullif(rw->>'clock_out', '')::timestamptz;
    if tin is null and rw->>'clock_in' is not null and btrim(rw->>'clock_in') <> '' then
      tin := (d::text || ' ' || btrim(rw->>'clock_in'))::timestamp AT TIME ZONE 'Indian/Maldives';
    end if;
    if tout is null and rw->>'clock_out' is not null and btrim(rw->>'clock_out') <> '' then
      tout := (d::text || ' ' || btrim(rw->>'clock_out'))::timestamp AT TIME ZONE 'Indian/Maldives';
    end if;
    perform upsert_attendance(p_company, uid, d, tin, tout, 'csv', null, null, null);
    n := n + 1;
  end loop;
  insert into company_audit (company_id, actor, action, detail) values (p_company, auth.uid(), 'attendance_imported', n || ' rows');
  return n;
end $$;
revoke execute on function import_attendance(uuid, jsonb) from anon, public;
grant execute on function import_attendance(uuid, jsonb) to authenticated;
