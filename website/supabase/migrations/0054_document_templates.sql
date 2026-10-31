-- PDF Layout Maker: company-scoped document templates with immutable published versions.
-- Cursor 2026-10-24: schema for finance/HR/agreement PDF layouts. Claude: apply on live veyora.
-- PDF bytes are generated client-side (html2pdf, same as agreements) until a Chromium Edge Function exists.

create table if not exists document_templates (
  id                          uuid primary key default gen_random_uuid(),
  company_id                  uuid not null references companies(id) on delete cascade,
  name                        text not null check (char_length(btrim(name)) between 1 and 120),
  document_type               text not null check (document_type in (
                                'invoice', 'receipt', 'payslip', 'financial_report',
                                'employee_report', 'agreement')),
  description                 text check (description is null or char_length(description) <= 500),
  status                      text not null default 'Draft' check (status in ('Draft', 'Published', 'Archived')),
  is_default                  boolean not null default false,
  current_published_version_id uuid,
  created_by                  uuid references auth.users(id) on delete set null,
  updated_by                  uuid references auth.users(id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  archived_at                 timestamptz
);
create index if not exists document_templates_company_idx on document_templates (company_id, document_type, status);

create table if not exists document_template_versions (
  id              uuid primary key default gen_random_uuid(),
  template_id     uuid not null references document_templates(id) on delete cascade,
  company_id      uuid not null references companies(id) on delete cascade,
  version_number  integer not null check (version_number >= 1),
  configuration   jsonb not null default '{}'::jsonb
                    check (jsonb_typeof(configuration) = 'object' and pg_column_size(configuration) <= 200000),
  schema_version  integer not null default 1,
  status          text not null default 'Draft' check (status in ('Draft', 'Published', 'Superseded')),
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  published_at    timestamptz,
  unique (template_id, version_number)
);
create index if not exists document_template_versions_tpl_idx on document_template_versions (template_id, version_number desc);

alter table document_templates
  drop constraint if exists document_templates_published_version_fk;
alter table document_templates
  add constraint document_templates_published_version_fk
  foreign key (current_published_version_id) references document_template_versions(id) on delete set null;

create table if not exists document_generation_records (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  document_type       text not null,
  source_record_id    uuid,
  template_id         uuid references document_templates(id) on delete set null,
  template_version_id uuid references document_template_versions(id) on delete set null,
  storage_path        text,
  generated_by        uuid references auth.users(id) on delete set null,
  generated_at        timestamptz not null default now(),
  meta                jsonb not null default '{}'::jsonb
);
create index if not exists document_generation_records_company_idx on document_generation_records (company_id, document_type, generated_at desc);

alter table document_templates enable row level security;
alter table document_template_versions enable row level security;
alter table document_generation_records enable row level security;

-- Finance admins manage invoice/receipt/financial_report; HR manage payslip/employee_report; both+admin for agreement.
create or replace function can_manage_pdf_templates(p_company uuid, p_type text default null) returns boolean
  language sql stable security definer set search_path = public as $$
  select is_company_admin(p_company)
      or (coalesce(p_type, '') in ('', 'invoice', 'receipt', 'financial_report') and is_company_finance(p_company))
      or (coalesce(p_type, '') in ('', 'payslip', 'employee_report') and is_company_hr(p_company))
      or (coalesce(p_type, '') in ('', 'agreement') and (is_company_hr(p_company) or is_company_finance(p_company)));
$$;
grant execute on function can_manage_pdf_templates(uuid, text) to authenticated;

create policy dt_select on document_templates for select to authenticated
  using (is_company_member(company_id));
create policy dt_insert on document_templates for insert to authenticated
  with check (can_manage_pdf_templates(company_id, document_type));
create policy dt_update on document_templates for update to authenticated
  using (can_manage_pdf_templates(company_id, document_type))
  with check (can_manage_pdf_templates(company_id, document_type));
create policy dt_delete on document_templates for delete to authenticated
  using (is_company_admin(company_id));

create policy dtv_select on document_template_versions for select to authenticated
  using (is_company_member(company_id));
create policy dtv_insert on document_template_versions for insert to authenticated
  with check (can_manage_pdf_templates(company_id, null));
create policy dtv_update on document_template_versions for update to authenticated
  using (can_manage_pdf_templates(company_id, null) and status = 'Draft')
  with check (can_manage_pdf_templates(company_id, null));

create policy dgr_select on document_generation_records for select to authenticated
  using (is_company_member(company_id));
create policy dgr_insert on document_generation_records for insert to authenticated
  with check (is_company_member(company_id));

-- Only one default published template per company + document type.
create or replace function document_templates_before() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if new.is_default and new.status = 'Published' then
    update document_templates
       set is_default = false, updated_at = now()
     where company_id = new.company_id
       and document_type = new.document_type
       and id is distinct from new.id
       and is_default;
  end if;
  if new.status = 'Archived' and new.archived_at is null then
    new.archived_at := now();
    new.is_default := false;
  end if;
  return new;
end $$;
drop trigger if exists document_templates_before on document_templates;
create trigger document_templates_before before insert or update on document_templates
  for each row execute function document_templates_before();

-- Publish: mark draft version published, supersede previous, point template.
create or replace function publish_document_template(p_template uuid, p_version uuid) returns document_templates
  language plpgsql security definer set search_path = public as $$
declare
  t document_templates;
  v document_template_versions;
begin
  select * into t from document_templates where id = p_template;
  if not found then raise exception 'Template not found.'; end if;
  if not can_manage_pdf_templates(t.company_id, t.document_type) then
    raise exception 'Not allowed to publish this template.';
  end if;
  select * into v from document_template_versions where id = p_version and template_id = p_template;
  if not found then raise exception 'Version not found.'; end if;
  if v.status = 'Published' then
    -- already published
    null;
  else
    update document_template_versions
       set status = 'Superseded'
     where template_id = p_template and status = 'Published' and id is distinct from p_version;
    update document_template_versions
       set status = 'Published', published_at = now()
     where id = p_version;
  end if;
  update document_templates
     set status = 'Published',
         current_published_version_id = p_version,
         updated_by = auth.uid(),
         updated_at = now()
   where id = p_template
  returning * into t;
  insert into company_audit (company_id, actor, action, detail)
  values (t.company_id, auth.uid(), 'pdf_template_published', t.name || ' v' || v.version_number);
  return t;
end $$;
revoke execute on function publish_document_template(uuid, uuid) from anon, public;
grant execute on function publish_document_template(uuid, uuid) to authenticated;

-- Ensure a draft version exists to edit (clone from published if needed).
create or replace function ensure_document_template_draft(p_template uuid) returns document_template_versions
  language plpgsql security definer set search_path = public as $$
declare
  t document_templates;
  d document_template_versions;
  src document_template_versions;
  n int;
begin
  select * into t from document_templates where id = p_template;
  if not found then raise exception 'Template not found.'; end if;
  if not can_manage_pdf_templates(t.company_id, t.document_type) then
    raise exception 'Not allowed to edit this template.';
  end if;
  select * into d from document_template_versions
   where template_id = p_template and status = 'Draft'
   order by version_number desc limit 1;
  if found then return d; end if;
  select * into src from document_template_versions
   where id = t.current_published_version_id;
  if not found then
    select * into src from document_template_versions
     where template_id = p_template order by version_number desc limit 1;
  end if;
  select coalesce(max(version_number), 0) + 1 into n from document_template_versions where template_id = p_template;
  insert into document_template_versions (template_id, company_id, version_number, configuration, schema_version, status, created_by)
  values (p_template, t.company_id, n, coalesce(src.configuration, '{}'::jsonb), coalesce(src.schema_version, 1), 'Draft', auth.uid())
  returning * into d;
  update document_templates set status = 'Draft', updated_by = auth.uid(), updated_at = now() where id = p_template;
  return d;
end $$;
revoke execute on function ensure_document_template_draft(uuid) from anon, public;
grant execute on function ensure_document_template_draft(uuid) to authenticated;
