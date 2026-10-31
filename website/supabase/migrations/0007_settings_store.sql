-- Per-item settings are stored in companies.settings (jsonb) via an RPC that audits every change.
create table company_audit (
  id         bigint generated always as identity primary key,
  company_id uuid not null references companies(id) on delete cascade,
  actor      uuid references auth.users(id) on delete set null,
  action     text not null,
  detail     text,
  created_at timestamptz not null default now()
);
create index on company_audit (company_id, created_at desc);
alter table company_audit enable row level security;
create policy company_audit_read on company_audit for select to authenticated using (is_company_admin(company_id));

create function set_company_setting(p_company uuid, p_key text, p_value jsonb) returns void
  language plpgsql security definer set search_path = public as
$$ begin
  if not is_company_admin(p_company) then raise exception 'Only owners and admins can change settings.'; end if;
  if p_key !~ '^[a-z0-9_]{1,60}$' then raise exception 'Invalid setting key.'; end if;
  if pg_column_size(p_value) > 100000 then raise exception 'Setting is too large.'; end if;
  update companies set settings = jsonb_set(coalesce(settings, '{}'::jsonb), array[p_key], p_value, true) where id = p_company;
  insert into company_audit (company_id, actor, action, detail) values (p_company, auth.uid(), 'setting_changed', p_key);
end $$;

-- Platform-level settings.
alter table platform_settings add column config jsonb not null default '{}'::jsonb;
create function platform_set_config(p_key text, p_value jsonb) returns void
  language plpgsql security definer set search_path = public as
$$ begin
  if not is_platform_admin() then raise exception 'Not allowed.'; end if;
  if p_key !~ '^[a-z0-9_]{1,60}$' then raise exception 'Invalid setting key.'; end if;
  if pg_column_size(p_value) > 100000 then raise exception 'Setting is too large.'; end if;
  update platform_settings set config = jsonb_set(coalesce(config, '{}'::jsonb), array[p_key], p_value, true);
  insert into platform_audit (actor, action, detail) values (auth.uid(), 'setting_changed', p_key);
end $$;
revoke execute on function set_company_setting(uuid, text, jsonb), platform_set_config(text, jsonb) from anon;
