-- IT department, per company: an "IT" access role, approved office networks, device registration, rules for
-- clocking in from the app (network and device), IT asset register, support tickets and an IT activity log.
-- IT settings live under keys 17_ (IT Settings), 13_ (Security & Authentication) and 14_ (Integrations & Data).
-- Backups, server monitoring, email delivery, SSO and password/MFA rules are run by the platform (Supabase) for
-- everyone, so they are shown in IT Settings as "managed by VEYORA", not set per company.

alter type member_role add value if not exists 'it';

-- 1. Who counts as IT: platform owner, company owner/admin, and people with the IT role.
create function is_company_it(cid uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select is_platform_admin() or exists (select 1 from company_members
     where company_id = cid and user_id = auth.uid() and active and role::text in ('owner', 'admin', 'it')) $$;
revoke execute on function is_company_it(uuid) from anon, public;
grant execute on function is_company_it(uuid) to authenticated;

create function it_user_ids(p_company uuid) returns uuid[]
  language sql stable security definer set search_path = public as
$$ select coalesce(array_agg(user_id), '{}') from company_members
   where company_id = p_company and active and role::text in ('owner', 'admin', 'it') $$;
revoke execute on function it_user_ids(uuid) from anon, public;

-- IT may change IT settings (13_, 14_, 17_); HR keeps 8_ and 16_; everything else stays owner/admin.
create or replace function set_company_setting(p_company uuid, p_key text, p_value jsonb) returns void
  language plpgsql security definer set search_path = public as
$$ begin
  if not (is_company_admin(p_company)
          or ((p_key like '8\_%' or p_key like '16\_%') and is_company_hr(p_company))
          or ((p_key like '13\_%' or p_key like '14\_%' or p_key like '17\_%') and is_company_it(p_company))) then
    raise exception 'Only owners and admins can change settings.';
  end if;
  if p_key !~ '^[a-z0-9_]{1,60}$' then raise exception 'Invalid setting key.'; end if;
  if pg_column_size(p_value) > 100000 then raise exception 'Setting is too large.'; end if;
  update companies set settings = jsonb_set(coalesce(settings, '{}'::jsonb), array[p_key], p_value, true) where id = p_company;
  insert into company_audit (company_id, actor, action, detail) values (p_company, auth.uid(), 'setting_changed', p_key);
end $$;

-- 2. The caller's public IP, as seen by the API gateway.
create function request_ip() returns text
  language plpgsql stable as
$$ declare h json; v text;
begin
  begin h := current_setting('request.headers', true)::json; exception when others then return null; end;
  if h is null then return null; end if;
  v := coalesce(h->>'cf-connecting-ip', h->>'x-real-ip', split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1));
  v := nullif(btrim(v), '');
  return v;
end $$;

-- 3. Activity log for IT (network and device checks, device and asset changes, tickets).
create table it_events (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references companies(id) on delete cascade,
  kind        text not null check (char_length(kind) between 2 and 40),
  outcome     text not null default 'ok' check (outcome in ('ok', 'denied', 'warning')),
  detail      text not null check (char_length(detail) <= 300),
  actor       uuid references auth.users(id) on delete set null,
  ip          text,
  device_key  text,
  created_at  timestamptz not null default now()
);
create index on it_events (company_id, created_at desc);
alter table it_events enable row level security;
create policy itev_select on it_events for select to authenticated using (is_company_it(company_id));

create function it_log(p_company uuid, p_kind text, p_outcome text, p_detail text, p_device text default null) returns void
  language sql security definer set search_path = public as
$$ insert into it_events (company_id, kind, outcome, detail, actor, ip, device_key)
   select p_company, p_kind, p_outcome, left(p_detail, 300), auth.uid(), request_ip(), p_device
   where exists (select 1 from companies where id = p_company) $$;
revoke execute on function it_log(uuid, text, text, text, text) from anon, public, authenticated;

-- 4. Approved networks (public IP or CIDR range). IT manages them directly (RLS).
create table it_networks (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 2 and 60),
  cidr        cidr not null,
  kind        text not null default 'Office' check (kind in ('Office', 'VPN', 'Branch', 'Temporary')),
  active      boolean not null default true,
  expires_at  timestamptz,
  note        text check (note is null or char_length(note) <= 200),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index on it_networks (company_id);
