-- Agreements: templates designed in VEYORA or uploaded from Word (.docx), agreements made from them,
-- and their files (PDF saved automatically, Word copy, signed scan) in a private storage bucket.
-- Owners, admins and HR manage everything. A staff member can see agreements made out to them once sent.
-- Settings live under category 16 (Agreements & Documents), keys starting with 16_.

-- 1. Templates
create table agreement_templates (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  name        text not null check (char_length(name) between 2 and 120),
  category    text not null default 'General' check (char_length(category) between 1 and 60),
  party_type  text not null default 'Staff' check (party_type in ('Staff', 'Client', 'Vendor', 'Other')),
  body_html   text check (body_html is null or char_length(body_html) <= 300000),
  docx_path   text check (docx_path is null or char_length(docx_path) <= 300),
  active      boolean not null default true,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (body_html is not null or docx_path is not null)
);
create index on agreement_templates (company_id);
alter table agreement_templates enable row level security;
create policy agt_select on agreement_templates for select to authenticated using (is_company_hr(company_id));
create policy agt_insert on agreement_templates for insert to authenticated with check (is_company_hr(company_id));
create policy agt_update on agreement_templates for update to authenticated using (is_company_hr(company_id)) with check (is_company_hr(company_id));
create policy agt_delete on agreement_templates for delete to authenticated using (is_company_hr(company_id));
create trigger agt_subscription before insert or update or delete on agreement_templates
  for each row execute function reject_if_subscription_expired();

-- 2. Agreements
create table agreements (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  number        text,
  template_id   uuid references agreement_templates(id) on delete set null,
  title         text not null check (char_length(title) between 2 and 160),
  category      text not null default 'General' check (char_length(category) between 1 and 60),
  party_type    text not null default 'Staff' check (party_type in ('Staff', 'Client', 'Vendor', 'Other')),
  staff_user_id uuid,
  party_name    text check (party_name is null or char_length(party_name) <= 160),
  party_email   text check (party_email is null or char_length(party_email) <= 200),
  field_values  jsonb not null default '{}'::jsonb check (pg_column_size(field_values) <= 50000),
  body_html     text check (body_html is null or char_length(body_html) <= 400000),
  status        text not null default 'Draft' check (status in ('Draft', 'Sent', 'Signed', 'Cancelled')),
  start_date    date,
  end_date      date check (end_date is null or start_date is null or end_date >= start_date),
  pdf_path      text,
  docx_path     text,
  signed_path   text,
  signed_at     timestamptz,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (company_id, staff_user_id) references company_members (company_id, user_id) on delete set null (staff_user_id),
  unique (company_id, number)
);
create index on agreements (company_id, status);
create index on agreements (staff_user_id);
alter table agreements enable row level security;
create policy agr_select on agreements for select to authenticated
  using (is_company_hr(company_id) or (staff_user_id = auth.uid() and status in ('Sent', 'Signed')));
create policy agr_insert on agreements for insert to authenticated with check (is_company_hr(company_id));
create policy agr_update on agreements for update to authenticated using (is_company_hr(company_id)) with check (is_company_hr(company_id));
create policy agr_delete on agreements for delete to authenticated using (is_company_hr(company_id) and status in ('Draft', 'Cancelled'));
create trigger agr_subscription before insert or update or delete on agreements
  for each row execute function reject_if_subscription_expired();

-- Number (e.g. AGR-2026-0001, from setting 16_agreement_numbering), timestamps and signed date.
create function agreements_before_write() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare cfg jsonb; pre text; sep text; yr boolean; digits int; n int; stem text;
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    select coalesce(settings->'16_agreement_numbering', '{}'::jsonb) into cfg from companies where id = new.company_id;
    pre := coalesce(nullif(regexp_replace(cfg->>'prefix', '[^A-Za-z0-9]', '', 'g'), ''), 'AGR');
    sep := case cfg->>'sep' when 'none' then '' when '/' then '/' else '-' end;
    yr := coalesce((cfg->>'year')::boolean, true);
    digits := least(greatest(coalesce((cfg->>'digits')::int, 4), 3), 8);
    stem := pre || sep || case when yr then to_char(now(), 'YYYY') || sep else '' end;
    perform pg_advisory_xact_lock(hashtext('agreements:' || new.company_id));
    select count(*) + 1 into n from agreements where company_id = new.company_id and number like stem || '%';
    new.number := stem || lpad(n::text, digits, '0');
  else
    new.number := old.number; new.company_id := old.company_id; new.created_by := old.created_by; new.created_at := old.created_at;
  end if;
  if new.status = 'Signed' and (tg_op = 'INSERT' or old.status <> 'Signed') then new.signed_at := coalesce(new.signed_at, now()); end if;
  if new.status <> 'Signed' then new.signed_at := null; end if;
  return new;
