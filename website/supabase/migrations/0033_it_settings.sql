-- Finish IT Settings wiring: ticket SLAs and alert toggles from company settings,
-- and warranty / licence renewal reminders for the asset register.

-- Ticket answer times from IT Settings → IT Support & Incident Management (hours).
-- Alert toggles from IT Settings → Alerts & Notifications.
create or replace function open_ticket(p_company uuid, p_title text, p_detail text, p_category text, p_priority text) returns it_tickets
  language plpgsql security definer set search_path = public as
$$ declare
  t it_tickets; n int; sla jsonb; al jsonb; hrs int;
begin
  if not is_company_member(p_company) then raise exception 'Not a member of this company.'; end if;
  perform pg_advisory_xact_lock(hashtext('it_ticket_' || p_company::text));
  select coalesce(max(number), 0) + 1 into n from it_tickets where company_id = p_company;
  select coalesce(settings->'17_it_support_and_incident_management', '{}'::jsonb),
         coalesce(settings->'17_alerts_and_notifications', '{}'::jsonb)
    into sla, al from companies where id = p_company;
  hrs := case coalesce(p_priority, 'Normal')
    when 'Urgent' then greatest(1, coalesce(nullif(sla->>'urgent', '')::int, 4))
    when 'High'   then greatest(1, coalesce(nullif(sla->>'high', '')::int, 24))
    when 'Low'    then greatest(1, coalesce(nullif(sla->>'low', '')::int, 168))
    else               greatest(1, coalesce(nullif(sla->>'normal', '')::int, 72))
  end;
  insert into it_tickets (company_id, number, title, detail, category, priority, requester, due_at)
    values (p_company, n, btrim(p_title), nullif(btrim(p_detail), ''), coalesce(p_category, 'Other'),
            coalesce(p_priority, 'Normal'), auth.uid(), now() + make_interval(hours => hrs))
    returning * into t;
  perform it_log(p_company, 'ticket', 'ok', 'Ticket #' || n || ' opened: ' || t.title);
  if coalesce((al->>'tickets')::boolean, true) then
    perform notify_many(p_company, it_user_ids(p_company), 'it_ticket', '', 'ticket', t.id::text,
      'IT ticket #' || n || ' (' || t.priority || ')', t.title);
  end if;
  return t;
end $$;

-- New-device alerts respect Alerts & Notifications → newDevice.
create or replace function register_device(p_company uuid, p_key text, p_label text, p_kind text default 'Phone') returns it_devices
  language plpgsql security definer set search_path = public as
$$ declare d it_devices; cfg jsonb; al jsonb; auto boolean; lim int; mine int;
begin
  if not is_company_member(p_company) then raise exception 'Not a member of this company.'; end if;
  if coalesce(char_length(p_key), 0) < 16 then raise exception 'This device could not be identified.'; end if;
  select * into d from it_devices where company_id = p_company and device_key = p_key;
  if found then
    if d.user_id is distinct from auth.uid() and not d.kiosk and not is_company_it(p_company) then
      raise exception 'This device is registered to someone else. Ask IT.';
    end if;
    update it_devices set last_seen_at = now(), last_ip = request_ip() where id = d.id returning * into d;
    return d;
  end if;
  select coalesce(settings->'17_device_management', '{}'::jsonb),
         coalesce(settings->'17_alerts_and_notifications', '{}'::jsonb)
    into cfg, al from companies where id = p_company;
  auto := coalesce((cfg->>'autoApprove')::boolean, false);
  lim := coalesce(nullif(cfg->>'maxPerUser', '')::int, 2);
  select count(*) into mine from it_devices where company_id = p_company and user_id = auth.uid() and status <> 'Blocked';
  if lim > 0 and mine >= lim and not is_company_it(p_company) then
    raise exception 'You already have % device(s) registered. Ask IT to remove one first.', mine;
  end if;
  insert into it_devices (company_id, device_key, label, kind, user_id, department_id, status, last_seen_at, last_ip, registered_by)
    values (p_company, p_key, left(coalesce(nullif(btrim(p_label), ''), 'Device'), 80), coalesce(p_kind, 'Phone'), auth.uid(),
            (select department_id from company_members where company_id = p_company and user_id = auth.uid()),
            case when auto then 'Approved' else 'Pending' end, now(), request_ip(), auth.uid())
    returning * into d;
  perform it_log(p_company, 'device', 'ok',
    'Device "' || d.label || '" registered' || case when auto then ' and approved' else ', waiting for IT' end, p_key);
  if not auto and coalesce((al->>'newDevice')::boolean, true) then
    perform notify_many(p_company, it_user_ids(p_company), 'it_device', '', 'device', d.id::text,
      'New device waiting for approval', d.label);
  end if;
  return d;
end $$;

-- Warranty / licence reminders from IT Settings → IT Asset Management.
create or replace function scan_it_assets(p_company uuid) returns integer
  language plpgsql security definer set search_path = public as
$$ declare
  cfg jsonb; wd int; rd int; a record; n int := 0; kind text; title text; body text; days int;
begin
  if not is_company_it(p_company) then raise exception 'Only IT can run asset reminders.'; end if;
  select coalesce(settings->'17_it_asset_management', '{}'::jsonb) into cfg from companies where id = p_company;
  wd := greatest(1, coalesce(nullif(cfg->>'warrantyDays', '')::int, 30));
  rd := greatest(1, coalesce(nullif(cfg->>'renewDays', '')::int, 30));
  for a in
    select * from it_assets
    where company_id = p_company and status <> 'Retired'
      and ((warranty_until is not null and warranty_until <= (current_date + wd))
        or (renews_on is not null and renews_on <= (current_date + rd)))
  loop
    if a.warranty_until is not null and a.warranty_until <= (current_date + wd)
       and (a.renews_on is null or a.warranty_until <= a.renews_on) then
      kind := 'it_warranty'; days := a.warranty_until - current_date;
      title := case when days < 0 then 'Warranty ended' when days = 0 then 'Warranty ends today' else 'Warranty ends in ' || days || ' days' end;
      body := a.name || coalesce(' · ' || a.tag, '');
    else
      kind := 'it_licence'; days := a.renews_on - current_date;
      title := case when days < 0 then 'Licence overdue' when days = 0 then 'Licence renews today' else 'Licence renews in ' || days || ' days' end;
      body := a.name || coalesce(' · ' || a.tag, '');
    end if;
    perform notify_many(p_company, it_user_ids(p_company), kind,
      to_char(case when kind = 'it_warranty' then a.warranty_until else a.renews_on end, 'YYYYMMDD'),
      'asset', a.id::text, title, body);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function scan_it_assets(uuid) from anon, public;
grant execute on function scan_it_assets(uuid) to authenticated;
