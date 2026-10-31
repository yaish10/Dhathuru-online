-- Hardening for 0010. Apply after 0010.

-- 0. Bug fix in 0010: reject_if_subscription_expired() read new.company_id and new.id in one expression,
--    which errors on any table missing one of them (companies has no company_id, company_members has no id).
--    That made every update or delete on those tables fail for normal admins. Read the key through jsonb instead.
create or replace function reject_if_subscription_expired() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare cid uuid;
begin
  if current_setting('veyora.subscription_write', true) = 'on' then return coalesce(new, old); end if;
  if is_platform_admin() then return coalesce(new, old); end if;
  if tg_op = 'INSERT' and tg_table_name in ('companies', 'company_members') then return new; end if;
  if tg_table_name = 'companies' then
    cid := coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id')::uuid;
  else
    cid := coalesce(to_jsonb(new) ->> 'company_id', to_jsonb(old) ->> 'company_id')::uuid;
  end if;
  if not subscription_open(cid) then raise exception 'Subscription expired. Renew to continue.'; end if;
  return coalesce(new, old);
end $$;

-- 1. Subscription fields can only be changed by the platform owner or by the subscription functions.
--    Without this, a company admin could set period_end or lifetime_unlocked_at on their own company row.
create function companies_guard_subscription() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  if is_platform_admin() or current_setting('veyora.subscription_write', true) = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.trial_days := null;
    new.trial_started_at := now();
    new.period_end := null;
    new.lifetime_unlocked_at := null;
    new.plan_id := null;
  elsif (new.trial_days, new.trial_started_at, new.period_end, new.lifetime_unlocked_at, new.plan_id)
        is distinct from (old.trial_days, old.trial_started_at, old.period_end, old.lifetime_unlocked_at, old.plan_id) then
    raise exception 'Subscription details can only be changed by the platform owner.';
  end if;
  return new;
end $$;
create trigger companies_guard_subscription before insert or update on companies
  for each row execute function companies_guard_subscription();

-- 2. The shipped default lifetime code is guessable. Replace it with a random one.
--    The platform owner reads or changes it under Platform owner > Subscriptions.
update platform_settings
  set lifetime_code = 'VY-' || upper(encode(gen_random_bytes(8), 'hex'))
  where lifetime_code = 'VEYORA-LIFETIME';

-- 3. Limit guessing: 5 wrong codes in 15 minutes locks redeeming for that company.
--    A wrong code returns {error} instead of raising, so the failed attempt is still recorded.
create or replace function redeem_code(p_company uuid, p_code text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare code text; tries integer;
begin
  if not is_company_admin(p_company) then raise exception 'Only owners and admins can redeem a code.'; end if;
  select count(*) into tries from company_audit
    where company_id = p_company and action = 'redeem_failed' and created_at > now() - interval '15 minutes';
  if tries >= 5 then
    return jsonb_build_object('error', 'Too many attempts. Try again in 15 minutes.');
  end if;
  select upper(btrim(lifetime_code)) into code from platform_settings;
  if code is null or upper(btrim(coalesce(p_code, ''))) <> code then
    insert into company_audit (company_id, actor, action, detail)
      values (p_company, auth.uid(), 'redeem_failed', 'Wrong lifetime code');
    return jsonb_build_object('error', 'That code is not valid.');
  end if;
  perform set_config('veyora.subscription_write', 'on', true);
  update companies set lifetime_unlocked_at = coalesce(lifetime_unlocked_at, now()),
    plan_id = case when exists (select 1 from subscription_plans where id = 'lifetime') then 'lifetime' else plan_id end
    where id = p_company;
  insert into company_audit (company_id, actor, action, detail)
    values (p_company, auth.uid(), 'subscription_lifetime', 'Lifetime code redeemed');
  return company_subscription(p_company);
end $$;
revoke execute on function redeem_code(uuid, text) from anon, public;
grant execute on function redeem_code(uuid, text) to authenticated;

-- 4. subscription_open and the trigger function are internal.
revoke execute on function subscription_open(uuid) from anon, public;
revoke execute on function reject_if_subscription_expired() from anon, public;
revoke execute on function companies_guard_subscription() from anon, public;
