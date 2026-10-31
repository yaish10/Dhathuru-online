-- Employee documents: private files per person, version history, expiry alerts, optional qualification link.

create table staff_documents (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null,
  user_id            uuid not null,
  category           text not null check (char_length(btrim(category)) between 2 and 60),
  title              text not null check (char_length(btrim(title)) between 2 and 120),
  reference_no       text check (reference_no is null or char_length(btrim(reference_no)) <= 60),
  issue_date         date,
  expiry_date        date,
  qualification_name text check (qualification_name is null or char_length(btrim(qualification_name)) between 2 and 80),
  visibility         text not null default 'self_and_hr' check (visibility in ('hr_only', 'self_and_hr')),
  file_path          text,
  file_name          text,
  version            int not null default 1 check (version >= 1),
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  foreign key (company_id, user_id) references company_members (company_id, user_id) on delete cascade
);
create index on staff_documents (company_id, user_id);
alter table staff_documents enable row level security;
create policy sdoc_select on staff_documents for select to authenticated
  using (is_company_hr(company_id) or (visibility = 'self_and_hr' and user_id = auth.uid()));
create policy sdoc_insert on staff_documents for insert to authenticated with check (is_company_hr(company_id));
create policy sdoc_update on staff_documents for update to authenticated using (is_company_hr(company_id)) with check (is_company_hr(company_id));
create policy sdoc_delete on staff_documents for delete to authenticated using (is_company_hr(company_id));
create trigger sdoc_subscription before insert or update or delete on staff_documents
  for each row execute function reject_if_subscription_expired();

create table staff_document_versions (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references staff_documents(id) on delete cascade,
  version     int not null,
  file_path   text not null,
  file_name   text,
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  unique (document_id, version)
);
alter table staff_document_versions enable row level security;
create policy sdocv_select on staff_document_versions for select to authenticated
  using (exists (select 1 from staff_documents d where d.id = document_id and (is_company_hr(d.company_id) or (d.visibility = 'self_and_hr' and d.user_id = auth.uid()))));
create policy sdocv_insert on staff_document_versions for insert to authenticated
  with check (exists (select 1 from staff_documents d where d.id = document_id and is_company_hr(d.company_id)));
create trigger sdocv_subscription before insert or update or delete on staff_document_versions
  for each row execute function reject_if_subscription_expired();

create function staff_documents_before_write() returns trigger
  language plpgsql as
$$ begin
  new.category := btrim(new.category);
  new.title := btrim(new.title);
  new.reference_no := nullif(btrim(new.reference_no), '');
  new.qualification_name := nullif(btrim(new.qualification_name), '');
  if new.visibility is null then
    new.visibility := case when new.category in ('Disciplinary', 'Contract') then 'hr_only' else 'self_and_hr' end;
  end if;
  if tg_op = 'INSERT' then new.created_by := auth.uid(); new.version := 1; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger staff_documents_before_write before insert or update on staff_documents
  for each row execute function staff_documents_before_write();

create function staff_documents_sync_cert() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  if new.qualification_name is not null then
    update staff_certifications set valid_until = new.expiry_date
      where company_id = new.company_id and user_id = new.user_id
        and lower(btrim(name)) = lower(btrim(new.qualification_name));
    if not found then
      insert into staff_certifications (company_id, user_id, name, valid_until)
        values (new.company_id, new.user_id, new.qualification_name, new.expiry_date);
    end if;
  end if;
  return new;
end $$;
create trigger staff_documents_sync_cert after insert or update of qualification_name, expiry_date on staff_documents
  for each row execute function staff_documents_sync_cert();

create function staff_documents_audit() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  if tg_op = 'INSERT' then
    insert into company_audit (company_id, actor, action, detail) values (new.company_id, auth.uid(), 'staff_document_added', new.title);
  elsif tg_op = 'DELETE' then
    insert into company_audit (company_id, actor, action, detail) values (old.company_id, auth.uid(), 'staff_document_removed', old.title);
  else
    insert into company_audit (company_id, actor, action, detail) values (new.company_id, auth.uid(), 'staff_document_updated', new.title);
  end if;
  return coalesce(new, old);
end $$;
create trigger staff_documents_audit after insert or update or delete on staff_documents
  for each row execute function staff_documents_audit();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('staff-documents', 'staff-documents', false, 20971520, array[
  'application/pdf',
  'image/png', 'image/jpeg', 'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.ms-excel'
])
on conflict (id) do nothing;

create function staff_doc_file_company(p_name text) returns uuid
  language sql immutable as
$$ select case when split_part(p_name, '/', 1) ~ '^[0-9a-f-]{36}$' then split_part(p_name, '/', 1)::uuid end $$;

create function staff_doc_file_user(p_name text) returns uuid
  language sql immutable as
$$ select case when split_part(p_name, '/', 2) ~ '^[0-9a-f-]{36}$' then split_part(p_name, '/', 2)::uuid end $$;

create policy staff_docs_files_read on storage.objects for select to authenticated
  using (bucket_id = 'staff-documents' and (
    is_company_hr(staff_doc_file_company(name))
    or exists (select 1 from staff_documents d
               where d.company_id = staff_doc_file_company(name) and d.user_id = auth.uid()
                 and d.visibility = 'self_and_hr'
                 and (d.file_path = name or exists (select 1 from staff_document_versions v where v.document_id = d.id and v.file_path = name)))
  ));
create policy staff_docs_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'staff-documents' and is_company_hr(staff_doc_file_company(name)));
create policy staff_docs_files_update on storage.objects for update to authenticated
  using (bucket_id = 'staff-documents' and is_company_hr(staff_doc_file_company(name)));
create policy staff_docs_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'staff-documents' and is_company_hr(staff_doc_file_company(name)));

-- Include document expiry in the HR notification scan.
create or replace function scan_hr_notifications(p_company uuid) returns integer
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
    select d.id, d.user_id, d.title, d.expiry_date,
           coalesce(p.full_name, split_part(p.email, '@', 1), 'Someone') as who
    from staff_documents d
    join profiles p on p.id = d.user_id
    where d.company_id = p_company and d.expiry_date is not null
  loop
    days_left := rec.expiry_date - current_date;
    if days_left > first_d then continue; end if;
    if days_left <= final_d then stage := 'final';
    elsif days_left <= second_d then stage := 'second';
    else stage := 'first';
    end if;
    title := rec.title || case when days_left < 0 then ' expired' else ' expires soon' end;
    body := rec.who || ' · ' || rec.title || ' · ' || to_char(rec.expiry_date, 'DD Mon YYYY');
    recips := '{}';
    if emp_on then recips := recips || rec.user_id; end if;
    if hr_on then recips := recips || hr_user_ids(p_company); end if;
    n := n + notify_many(p_company, recips, 'document_expiry', stage, 'document', rec.id::text, title, body);
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
