-- Renumbered by Claude 2026-10-30: was 0062 (taken — veyora already has 0001–0081 applied). Apply after 0081.
-- Cursor 2026-10-30: in-app alerts when a roster is assigned, a roster changes, or a passenger is added.
-- One note per person per minute, so saving a whole week does not flood the bell.
-- Missing settings mean the alert is on. In-app delivery still follows 11_in_app_notifications.

create or replace function alert_inapp_on(p_company uuid, p_key text) returns boolean
  language sql stable security definer set search_path = public as
$$ select coalesce((select (settings->p_key->>'inapp')::boolean from companies where id = p_company), true) $$;
revoke execute on function alert_inapp_on(uuid, text) from anon, public;

create or replace function roster_entry_notify() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare
  nm text;
  stamp text;
  daytxt text;
  who uuid[];
begin
  if tg_op = 'UPDATE' and new.shift is not distinct from old.shift then
    return new;
  end if;
  stamp := to_char(now(), 'YYYYMMDDHH24MI');
  daytxt := to_char(new.day, 'DD Mon');
  select coalesce(p.full_name, split_part(coalesce(p.email, ''), '@', 1), 'A crew member')
    into nm from profiles p where p.id = new.user_id;
  nm := coalesce(nm, 'A crew member');
  who := hr_user_ids(new.company_id);

  if tg_op = 'INSERT' then
    if alert_inapp_on(new.company_id, '11_roster_assigned') then
      if new.user_id is distinct from new.updated_by then
        perform notify_user(new.company_id, new.user_id, 'roster_assigned', 'you', 'roster',
          new.user_id::text || ':a:' || stamp,
          'New roster assigned',
          'You are on ' || new.shift || ' on ' || daytxt || '.');
      end if;
      perform notify_many(new.company_id, who, 'roster_assigned', 'office', 'roster',
        'office:a:' || stamp,
        'New roster assigned',
        nm || ' was assigned ' || new.shift || ' on ' || daytxt || '.');
    end if;
  elsif alert_inapp_on(new.company_id, '11_roster_updated') then
    if new.user_id is distinct from new.updated_by then
      perform notify_user(new.company_id, new.user_id, 'roster_updated', 'you', 'roster',
        new.user_id::text || ':u:' || stamp,
        'Roster updated',
        'Your shift on ' || daytxt || ' is now ' || coalesce(old.shift, 'none') || ' → ' || new.shift || '.');
    end if;
    perform notify_many(new.company_id, who, 'roster_updated', 'office', 'roster',
      'office:u:' || stamp,
      'Roster updated',
      nm || ' on ' || daytxt || ' is now ' || new.shift || '.');
  end if;
  return new;
end $$;

drop trigger if exists roster_entry_notify on roster_entries;
create trigger roster_entry_notify
  after insert or update on roster_entries
  for each row execute function roster_entry_notify();

create or replace function passenger_added_notify() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare who uuid[];
begin
  if not alert_inapp_on(new.company_id, '11_new_passenger') then
    return new;
  end if;
  select coalesce(array_agg(u), '{}') into who
    from unnest(ops_user_ids(new.company_id)) u
    where u is distinct from new.created_by;
  perform notify_many(new.company_id, who, 'passenger_added', 'new', 'passenger', new.id::text,
    'New passenger added',
    btrim(new.full_name) || case when coalesce(btrim(new.category), '') <> '' then ' · ' || btrim(new.category) else '' end || '.');
  return new;
end $$;

drop trigger if exists passenger_added_notify on passengers;
create trigger passenger_added_notify
  after insert on passengers
  for each row execute function passenger_added_notify();
