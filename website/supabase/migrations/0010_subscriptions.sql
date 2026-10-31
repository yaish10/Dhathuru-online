-- Subscriptions: prices, trials and the lifetime code live in the database.
-- A company works during its trial, a paid period, or after a lifetime unlock.
-- When none of those are current, writes are rejected and the app shows the renew overlay.

alter table platform_settings
  add column trial_days integer not null default 14 check (trial_days between 0 and 3650),
  add column currency text not null default 'MVR' check (currency ~ '^[A-Z]{3}$'),
  add column lifetime_code text not null default 'VEYORA-LIFETIME' check (char_length(btrim(lifetime_code)) between 6 and 64);

create table subscription_plans (
  id             text primary key check (id ~ '^[a-z0-9_]{1,32}$'),
  name           text not null check (char_length(name) between 2 and 60),
  amount         numeric(12,2) not null check (amount >= 0),
  interval_unit  text not null check (interval_unit in ('month', 'year', 'lifetime')),
  interval_count integer not null default 1 check (interval_count between 1 and 36),
  sort           integer not null default 0,
  active         boolean not null default true
);
insert into subscription_plans (id, name, amount, interval_unit, interval_count, sort) values
  ('monthly', 'Monthly', 1500, 'month', 1, 1),
  ('yearly', 'Yearly', 15000, 'year', 1, 2),
  ('lifetime', 'Lifetime', 45000, 'lifetime', 1, 3);
alter table subscription_plans enable row level security;
create policy subscription_plans_read on subscription_plans for select to authenticated using (true);

alter table companies
  add column trial_days integer check (trial_days is null or trial_days between 0 and 3650),
  add column trial_started_at timestamptz not null default now(),
  add column period_end timestamptz,
  add column lifetime_unlocked_at timestamptz,
  add column plan_id text references subscription_plans(id);

create table subscription_requests (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  plan_id    text not null references subscription_plans(id),
  amount     numeric(12,2) not null,
  currency   text not null,
  status     text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index on subscription_requests (company_id, status);
alter table subscription_requests enable row level security;

create function subscription_open(p_company uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select exists (
  select 1 from companies c cross join platform_settings ps
  where c.id = p_company and (
    c.lifetime_unlocked_at is not null
    or (c.period_end is not null and c.period_end > now())
    or c.trial_started_at + make_interval(days => coalesce(c.trial_days, ps.trial_days)) > now()
  )
) $$;

create function reject_if_subscription_expired() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare cid uuid;
begin
  if current_setting('veyora.subscription_write', true) = 'on' then return coalesce(new, old); end if;
  if is_platform_admin() then return coalesce(new, old); end if;
  if tg_op = 'INSERT' and tg_table_name = 'companies' then return new; end if;
  if tg_op = 'INSERT' and tg_table_name = 'company_members' then return new; end if;
  cid := case when tg_table_name = 'companies' then coalesce(new.id, old.id) else coalesce(new.company_id, old.company_id) end;
  if not subscription_open(cid) then raise exception 'Subscription expired. Renew to continue.'; end if;
  return coalesce(new, old);
end $$;

create trigger companies_subscription before insert or update or delete on companies
  for each row execute function reject_if_subscription_expired();
create trigger members_subscription before insert or update or delete on company_members
  for each row execute function reject_if_subscription_expired();
create trigger invites_subscription before insert or update or delete on company_invites
  for each row execute function reject_if_subscription_expired();
create trigger departments_subscription before insert or update or delete on departments
  for each row execute function reject_if_subscription_expired();
create trigger titles_subscription before insert or update or delete on job_titles
  for each row execute function reject_if_subscription_expired();

create function company_subscription(p_company uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare c companies; ps platform_settings; tend timestamptz; st text; plans jsonb; pname text;
begin
  if not (is_company_member(p_company) or is_platform_admin()) then raise exception 'Not allowed.'; end if;
  select * into c from companies where id = p_company;
  if not found then raise exception 'Company not found.'; end if;
  select * into ps from platform_settings;
  tend := c.trial_started_at + make_interval(days => coalesce(c.trial_days, ps.trial_days));
  st := case
    when c.lifetime_unlocked_at is not null then 'lifetime'
    when c.period_end is not null and c.period_end > now() then 'active'
    when tend > now() then 'trial'
    else 'expired' end;
  select name into pname from subscription_plans where id = c.plan_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.name, 'amount', p.amount,
    'interval_unit', p.interval_unit, 'interval_count', p.interval_count
  ) order by p.sort), '[]'::jsonb) into plans
  from subscription_plans p where p.active;
  return jsonb_build_object(
    'status', st, 'locked', st = 'expired', 'currency', ps.currency,
    'trial_days', coalesce(c.trial_days, ps.trial_days),
    'trial_override', c.trial_days, 'overall_trial_days', ps.trial_days,
    'trial_ends_at', tend, 'period_end', c.period_end,
    'plan_id', c.plan_id, 'plan_name', pname, 'plans', plans
  );
