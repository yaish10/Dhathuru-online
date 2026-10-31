-- Breaks during a shift: Break in / Break out after clocking in, when HR allows it (HR Settings → Attendance Rules).
-- One row per break. The shift clock (attendance_records) is not changed; break time is reported next to it.

create table attendance_breaks (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null,
  user_id     uuid not null,
  day         date not null,
  break_in    timestamptz not null default now(),
  break_out   timestamptz,
  source      text not null default 'self' check (char_length(source) between 1 and 20),
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  foreign key (company_id, user_id) references company_members (company_id, user_id) on delete cascade,
  foreign key (company_id, user_id, day) references attendance_records (company_id, user_id, day) on delete cascade,
  check (break_out is null or break_out >= break_in)
);
create index on attendance_breaks (company_id, day);
create unique index attendance_breaks_one_open on attendance_breaks (company_id, user_id) where break_out is null;
alter table attendance_breaks enable row level security;
create policy attb_select on attendance_breaks for select to authenticated
  using (is_company_hr(company_id) or user_id = auth.uid());
create trigger attb_subscription before insert or update or delete on attendance_breaks
  for each row execute function reject_if_subscription_expired();

-- Clocking out (by the person, HR, or a correction) ends any break still open at that moment.
create function attendance_close_breaks() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  if new.clock_out is not null then
    update attendance_breaks set break_out = greatest(break_in, new.clock_out)
      where company_id = new.company_id and user_id = new.user_id and day = new.day and break_out is null;
  end if;
  return new;
end $$;
revoke execute on function attendance_close_breaks() from anon, public, authenticated;
create trigger att_close_breaks after insert or update of clock_out on attendance_records
  for each row execute function attendance_close_breaks();

-- Rules from Attendance Rules: breaks (allowed or not, default not) and break_minutes (allowance per day, 0 = no limit).
create function attendance_break_rules(p_company uuid) returns jsonb
  language sql stable as
$$ select jsonb_build_object(
    'enabled', coalesce((r->>'breaks')::boolean, false),
    'minutes', coalesce(nullif(r->>'break_minutes', '')::int, 60))
   from (select attendance_rules_of(p_company) as r) x $$;
revoke execute on function attendance_break_rules(uuid) from anon, public, authenticated;

-- The signed-in person's break state for their open shift (or none).
create function my_break_state(p_company uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare
  rules jsonb; rec attendance_records; op attendance_breaks; used numeric; lst jsonb;
begin
  if not is_company_member(p_company) then raise exception 'Not a member of this company.'; end if;
  rules := attendance_break_rules(p_company);
  select * into rec from attendance_records
    where company_id = p_company and user_id = auth.uid() and day >= current_date - 1 and clock_in is not null and clock_out is null
    order by day desc limit 1;
  if not found then
    return jsonb_build_object('enabled', (rules->>'enabled')::boolean, 'allowance', (rules->>'minutes')::int, 'clocked_in', false, 'on_break', false, 'used_minutes', 0, 'breaks', '[]'::jsonb);
  end if;
  select * into op from attendance_breaks where company_id = p_company and user_id = auth.uid() and break_out is null;
  select coalesce(sum(extract(epoch from (coalesce(break_out, now()) - break_in)) / 60), 0) into used
    from attendance_breaks where company_id = p_company and user_id = auth.uid() and day = rec.day;
  select coalesce(jsonb_agg(jsonb_build_object('break_in', break_in, 'break_out', break_out) order by break_in), '[]'::jsonb) into lst
    from attendance_breaks where company_id = p_company and user_id = auth.uid() and day = rec.day;
  return jsonb_build_object(
    'enabled', (rules->>'enabled')::boolean, 'allowance', (rules->>'minutes')::int,
    'clocked_in', true, 'day', rec.day, 'on_break', op.id is not null, 'break_since', op.break_in,
    'used_minutes', round(used), 'breaks', lst);
end $$;
revoke execute on function my_break_state(uuid) from anon, public;
grant execute on function my_break_state(uuid) to authenticated;

-- p_kind 'in' starts a break, 'out' ends it. Returns the new state.
create function break_punch(p_company uuid, p_kind text) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare
  rules jsonb; st jsonb; rec attendance_records; allow int; used numeric;
begin
  if p_kind not in ('in', 'out') then raise exception 'Break in or out.'; end if;
  if not is_company_member(p_company) then raise exception 'Not a member of this company.'; end if;
  if not exists (select 1 from company_members where company_id = p_company and user_id = auth.uid() and active) then
    raise exception 'Only active staff can take a break.';
  end if;
  rules := attendance_break_rules(p_company);
  if not (rules->>'enabled')::boolean then raise exception 'Breaks are not switched on. Ask HR (Settings → Attendance Rules).'; end if;
  select * into rec from attendance_records
    where company_id = p_company and user_id = auth.uid() and day >= current_date - 1 and clock_in is not null and clock_out is null
    order by day desc limit 1;
  if not found then raise exception 'Clock in before taking a break.'; end if;
  if p_kind = 'in' then
    if exists (select 1 from attendance_breaks where company_id = p_company and user_id = auth.uid() and break_out is null) then
      raise exception 'You are already on a break.';
    end if;
    allow := (rules->>'minutes')::int;
    select coalesce(sum(extract(epoch from (coalesce(break_out, now()) - break_in)) / 60), 0) into used
      from attendance_breaks where company_id = p_company and user_id = auth.uid() and day = rec.day;
    if allow > 0 and used >= allow then
      raise exception 'You have used your % minute break allowance for today.', allow;
    end if;
    insert into attendance_breaks (company_id, user_id, day) values (p_company, auth.uid(), rec.day);
  else
    update attendance_breaks set break_out = now()
      where company_id = p_company and user_id = auth.uid() and break_out is null;
    if not found then raise exception 'You are not on a break.'; end if;
  end if;
  insert into company_audit (company_id, actor, action, detail)
    values (p_company, auth.uid(), 'break_' || p_kind, rec.day::text);
  return my_break_state(p_company);
end $$;
revoke execute on function break_punch(uuid, text) from anon, public;
grant execute on function break_punch(uuid, text) to authenticated;
