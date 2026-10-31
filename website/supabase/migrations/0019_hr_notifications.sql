-- In-app notifications for HR: certificate expiry, leave submitted/decided, leave SLA reminders.
-- No email or push. Rows are written by RPCs and triggers; the bell lists them.

create table notifications (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  user_id      uuid not null,
  kind         text not null check (char_length(kind) between 2 and 40),
  stage        text not null default '' check (char_length(stage) <= 20),
  subject_type text not null check (char_length(subject_type) between 2 and 40),
  subject_id   text not null check (char_length(subject_id) between 1 and 80),
  title        text not null check (char_length(title) between 1 and 120),
  body         text check (body is null or char_length(body) <= 400),
  read_at      timestamptz,
  created_at   timestamptz not null default now(),
  unique (company_id, user_id, kind, stage, subject_id),
  foreign key (company_id, user_id) references company_members (company_id, user_id) on delete cascade
);
create index on notifications (company_id, user_id, created_at desc);
create index on notifications (company_id, user_id, read_at);
alter table notifications enable row level security;

create policy notif_select on notifications for select to authenticated
  using (user_id = auth.uid() or is_company_hr(company_id) or is_platform_admin());
create policy notif_update on notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Inserts and deletes go through RPCs.

create function in_app_notifications_on(p_company uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select coalesce((settings->'11_in_app_notifications'->>'enabled')::boolean, true)
   from companies where id = p_company $$;
revoke execute on function in_app_notifications_on(uuid) from anon, public;
grant execute on function in_app_notifications_on(uuid) to authenticated;

create function hr_user_ids(p_company uuid) returns uuid[]
  language sql stable security definer set search_path = public as
$$ select coalesce(array_agg(user_id), '{}') from company_members
   where company_id = p_company and active and role in ('owner', 'admin', 'hr') $$;
revoke execute on function hr_user_ids(uuid) from anon, public;

create function notify_user(
  p_company uuid, p_user uuid, p_kind text, p_stage text,
  p_subject_type text, p_subject_id text, p_title text, p_body text
) returns boolean
  language plpgsql security definer set search_path = public as
$$ begin
  if p_user is null then return false; end if;
  if not in_app_notifications_on(p_company) then return false; end if;
  if not exists (select 1 from company_members where company_id = p_company and user_id = p_user and active) then
    return false;
  end if;
  insert into notifications (company_id, user_id, kind, stage, subject_type, subject_id, title, body)
    values (p_company, p_user, p_kind, coalesce(p_stage, ''), p_subject_type, p_subject_id,
            left(p_title, 120), nullif(left(p_body, 400), ''))
    on conflict (company_id, user_id, kind, stage, subject_id) do nothing;
  return found;
end $$;
revoke execute on function notify_user(uuid, uuid, text, text, text, text, text, text) from anon, public;

create function notify_many(
  p_company uuid, p_users uuid[], p_kind text, p_stage text,
  p_subject_type text, p_subject_id text, p_title text, p_body text
) returns integer
  language plpgsql security definer set search_path = public as
$$ declare u uuid; n integer := 0;
begin
  if p_users is null then return 0; end if;
  foreach u in array p_users loop
    if notify_user(p_company, u, p_kind, p_stage, p_subject_type, p_subject_id, p_title, p_body) then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke execute on function notify_many(uuid, uuid[], text, text, text, text, text, text) from anon, public;

-- Leave: tell approvers a request arrived, tell the person when it is decided.
create function leave_notify() returns trigger
  language plpgsql security definer set search_path = public as
$$ declare named uuid[]; who text; title text; body text;
begin
  select coalesce(p.full_name, split_part(p.email, '@', 1), 'Someone') into who from profiles p where p.id = new.user_id;
  if tg_op = 'INSERT' and new.status = 'Pending' then
    named := leave_approver_ids(new.id);
    if named is null or array_length(named, 1) is null then named := hr_user_ids(new.company_id); end if;
    perform notify_many(new.company_id, named, 'leave_request', 'submitted', 'leave', new.id::text,
      'Leave request from ' || who,
      who || ' asked for ' || new.leave_type || ' from ' || to_char(new.start_date, 'DD Mon') || ' to ' || to_char(new.end_date, 'DD Mon') || '.');
  elsif tg_op = 'INSERT' and new.status = 'Approved' then
    perform notify_user(new.company_id, new.user_id, 'leave_decision', 'approved', 'leave', new.id::text,
      'Leave approved', 'Your ' || new.leave_type || ' request was approved automatically.');
  elsif tg_op = 'UPDATE' and old.status = 'Pending' and new.status in ('Approved', 'Rejected') then
    title := case when new.status = 'Approved' then 'Leave approved' else 'Leave rejected' end;
    body := 'Your ' || new.leave_type || ' request (' || to_char(new.start_date, 'DD Mon') || ' – ' || to_char(new.end_date, 'DD Mon') || ') was ' || lower(new.status) || '.';
    perform notify_user(new.company_id, new.user_id, 'leave_decision', lower(new.status), 'leave', new.id::text, title, body);
  end if;
  return new;
end $$;
create trigger leave_notify after insert or update on leave_requests
  for each row execute function leave_notify();

-- Scan: certificate first/second/final windows, and pending leave older than the SLA.
create function scan_hr_notifications(p_company uuid) returns integer
  language plpgsql security definer set search_path = public as
$$ declare
  st jsonb; alerts jsonb; audience text; first_d int; second_d int; final_d int; sla int; n int := 0;
  rec record; days_left int; stage text; title text; body text; recips uuid[]; mgr uuid; emp_on boolean; hr_on boolean; mgr_on boolean;
begin
  if not (is_company_member(p_company) or is_platform_admin()) then
    raise exception 'Not a member of this company.';
  end if;
  if not in_app_notifications_on(p_company) then return 0; end if;
  select settings into st from companies where id = p_company;
  alerts := coalesce(st->'8_license_and_certificate_expiry_alerts', '{}'::jsonb);
  first_d := coalesce(nullif(alerts->>'first', '')::int, 90);
  second_d := coalesce(nullif(alerts->>'second', '')::int, 30);
  final_d := coalesce(nullif(alerts->>'final', '')::int, 7);
  audience := coalesce(alerts->>'audience', 'Employee, HR & manager');
  emp_on := audience like '%Employee%';
  hr_on := audience like '%HR%';
  mgr_on := audience like '%manager%';
  sla := coalesce(nullif(st->'8_leave_approval_workflow'->>'sla', '')::int, 24);

  for rec in
    select c.id, c.user_id, c.name, c.valid_until,
           coalesce(p.full_name, split_part(p.email, '@', 1), 'Someone') as who
    from staff_certifications c
    join profiles p on p.id = c.user_id
    where c.company_id = p_company and c.valid_until is not null
  loop
    days_left := rec.valid_until - current_date;
    if days_left > first_d then continue; end if;
    if days_left <= final_d then stage := 'final';
    elsif days_left <= second_d then stage := 'second';
    else stage := 'first';
    end if;
    title := rec.name || case
      when days_left < 0 then ' expired'
      when stage = 'final' then ' expires in ' || days_left || ' day' || case when days_left = 1 then '' else 's' end
      when stage = 'second' then ' expires soon'
      else ' due for renewal' end;
    body := rec.who || ' · ' || rec.name || ' · ' || to_char(rec.valid_until, 'DD Mon YYYY');
    recips := '{}';
    if emp_on then recips := recips || rec.user_id; end if;
    if hr_on then recips := recips || hr_user_ids(p_company); end if;
    if mgr_on then
      select manager_id into mgr from company_members where company_id = p_company and user_id = rec.user_id;
      if mgr is not null then recips := recips || mgr; end if;
    end if;
    n := n + notify_many(p_company, recips, 'cert_expiry', stage, 'certification', rec.id::text, title, body);
  end loop;

  for rec in
    select l.id, l.user_id, l.leave_type, l.start_date, l.end_date, l.created_at,
           coalesce(p.full_name, split_part(p.email, '@', 1), 'Someone') as who
    from leave_requests l
    join profiles p on p.id = l.user_id
    where l.company_id = p_company and l.status = 'Pending'
      and l.created_at <= now() - make_interval(hours => greatest(sla, 1))
  loop
    recips := leave_approver_ids(rec.id);
    if recips is null or array_length(recips, 1) is null then recips := hr_user_ids(p_company); end if;
    n := n + notify_many(p_company, recips, 'leave_reminder', 'sla', 'leave', rec.id::text,
      'Leave still waiting: ' || rec.who,
      rec.who || ' asked for ' || rec.leave_type || ' ' || sla || ' hours ago and it is still pending.');
  end loop;
  return n;
end $$;
revoke execute on function scan_hr_notifications(uuid) from anon, public;
grant execute on function scan_hr_notifications(uuid) to authenticated;

create function mark_notifications_read(p_ids uuid[]) returns integer
  language plpgsql security definer set search_path = public as
$$ declare n integer;
begin
  if p_ids is null or jsonb_array_length(to_jsonb(p_ids)) is null then return 0; end if;
  update notifications set read_at = coalesce(read_at, now())
    where user_id = auth.uid() and id = any(p_ids) and read_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function mark_notifications_read(uuid[]) from anon, public;
grant execute on function mark_notifications_read(uuid[]) to authenticated;