end $$;

create function redeem_code(p_company uuid, p_code text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare code text;
begin
  if not is_company_admin(p_company) then raise exception 'Only owners and admins can redeem a code.'; end if;
  select upper(btrim(lifetime_code)) into code from platform_settings;
  if code is null or upper(btrim(coalesce(p_code, ''))) <> code then raise exception 'That code is not valid.'; end if;
  perform set_config('veyora.subscription_write', 'on', true);
  update companies set lifetime_unlocked_at = coalesce(lifetime_unlocked_at, now()),
    plan_id = case when exists (select 1 from subscription_plans where id = 'lifetime') then 'lifetime' else plan_id end
    where id = p_company;
  insert into company_audit (company_id, actor, action, detail)
    values (p_company, auth.uid(), 'subscription_lifetime', 'Lifetime code redeemed');
  return company_subscription(p_company);
end $$;

create function request_renewal(p_company uuid, p_plan text) returns void
  language plpgsql security definer set search_path = public as
$$
declare pl subscription_plans; cur text;
begin
  if not is_company_admin(p_company) then raise exception 'Only owners and admins can request a renewal.'; end if;
  select * into pl from subscription_plans where id = p_plan and active;
  if not found then raise exception 'That plan is not available.'; end if;
  if exists (select 1 from subscription_requests where company_id = p_company and plan_id = p_plan and status = 'open') then
    raise exception 'A renewal for this plan is already waiting.';
  end if;
  select currency into cur from platform_settings;
  insert into subscription_requests (company_id, plan_id, amount, currency)
    values (p_company, pl.id, pl.amount, cur);
  insert into company_audit (company_id, actor, action, detail)
    values (p_company, auth.uid(), 'renewal_requested', pl.name);
end $$;

create function apply_plan(p_company uuid, p_plan text) returns void
  language plpgsql security definer set search_path = public as
$$
declare pl subscription_plans;
begin
  select * into pl from subscription_plans where id = p_plan and active;
  if not found then raise exception 'That plan is not available.'; end if;
  perform set_config('veyora.subscription_write', 'on', true);
  if pl.interval_unit = 'lifetime' then
    update companies set lifetime_unlocked_at = coalesce(lifetime_unlocked_at, now()), plan_id = pl.id where id = p_company;
  else
    update companies set plan_id = pl.id, period_end = now() + make_interval(
      months => case when pl.interval_unit = 'month' then pl.interval_count else 0 end,
      years => case when pl.interval_unit = 'year' then pl.interval_count else 0 end
    ) where id = p_company;
  end if;
end $$;

create function platform_billing() returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare ps platform_settings; plans jsonb;
begin
  if not is_platform_admin() then raise exception 'Not allowed.'; end if;
  select * into ps from platform_settings;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.name, 'amount', p.amount,
    'interval_unit', p.interval_unit, 'interval_count', p.interval_count, 'active', p.active
  ) order by p.sort), '[]'::jsonb) into plans from subscription_plans p;
  return jsonb_build_object(
    'trial_days', ps.trial_days, 'currency', ps.currency, 'lifetime_code', ps.lifetime_code, 'plans', plans
  );
end $$;

create function platform_company_subs()
  returns table (id uuid, sub_status text, trial_override integer, trial_ends_at timestamptz, period_end timestamptz, plan_id text)
  language sql stable security definer set search_path = public as
$$ select c.id,
  case
    when c.lifetime_unlocked_at is not null then 'lifetime'
    when c.period_end is not null and c.period_end > now() then 'active'
    when c.trial_started_at + make_interval(days => coalesce(c.trial_days, ps.trial_days)) > now() then 'trial'
    else 'expired' end,
  c.trial_days,
  c.trial_started_at + make_interval(days => coalesce(c.trial_days, ps.trial_days)),
  c.period_end,
  c.plan_id
from companies c cross join platform_settings ps
where is_platform_admin() $$;

create function platform_renewals()
  returns table (id uuid, company_id uuid, company_name text, plan_id text, plan_name text, amount numeric, currency text, created_at timestamptz)
  language sql stable security definer set search_path = public as
$$ select r.id, r.company_id, c.name, r.plan_id, p.name, r.amount, r.currency, r.created_at
   from subscription_requests r
   join companies c on c.id = r.company_id
   join subscription_plans p on p.id = r.plan_id
   where r.status = 'open' and is_platform_admin()
   order by r.created_at $$;

