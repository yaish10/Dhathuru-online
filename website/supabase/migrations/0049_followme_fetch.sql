-- FollowMe live position proxy for Operations Tracking + dashboard map (requested by Cursor, revised by Claude 22 Oct 2026).
-- FollowMe.mv sends no CORS headers, so the browser cannot fetch it; the database fetches it instead.
--
--  * The FollowMe link (it contains the account key) is kept out of sight: when Fleet / Maintenance saves
--    vessels.meta.followme_url (or meta.followme), a trigger moves it into followme_links (no one can read that table)
--    and leaves only meta.followme_set = true and meta.followme_hint (e.g. "m.followme.mv · ••••a1b2").
--    To change or remove a link, save meta.followme_url again ('' removes it).
--  * followme_fetch(p_vessel) → { body, status, cached, stale, at, next_in, hint, attribution } or { error }.
--      - FollowMe allows one call per minute per account: at most ONE outside call per company per minute.
--        Vessels that share the same link share one cached answer.
--      - Answers are cached 60 s; if the minute's call is used up, or FollowMe fails / times out / answers with an
--        error, the last good answer is returned with stale = true (and `warning`).
--      - 6 s timeout, answers over 512 KB are refused.
--      - Only https://*.followme.mv/… links; only members of the vessel's company may call it.
--  * Terms reminder: FollowMe requires its logo/attribution wherever positions are shown, and written permission
--    for use inside a paid service (VEYORA has paid plans).

create extension if not exists http with schema extensions;

