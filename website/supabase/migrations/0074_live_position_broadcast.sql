-- Live vessel positions for the Operations map. Every stored fix is also broadcast the moment it is written, on a private
-- Realtime channel per company ('vessel-pos:<company id>'), so the map moves the boat instantly instead of polling.
-- Only people in Operations for that company may listen (RLS on realtime.messages). The broadcast is best effort: if Realtime
-- is unavailable the fix is still stored and the map's slower refresh picks it up. Raw rows stay unreadable to clients.

create or replace function broadcast_vessel_position() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  if new.lat is null or new.lng is null then return new; end if;
  begin
    perform realtime.send(jsonb_build_object('vessel_id', new.vessel_id, 'lat', new.lat, 'lng', new.lng, 'heading', new.heading,
        'speed_kn', new.speed_kn, 'accuracy_m', new.accuracy_m, 'source', new.source, 'at', coalesce(new.observed_at, new.received_at)),
      'position', 'vessel-pos:' || new.company_id::text, true);
  exception when others then null;
  end;
  return new;
end $$;
revoke execute on function broadcast_vessel_position() from anon, public, authenticated;

drop trigger if exists vpos_broadcast on vessel_positions;
create trigger vpos_broadcast after insert on vessel_positions for each row execute function broadcast_vessel_position();

do $$ begin
  if to_regclass('realtime.messages') is not null then
    drop policy if exists vessel_pos_listen on realtime.messages;
    create policy vessel_pos_listen on realtime.messages for select to authenticated
      using (realtime.messages.extension = 'broadcast' and realtime.topic() like 'vessel-pos:%'
             and is_company_ops((substring(realtime.topic() from 12))::uuid));
  end if;
end $$;