alter table it_networks enable row level security;
create policy itnet_select on it_networks for select to authenticated using (is_company_it(company_id));
create policy itnet_insert on it_networks for insert to authenticated with check (is_company_it(company_id));
create policy itnet_update on it_networks for update to authenticated using (is_company_it(company_id)) with check (is_company_it(company_id));
create policy itnet_delete on it_networks for delete to authenticated using (is_company_it(company_id));
create trigger itnet_subscription before insert or update or delete on it_networks for each row execute function reject_if_subscription_expired();

create function it_network_of(p_company uuid, p_ip text) returns it_networks
  language plpgsql stable security definer set search_path = public as
$$ declare n it_networks; a inet;
begin
  begin a := p_ip::inet; exception when others then return null; end;
  select * into n from it_networks where company_id = p_company and active and (expires_at is null or expires_at > now()) and a <<= cidr
    order by masklen(cidr) desc limit 1;
  return n;
end $$;
revoke execute on function it_network_of(uuid, text) from anon, public, authenticated;

-- What network am I on? (diagnostics, and the page gate). Any member.
create function it_network_status(p_company uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare ip text; n it_networks;
begin
  if not (is_company_member(p_company) or is_platform_admin()) then raise exception 'Not a member of this company.'; end if;
  ip := request_ip(); n := it_network_of(p_company, ip);
  return jsonb_build_object('ip', ip, 'approved', n.id is not null, 'network', n.name, 'kind', n.kind,
    'networks', (select count(*) from it_networks where company_id = p_company and active), 'it', is_company_it(p_company));
end $$;
revoke execute on function it_network_status(uuid) from anon, public;
grant execute on function it_network_status(uuid) to authenticated;

-- 5. Devices. Staff register the browser or phone they use; IT approves, assigns or blocks.
create table it_devices (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  device_key    text not null check (char_length(device_key) between 16 and 80),
  label         text not null check (char_length(btrim(label)) between 1 and 80),
  kind          text not null default 'Phone' check (kind in ('Phone', 'Computer', 'Tablet', 'Attendance terminal')),
  user_id       uuid references auth.users(id) on delete set null,
  department_id uuid references departments(id) on delete set null,
  status        text not null default 'Pending' check (status in ('Pending', 'Approved', 'Blocked')),
  kiosk         boolean not null default false,
  last_seen_at  timestamptz,
  last_ip       text,
  note          text check (note is null or char_length(note) <= 200),
  registered_by uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (company_id, device_key)
);
alter table it_devices enable row level security;
create policy itdev_select on it_devices for select to authenticated using (is_company_it(company_id) or user_id = auth.uid() or registered_by = auth.uid());
create policy itdev_update on it_devices for update to authenticated using (is_company_it(company_id)) with check (is_company_it(company_id));
create policy itdev_delete on it_devices for delete to authenticated using (is_company_it(company_id));
create trigger itdev_subscription before insert or update or delete on it_devices for each row execute function reject_if_subscription_expired();

create function it_devices_audit() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    perform it_log(new.company_id, 'device', case when new.status = 'Blocked' then 'warning' else 'ok' end, 'Device "' || new.label || '" ' || lower(new.status), new.device_key);
  elsif tg_op = 'DELETE' and exists (select 1 from companies where id = old.company_id) then
    perform it_log(old.company_id, 'device', 'ok', 'Device "' || old.label || '" removed', old.device_key);
  end if;
  return coalesce(new, old);
end $$;
create trigger itdev_audit after update or delete on it_devices for each row execute function it_devices_audit();

create function register_device(p_company uuid, p_key text, p_label text, p_kind text default 'Phone') returns it_devices
  language plpgsql security definer set search_path = public as
$$ declare d it_devices; cfg jsonb; auto boolean; lim int; mine int;
begin
  if not is_company_member(p_company) then raise exception 'Not a member of this company.'; end if;
  if coalesce(char_length(p_key), 0) < 16 then raise exception 'This device could not be identified.'; end if;
  select * into d from it_devices where company_id = p_company and device_key = p_key;
  if found then
    if d.user_id is distinct from auth.uid() and not d.kiosk and not is_company_it(p_company) then raise exception 'This device is registered to someone else. Ask IT.'; end if;
    update it_devices set last_seen_at = now(), last_ip = request_ip() where id = d.id returning * into d;
    return d;
  end if;
  select coalesce(settings->'17_device_management', '{}'::jsonb) into cfg from companies where id = p_company;
  auto := coalesce((cfg->>'autoApprove')::boolean, false);
  lim := coalesce(nullif(cfg->>'maxPerUser', '')::int, 2);
  select count(*) into mine from it_devices where company_id = p_company and user_id = auth.uid() and status <> 'Blocked';
  if lim > 0 and mine >= lim and not is_company_it(p_company) then raise exception 'You already have % device(s) registered. Ask IT to remove one first.', mine; end if;
  insert into it_devices (company_id, device_key, label, kind, user_id, department_id, status, last_seen_at, last_ip, registered_by)
    values (p_company, p_key, left(coalesce(nullif(btrim(p_label), ''), 'Device'), 80), coalesce(p_kind, 'Phone'), auth.uid(),
            (select department_id from company_members where company_id = p_company and user_id = auth.uid()),
            case when auto then 'Approved' else 'Pending' end, now(), request_ip(), auth.uid())
    returning * into d;
  perform it_log(p_company, 'device', 'ok', 'Device "' || d.label || '" registered' || case when auto then ' and approved' else ', waiting for IT' end, p_key);
  if not auto then
    perform notify_many(p_company, it_user_ids(p_company), 'it_device', '', 'device', d.id::text, 'New device waiting for approval', d.label);
  end if;
  return d;
end $$;
revoke execute on function register_device(uuid, text, text, text) from anon, public;
grant execute on function register_device(uuid, text, text, text) to authenticated;

-- 6. Clock-in rules from IT Settings → Mobile Check-in & Check-out. Returns why a punch is not allowed, or null.
create function it_punch_block(p_company uuid, p_device text) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare cfg jsonb; ip text; n it_networks; d it_devices; depts text[]; mydept text;
begin
  select coalesce(settings->'17_mobile_check_in_and_check_out', '{}'::jsonb) into cfg from companies where id = p_company;
  ip := request_ip();
  if coalesce((cfg->>'enabled')::boolean, true) is false then
    return jsonb_build_object('kind', 'disabled', 'reason', 'Clocking in from the app is switched off. Use the attendance terminal or ask HR.');
  end if;
  depts := array(select lower(btrim(x)) from unnest(string_to_array(coalesce(cfg->>'depts', ''), ',')) x where btrim(x) <> '');
  if cardinality(depts) > 0 then
    select lower(dp.name) into mydept from company_members cm left join departments dp on dp.id = cm.department_id where cm.company_id = p_company and cm.user_id = auth.uid();
    if mydept is null or not (mydept = any(depts)) then
      return jsonb_build_object('kind', 'department', 'reason', 'Your department cannot clock in from the app. Use the attendance terminal or ask HR.');
    end if;
  end if;
  if coalesce(cfg->>'network', 'Any network') = 'Approved networks only' then
    n := it_network_of(p_company, ip);
    if n.id is null then
      return jsonb_build_object('kind', 'network', 'ip', ip, 'reason', 'You are not on an approved office network' || coalesce(' (your network: ' || ip || ')', '') || '. Connect to the office Wi-Fi or VPN and try again.');
    end if;
  end if;
  if coalesce(cfg->>'device', 'Any device') = 'Registered devices only' then
    select * into d from it_devices where company_id = p_company and device_key = p_device;
    if d.id is null then return jsonb_build_object('kind', 'device', 'reason', 'This device is not registered. Register it under IT → My devices, then ask IT to approve it.'); end if;
    if d.status = 'Blocked' then return jsonb_build_object('kind', 'device', 'reason', 'This device is blocked by IT.'); end if;
    if d.status <> 'Approved' then return jsonb_build_object('kind', 'device', 'reason', 'This device is waiting for IT approval.'); end if;
    if d.user_id is distinct from auth.uid() and not (d.kiosk and coalesce((cfg->>'kiosk')::boolean, true)) then
      return jsonb_build_object('kind', 'device', 'reason', 'This device belongs to someone else.');
    end if;
  end if;
  return null;
end $$;
revoke execute on function it_punch_block(uuid, text) from anon, public, authenticated;

-- Checked by the app before clocking in, so refused attempts are logged and IT is alerted (a refused clock_punch rolls back its own log).
create function punch_check(p_company uuid, p_device text default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare b jsonb; al jsonb; nm text; ip text;
begin
  if not is_company_member(p_company) then raise exception 'Not a member of this company.'; end if;
  b := it_punch_block(p_company, p_device); ip := request_ip();
  if b is null then
    update it_devices set last_seen_at = now(), last_ip = ip where company_id = p_company and device_key = p_device;
    perform it_log(p_company, 'clock_check', 'ok', 'Clock-in check passed' || coalesce(' on ' || (it_network_of(p_company, ip)).name, ''), p_device);
    return jsonb_build_object('ok', true, 'ip', ip);
  end if;
  select coalesce(p.full_name, split_part(p.email, '@', 1)) into nm from profiles p where p.id = auth.uid();
  perform it_log(p_company, 'clock_' || (b->>'kind'), 'denied', coalesce(nm, 'Someone') || ': ' || (b->>'reason'), p_device);
  select coalesce(settings->'17_alerts_and_notifications', '{}'::jsonb) into al from companies where id = p_company;
  if (b->>'kind' = 'network' and coalesce((al->>'network')::boolean, true)) or (b->>'kind' = 'device' and coalesce((al->>'device')::boolean, true)) then
    perform notify_many(p_company, it_user_ids(p_company), 'it_alert', left(b->>'kind', 3) || to_char(now(), 'YYYYMMDDHH24'), 'clock', auth.uid()::text,
      case when b->>'kind' = 'network' then 'Clock-in from an unapproved network' else 'Clock-in from an unapproved device' end,
      coalesce(nm, 'Someone') || coalesce(' · ' || ip, ''));
  end if;
  return jsonb_build_object('ok', false, 'kind', b->>'kind', 'reason', b->>'reason', 'ip', ip);
end $$;
revoke execute on function punch_check(uuid, text) from anon, public;
grant execute on function punch_check(uuid, text) to authenticated;

-- clock_punch (0021) with the IT rules enforced. The old 4-argument version is replaced so the rules cannot be skipped.
drop function clock_punch(uuid, text, numeric, numeric);
create function clock_punch(p_company uuid, p_kind text, p_lat numeric default null, p_lng numeric default null, p_device text default null) returns attendance_records
  language plpgsql security definer set search_path = public as
$$ declare
  rec attendance_records; rules jsonb; blk jsonb;
begin
  if p_kind not in ('in', 'out') then raise exception 'Clock in or out.'; end if;
  if not is_company_member(p_company) then raise exception 'Not a member of this company.'; end if;
  if not exists (select 1 from company_members where company_id = p_company and user_id = auth.uid() and active) then
    raise exception 'Only active staff can clock in.';
  end if;
  blk := it_punch_block(p_company, p_device);
  if blk is not null then raise exception '%', blk->>'reason'; end if;
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
revoke execute on function clock_punch(uuid, text, numeric, numeric, text) from anon, public;
grant execute on function clock_punch(uuid, text, numeric, numeric, text) to authenticated;

-- 7. IT asset register (computers, phones, servers, network kit, software licences).
create table it_assets (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies(id) on delete cascade,
  tag            text check (tag is null or char_length(tag) <= 40),
  name           text not null check (char_length(btrim(name)) between 2 and 80),
  kind           text not null default 'Computer' check (kind in ('Computer', 'Phone', 'Tablet', 'Server', 'Network', 'Printer', 'Attendance terminal', 'Software licence', 'Other')),
  serial         text check (serial is null or char_length(serial) <= 80),
  user_id        uuid references auth.users(id) on delete set null,
  department_id  uuid references departments(id) on delete set null,
  status         text not null default 'In use' check (status in ('In use', 'In stock', 'Repair', 'Retired', 'Lost')),
  purchased_on   date,
  warranty_until date,
  renews_on      date,
  seats          integer check (seats is null or seats >= 0),
  note           text check (note is null or char_length(note) <= 300),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on it_assets (company_id);
alter table it_assets enable row level security;
create policy itas_select on it_assets for select to authenticated using (is_company_it(company_id) or user_id = auth.uid());
create policy itas_insert on it_assets for insert to authenticated with check (is_company_it(company_id));
create policy itas_update on it_assets for update to authenticated using (is_company_it(company_id)) with check (is_company_it(company_id));
create policy itas_delete on it_assets for delete to authenticated using (is_company_it(company_id));
create trigger itas_subscription before insert or update or delete on it_assets for each row execute function reject_if_subscription_expired();

create function it_assets_audit() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  if tg_op = 'INSERT' then perform it_log(new.company_id, 'asset', 'ok', 'Asset added: ' || new.name);
  elsif tg_op = 'UPDATE' then
    new.updated_at := now();
    if new.status is distinct from old.status then perform it_log(new.company_id, 'asset', 'ok', 'Asset ' || new.name || ': ' || old.status || ' → ' || new.status); end if;
    if new.user_id is distinct from old.user_id then perform it_log(new.company_id, 'asset', 'ok', 'Asset ' || new.name || ' reassigned'); end if;
  elsif exists (select 1 from companies where id = old.company_id) then perform it_log(old.company_id, 'asset', 'ok', 'Asset removed: ' || old.name);
  end if;
  return coalesce(new, old);
end $$;
create trigger itas_audit_b before update on it_assets for each row execute function it_assets_audit();
create trigger itas_audit_a after insert or delete on it_assets for each row execute function it_assets_audit();

-- 8. Support tickets. Anyone can report a problem and follow their own; IT sees and works all of them.
create table it_tickets (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  number      integer not null,
  title       text not null check (char_length(btrim(title)) between 3 and 120),
  detail      text check (detail is null or char_length(detail) <= 2000),
  category    text not null default 'Other' check (category in ('Access & login', 'Device', 'Network', 'App problem', 'Hardware', 'Other')),
  priority    text not null default 'Normal' check (priority in ('Low', 'Normal', 'High', 'Urgent')),
  status      text not null default 'Open' check (status in ('Open', 'In progress', 'Waiting', 'Resolved', 'Closed')),
  requester   uuid not null references auth.users(id) on delete cascade,
  assignee    uuid references auth.users(id) on delete set null,
  due_at      timestamptz,
  resolution  text check (resolution is null or char_length(resolution) <= 1000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  resolved_at timestamptz,
  unique (company_id, number)
);
alter table it_tickets enable row level security;
create policy ittk_select on it_tickets for select to authenticated using (is_company_it(company_id) or requester = auth.uid());
create policy ittk_update on it_tickets for update to authenticated using (is_company_it(company_id)) with check (is_company_it(company_id));
create trigger ittk_subscription before insert or update or delete on it_tickets for each row execute function reject_if_subscription_expired();

create table it_ticket_notes (
  id         bigint generated always as identity primary key,
  ticket_id  uuid not null references it_tickets(id) on delete cascade,
  author     uuid references auth.users(id) on delete set null,
  body       text not null check (char_length(btrim(body)) between 1 and 2000),
  internal   boolean not null default false,
  created_at timestamptz not null default now()
);
alter table it_ticket_notes enable row level security;
create function it_ticket_visible(p_ticket uuid, p_internal boolean) returns boolean
  language sql stable security definer set search_path = public as
$$ select exists (select 1 from it_tickets t where t.id = p_ticket and (is_company_it(t.company_id) or (t.requester = auth.uid() and not p_internal))) $$;
revoke execute on function it_ticket_visible(uuid, boolean) from anon, public;
grant execute on function it_ticket_visible(uuid, boolean) to authenticated;
create policy ittn_select on it_ticket_notes for select to authenticated using (it_ticket_visible(ticket_id, internal));

-- Due time from priority: Urgent 4h, High 1 day, Normal 3 days, Low 7 days.
create function open_ticket(p_company uuid, p_title text, p_detail text, p_category text, p_priority text) returns it_tickets
  language plpgsql security definer set search_path = public as
$$ declare t it_tickets; n int;
begin
  if not is_company_member(p_company) then raise exception 'Not a member of this company.'; end if;
  perform pg_advisory_xact_lock(hashtext('it_ticket_' || p_company::text));
  select coalesce(max(number), 0) + 1 into n from it_tickets where company_id = p_company;
  insert into it_tickets (company_id, number, title, detail, category, priority, requester, due_at)
    values (p_company, n, btrim(p_title), nullif(btrim(p_detail), ''), coalesce(p_category, 'Other'), coalesce(p_priority, 'Normal'), auth.uid(),
            now() + case coalesce(p_priority, 'Normal') when 'Urgent' then interval '4 hours' when 'High' then interval '1 day' when 'Low' then interval '7 days' else interval '3 days' end)
    returning * into t;
  perform it_log(p_company, 'ticket', 'ok', 'Ticket #' || n || ' opened: ' || t.title);
  perform notify_many(p_company, it_user_ids(p_company), 'it_ticket', '', 'ticket', t.id::text, 'IT ticket #' || n || ' (' || t.priority || ')', t.title);
  return t;
end $$;
revoke execute on function open_ticket(uuid, text, text, text, text) from anon, public;
grant execute on function open_ticket(uuid, text, text, text, text) to authenticated;

create function add_ticket_note(p_ticket uuid, p_body text, p_internal boolean default false) returns void
  language plpgsql security definer set search_path = public as
$$ declare t it_tickets;
begin
  select * into t from it_tickets where id = p_ticket;
  if not found then raise exception 'Ticket not found.'; end if;
  if not (is_company_it(t.company_id) or t.requester = auth.uid()) then raise exception 'You cannot reply to this ticket.'; end if;
  if coalesce(char_length(btrim(p_body)), 0) < 1 then raise exception 'Write a reply first.'; end if;
  insert into it_ticket_notes (ticket_id, author, body, internal) values (p_ticket, auth.uid(), btrim(p_body), coalesce(p_internal, false) and is_company_it(t.company_id));
  update it_tickets set updated_at = now(), status = case when t.requester = auth.uid() and t.status in ('Waiting', 'Resolved') then 'Open' else status end where id = p_ticket;
  if not coalesce(p_internal, false) then
    if is_company_it(t.company_id) and t.requester <> auth.uid() then
      perform notify_user(t.company_id, t.requester, 'it_ticket_reply', to_char(now(), 'YYYYMMDDHH24MI'), 'ticket', t.id::text, 'IT replied to ticket #' || t.number, left(btrim(p_body), 120));
    elsif t.assignee is not null and t.assignee <> auth.uid() then
      perform notify_user(t.company_id, t.assignee, 'it_ticket_reply', to_char(now(), 'YYYYMMDDHH24MI'), 'ticket', t.id::text, 'New reply on ticket #' || t.number, left(btrim(p_body), 120));
    end if;
  end if;
end $$;
revoke execute on function add_ticket_note(uuid, text, boolean) from anon, public;
grant execute on function add_ticket_note(uuid, text, boolean) to authenticated;

create function it_tickets_audit() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    if new.status in ('Resolved', 'Closed') and old.status not in ('Resolved', 'Closed') then new.resolved_at := now(); end if;
    perform it_log(new.company_id, 'ticket', 'ok', 'Ticket #' || new.number || ': ' || old.status || ' → ' || new.status);
    if new.status = 'Resolved' then
      perform notify_user(new.company_id, new.requester, 'it_ticket_done', '', 'ticket', new.id::text, 'Ticket #' || new.number || ' resolved', coalesce(new.resolution, new.title));
    end if;
  end if;
  if new.assignee is distinct from old.assignee and new.assignee is not null then
    perform notify_user(new.company_id, new.assignee, 'it_ticket_assigned', to_char(now(), 'YYYYMMDDHH24MI'), 'ticket', new.id::text, 'Ticket #' || new.number || ' assigned to you', new.title);
  end if;
  return new;
end $$;
create trigger ittk_audit before update on it_tickets for each row execute function it_tickets_audit();