-- 1. Hidden links
create table if not exists followme_links (
  vessel_id  uuid primary key references vessels(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  url        text not null check (char_length(url) between 12 and 500),
  updated_at timestamptz not null default now()
);
alter table followme_links enable row level security;
revoke all on followme_links from anon, authenticated, public;   -- no policies: only security definer code reads it

-- Safe label for the UI: host + last 4 characters only, e.g. "m.followme.mv · ••••a1b2".
create or replace function followme_hint(p_url text) returns text language sql immutable as
$$ select regexp_replace(p_url, '^https?://([^/]+).*$', '\1') || ' · ••••' || right(regexp_replace(p_url, '/+$', ''), 4) $$;

create or replace function vessels_followme_hide() returns trigger
  language plpgsql security definer set search_path = public as
$$ declare u text;
begin
  if not (new.meta ? 'followme_url' or new.meta ? 'followme') then return new; end if;
  u := nullif(btrim(coalesce(new.meta->>'followme_url', new.meta->>'followme', '')), '');
  new.meta := new.meta - 'followme_url' - 'followme';
  if u is null then
    delete from followme_links where vessel_id = new.id;
    new.meta := new.meta - 'followme_set' - 'followme_hint';
    return new;
  end if;
  if u !~* '^https://([a-z0-9-]+\.)*followme\.mv(/[^\s]*)?$' then
    raise exception 'The FollowMe link must start with https://followme.mv/ (or a followme.mv sub-site).';
  end if;
  insert into followme_links (vessel_id, company_id, url, updated_at) values (new.id, new.company_id, u, now())
  on conflict (vessel_id) do update set url = excluded.url, company_id = excluded.company_id, updated_at = now();
  new.meta := new.meta || jsonb_build_object('followme_set', true, 'followme_hint', followme_hint(u));
  return new;
end $$;
-- BEFORE INSERT can't reference new.id in followme_links until the row exists, so inserts are handled AFTER.
drop trigger if exists ves_followme_hide on vessels;
create trigger ves_followme_hide before update on vessels for each row execute function vessels_followme_hide();

create or replace function vessels_followme_after_insert() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  if new.meta ? 'followme_url' or new.meta ? 'followme' then
    update vessels set meta = meta where id = new.id;   -- runs the BEFORE UPDATE trigger above
  end if;
  return null;
end $$;
drop trigger if exists ves_followme_after_insert on vessels;
create trigger ves_followme_after_insert after insert on vessels for each row execute function vessels_followme_after_insert();

-- 2. Cache (one row per company + link) and the per-company minute
create table if not exists followme_cache (
  company_id   uuid not null references companies(id) on delete cascade,
  url          text not null,
  status       integer,
  body         text,               -- last good answer only
  fetched_at   timestamptz,        -- time of the last good answer
  tried_at     timestamptz,        -- time of the last outside call (good or not)
  last_error   text,
  primary key (company_id, url)
);
alter table followme_cache enable row level security;
revoke all on followme_cache from anon, authenticated, public;

create table if not exists followme_calls (
  company_id   uuid primary key references companies(id) on delete cascade,
  last_call_at timestamptz not null
);
alter table followme_calls enable row level security;
revoke all on followme_calls from anon, authenticated, public;

-- 3. The proxy
drop function if exists followme_fetch(uuid);
create or replace function followme_fetch(p_vessel uuid) returns jsonb
  language plpgsql security definer set search_path = public, extensions as
$$ declare
  v vessels; u text; c followme_cache; last_call timestamptz; code int; txt text; err text; res jsonb;
  attr constant text := 'FollowMe Tracking Service';
begin
  if p_vessel is null then return jsonb_build_object('error', 'Choose a vessel.'); end if;
  select * into v from vessels where id = p_vessel;
  if not found then return jsonb_build_object('error', 'Vessel not found.'); end if;
  if not is_company_member(v.company_id) then raise exception 'Not a member of this company.'; end if;

  select url into u from followme_links where vessel_id = p_vessel;
  if u is null then
    return jsonb_build_object('error', 'No FollowMe link on this vessel. Add it under Fleet / Maintenance → Edit.');
  end if;

  -- One caller at a time per company, so two people refreshing together still make only one outside call.
  perform pg_advisory_xact_lock(hashtext('followme:' || v.company_id::text));

  select * into c from followme_cache where company_id = v.company_id and url = u;
  if found and c.body is not null and c.fetched_at > now() - interval '60 seconds' then
    return jsonb_build_object('status', c.status, 'body', c.body, 'cached', true, 'stale', false, 'at', c.fetched_at,
                              'hint', followme_hint(u), 'attribution', attr);
  end if;

  select last_call_at into last_call from followme_calls where company_id = v.company_id;
  if last_call is not null and last_call > now() - interval '60 seconds' then
    -- The company's call for this minute is used up: hand back the last good answer if there is one.
    res := jsonb_build_object('next_in', ceil(extract(epoch from (last_call + interval '60 seconds' - now())))::int,
                              'hint', followme_hint(u), 'attribution', attr);
    if c.body is not null then
      return res || jsonb_build_object('status', c.status, 'body', c.body, 'cached', true, 'stale', true, 'at', c.fetched_at,
                                       'warning', 'FollowMe allows one update a minute; showing the last position.');
    end if;
    return res || jsonb_build_object('error', 'FollowMe allows one update a minute. Try again in a moment.');
  end if;

  insert into followme_calls (company_id, last_call_at) values (v.company_id, now())
  on conflict (company_id) do update set last_call_at = excluded.last_call_at;

  begin
    begin
      perform http_set_curlopt('CURLOPT_TIMEOUT', '6');
      perform http_set_curlopt('CURLOPT_CONNECTTIMEOUT', '4');
    exception when others then null;   -- older http extension: keep its default timeout
    end;
    select status, content into code, txt from http_get(u);
    if code is null or code < 200 or code >= 300 then
      err := 'FollowMe answered with status ' || coalesce(code::text, 'none') || '.';
    elsif txt is null then
      err := 'FollowMe sent an empty answer.';
    elsif octet_length(txt) > 524288 then
      err := 'FollowMe sent too much data (over 512 KB).';
    end if;
  exception when others then
    err := 'Could not reach FollowMe (' || left(sqlerrm, 120) || ').';
  end;

  if err is null then
    insert into followme_cache (company_id, url, status, body, fetched_at, tried_at, last_error)
    values (v.company_id, u, code, txt, now(), now(), null)
    on conflict (company_id, url) do update set status = excluded.status, body = excluded.body, fetched_at = excluded.fetched_at,
                                                tried_at = excluded.tried_at, last_error = null;
    return jsonb_build_object('status', code, 'body', txt, 'cached', false, 'stale', false, 'at', now(),
                              'hint', followme_hint(u), 'attribution', attr);
  end if;

  insert into followme_cache (company_id, url, tried_at, last_error) values (v.company_id, u, now(), err)
  on conflict (company_id, url) do update set tried_at = excluded.tried_at, last_error = excluded.last_error;
  if c.body is not null then
    return jsonb_build_object('status', c.status, 'body', c.body, 'cached', true, 'stale', true, 'at', c.fetched_at,
                              'warning', err || ' Showing the last position.', 'hint', followme_hint(u), 'attribution', attr);
  end if;
  return jsonb_build_object('error', err, 'hint', followme_hint(u), 'attribution', attr);
end $$;
revoke all on function followme_fetch(uuid) from anon, public;
grant execute on function followme_fetch(uuid) to authenticated;
comment on function followme_fetch(uuid) is
  'Server-side GET of the vessel''s hidden FollowMe link: one outside call per company per minute, 60 s cache, stale fallback. Returns {body,status,cached,stale,at,next_in,hint,attribution} or {error}.';

-- 4. Move links already saved in vessels.meta into the hidden table.
do $$ declare r record; begin
  perform set_config('veyora.subscription_write', 'on', true);
  for r in select id from vessels where meta ? 'followme_url' or meta ? 'followme' loop
    update vessels set meta = meta where id = r.id;
  end loop;
end $$;