end $$;
create trigger agreements_before_write before insert or update on agreements
  for each row execute function agreements_before_write();

create function agreement_templates_touch() returns trigger language plpgsql as
$$ begin new.updated_at := now(); if tg_op = 'INSERT' then new.created_by := auth.uid(); end if; return new; end $$;
create trigger agreement_templates_touch before insert or update on agreement_templates
  for each row execute function agreement_templates_touch();

-- 3. Files: private bucket, paths <company_id>/templates/... and <company_id>/<agreement_id>/...
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('agreements', 'agreements', false, 20971520, array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png', 'image/jpeg'])
on conflict (id) do nothing;

create function agreement_file_company(p_name text) returns uuid
  language sql immutable as
  $$ select case when split_part(p_name, '/', 1) ~ '^[0-9a-f-]{36}$' then split_part(p_name, '/', 1)::uuid end $$;

create policy agreements_files_read on storage.objects for select to authenticated
  using (bucket_id = 'agreements' and (
    is_company_hr(agreement_file_company(name))
    or exists (select 1 from agreements a
               where a.company_id = agreement_file_company(name) and a.staff_user_id = auth.uid()
                 and a.status in ('Sent', 'Signed') and name in (a.pdf_path, a.signed_path))));
create policy agreements_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'agreements' and is_company_hr(agreement_file_company(name)));
create policy agreements_files_update on storage.objects for update to authenticated
  using (bucket_id = 'agreements' and is_company_hr(agreement_file_company(name)));
create policy agreements_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'agreements' and is_company_hr(agreement_file_company(name)));

-- 4. HR may also change Agreements & Documents settings (16_...), as well as HR & Crew settings (8_...).
create or replace function set_company_setting(p_company uuid, p_key text, p_value jsonb) returns void
  language plpgsql security definer set search_path = public as
$$ begin
  if not (is_company_admin(p_company) or ((p_key like '8\_%' or p_key like '16\_%') and is_company_hr(p_company))) then
    raise exception 'Only owners and admins can change settings.';
  end if;
  if p_key !~ '^[a-z0-9_]{1,60}$' then raise exception 'Invalid setting key.'; end if;
  if pg_column_size(p_value) > 100000 then raise exception 'Setting is too large.'; end if;
  update companies set settings = jsonb_set(coalesce(settings, '{}'::jsonb), array[p_key], p_value, true) where id = p_company;
  insert into company_audit (company_id, actor, action, detail) values (p_company, auth.uid(), 'setting_changed', p_key);
end $$;

-- 5. Audit trail for agreements (shows on the Dashboard activity list).
create function agreements_audit() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  if tg_op = 'INSERT' then
    insert into company_audit (company_id, actor, action, detail) values (new.company_id, auth.uid(), 'agreement_created', new.number || ' ' || new.title);
  elsif tg_op = 'UPDATE' and new.status <> old.status then
    insert into company_audit (company_id, actor, action, detail) values (new.company_id, auth.uid(), 'agreement_' || lower(new.status), new.number || ' ' || new.title);
  elsif tg_op = 'DELETE' and exists (select 1 from companies where id = old.company_id) then  -- skip when the whole company is being deleted
    insert into company_audit (company_id, actor, action, detail) values (old.company_id, auth.uid(), 'agreement_deleted', old.number || ' ' || old.title);
  end if;
  return coalesce(new, old);
end $$;
create trigger agreements_audit after insert or update or delete on agreements
  for each row execute function agreements_audit();