create function platform_set_billing(p_trial_days integer, p_currency text, p_lifetime_code text) returns void
  language plpgsql security definer set search_path = public as
$$ begin
  if not is_platform_admin() then raise exception 'Not allowed.'; end if;
  if p_trial_days is null or p_trial_days < 0 or p_trial_days > 3650 then raise exception 'Trial length must be from 0 to 3650 days.'; end if;
  if p_currency !~ '^[A-Z]{3}$' then raise exception 'Currency must be a 3-letter code, such as MVR.'; end if;
  if char_length(btrim(coalesce(p_lifetime_code, ''))) < 6 or char_length(btrim(p_lifetime_code)) > 64 then
    raise exception 'The lifetime code must be 6 to 64 characters.';
  end if;
  update platform_settings set trial_days = p_trial_days, currency = upper(p_currency), lifetime_code = btrim(p_lifetime_code);
  insert into platform_audit (actor, action, detail) values (auth.uid(), 'subscription_settings', 'Trial ' || p_trial_days || ' days');
end $$;

create function platform_save_plan(p_id text, p_name text, p_amount numeric, p_interval text, p_count integer, p_active boolean) returns void
  language plpgsql security definer set search_path = public as
$$ begin
  if not is_platform_admin() then raise exception 'Not allowed.'; end if;
  if p_id !~ '^[a-z0-9_]{1,32}$' then raise exception 'Plan id must use lowercase letters, numbers and underscores.'; end if;
  if p_name is null or char_length(btrim(p_name)) < 2 then raise exception 'Enter the plan name.'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Amount must be zero or more.'; end if;
  if p_interval not in ('month', 'year', 'lifetime') then raise exception 'Interval must be month, year or lifetime.'; end if;
  if p_count is null or p_count < 1 or p_count > 36 then raise exception 'Interval count must be from 1 to 36.'; end if;
  insert into subscription_plans (id, name, amount, interval_unit, interval_count, active)
    values (p_id, btrim(p_name), p_amount, p_interval, p_count, coalesce(p_active, true))
  on conflict (id) do update set name = excluded.name, amount = excluded.amount,
    interval_unit = excluded.interval_unit, interval_count = excluded.interval_count, active = excluded.active;
  insert into platform_audit (actor, action, detail) values (auth.uid(), 'subscription_plan', p_id);
end $$;

create function platform_set_company_trial(p_company uuid, p_days integer) returns void
  language plpgsql security definer set search_path = public as
$$ begin
  if not is_platform_admin() then raise exception 'Not allowed.'; end if;
  if p_days is not null and (p_days < 0 or p_days > 3650) then raise exception 'Trial length must be from 0 to 3650 days.'; end if;
  perform set_config('veyora.subscription_write', 'on', true);
  update companies set trial_days = p_days where id = p_company;
  if not found then raise exception 'Company not found.'; end if;
  insert into platform_audit (actor, action, company_id, detail)
    values (auth.uid(), 'company_trial', p_company, case when p_days is null then 'overall' else p_days::text || ' days' end);
end $$;

create function platform_resolve_renewal(p_request uuid, p_grant boolean) returns void
  language plpgsql security definer set search_path = public as
$$
declare req subscription_requests;
begin
  if not is_platform_admin() then raise exception 'Not allowed.'; end if;
  select * into req from subscription_requests where id = p_request and status = 'open';
  if not found then raise exception 'That renewal request is no longer open.'; end if;
  if p_grant then perform apply_plan(req.company_id, req.plan_id); end if;
  update subscription_requests set status = case when p_grant then 'done' else 'cancelled' end where id = req.id;
  insert into platform_audit (actor, action, company_id, detail)
    values (auth.uid(), case when p_grant then 'renewal_granted' else 'renewal_cancelled' end, req.company_id, req.plan_id);
end $$;

revoke all on function apply_plan(uuid, text) from public, anon, authenticated;
revoke execute on function company_subscription(uuid), redeem_code(uuid, text), request_renewal(uuid, text),
  platform_billing(), platform_company_subs(), platform_renewals(),
  platform_set_billing(integer, text, text), platform_save_plan(text, text, numeric, text, integer, boolean),
  platform_set_company_trial(uuid, integer), platform_resolve_renewal(uuid, boolean), apply_plan(uuid, text)
  from anon, public;
grant execute on function company_subscription(uuid), redeem_code(uuid, text), request_renewal(uuid, text) to authenticated;
grant execute on function platform_billing(), platform_company_subs(), platform_renewals(),
  platform_set_billing(integer, text, text), platform_save_plan(text, text, numeric, text, integer, boolean),
  platform_set_company_trial(uuid, integer), platform_resolve_renewal(uuid, boolean) to authenticated;
