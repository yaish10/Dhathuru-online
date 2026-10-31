-- Medical certificate files for leave requests (apps and website).
-- A person uploads their own certificate to the private bucket `leave-certificates` under company_id/user_id/..., then the
-- request points at it. Only that person, HR, and the people who decide the request can open it.
-- HR Settings → Leave Types & Policies gets a toggle per type, "Certificate file required" (certFile): when on, a request
-- "with certificate" must carry the file.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('leave-certificates', 'leave-certificates', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

alter table leave_requests add column certificate_path text check (certificate_path is null or char_length(certificate_path) <= 300);
alter table leave_requests add column certificate_name text check (certificate_name is null or char_length(certificate_name) <= 200);
-- The file must sit in this person's own folder of this company.
alter table leave_requests add constraint leave_certificate_path_own
  check (certificate_path is null or certificate_path like company_id::text || '/' || user_id::text || '/%');

create function leave_cert_file_company(p_name text) returns uuid
  language sql immutable as
$$ select case when split_part(p_name, '/', 1) ~ '^[0-9a-f-]{36}$' then split_part(p_name, '/', 1)::uuid end $$;
create function leave_cert_file_user(p_name text) returns uuid
  language sql immutable as
$$ select case when split_part(p_name, '/', 2) ~ '^[0-9a-f-]{36}$' then split_part(p_name, '/', 2)::uuid end $$;

-- Who may open a file: its owner, HR, and the approvers of the request that uses it.
create function leave_cert_can_read(p_name text) returns boolean
  language sql stable security definer set search_path = public as
$$ select leave_cert_file_user(p_name) = auth.uid()
    or is_company_hr(leave_cert_file_company(p_name))
    or exists (select 1 from leave_requests l where l.certificate_path = p_name and auth.uid() = any(coalesce(leave_approver_ids(l.id), '{}'))) $$;
revoke execute on function leave_cert_can_read(text) from anon, public;
grant execute on function leave_cert_can_read(text) to authenticated;

create policy leave_cert_files_read on storage.objects for select to authenticated
  using (bucket_id = 'leave-certificates' and leave_cert_can_read(name));
create policy leave_cert_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'leave-certificates' and leave_cert_file_user(name) = auth.uid() and is_company_member(leave_cert_file_company(name)));
-- A person may remove their own file while no request uses it yet; HR may remove any.
create policy leave_cert_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'leave-certificates' and (is_company_hr(leave_cert_file_company(name))
    or (leave_cert_file_user(name) = auth.uid() and not exists (select 1 from leave_requests l where l.certificate_path = name))));

-- leave_types_of: one more field, certFile.
create or replace function leave_types_of(p_company uuid) returns jsonb
  language sql stable security definer set search_path = public as
$$ select coalesce(
     (select jsonb_agg(jsonb_build_object('name', x->>'name', 'days', coalesce(nullif(x->>'days', '')::int, 0),
                                          'paid', coalesce((x->>'paid')::boolean, true), 'note', coalesce((x->>'note')::boolean, false),
                                          'cert', case when x->>'cert' in ('Optional', 'Required') then x->>'cert' else 'Not applicable' end,
                                          'nocert', coalesce(nullif(x->>'nocert', '')::int, 0),
                                          'nocert_run', coalesce(nullif(x->>'nocertRun', '')::int, 0),
                                          'cert_file', coalesce((x->>'certFile')::boolean, false)))
        from companies c, jsonb_array_elements(case when jsonb_typeof(c.settings->'8_leave_types_and_policies') = 'array'
             then c.settings->'8_leave_types_and_policies' else '[]'::jsonb end) x
        where c.id = p_company and jsonb_typeof(x) = 'object' and coalesce(btrim(x->>'name'), '') <> ''),
     jsonb_build_array(jsonb_build_object('name', 'Annual leave', 'days', 0, 'paid', true, 'note', false,
                                          'cert', 'Not applicable', 'nocert', 0, 'nocert_run', 0, 'cert_file', false))) $$;

-- leave_cert_rules (0069) plus: a request with a certificate must carry the file when the type says so.
create or replace function leave_cert_rules() returns trigger
  language plpgsql security definer set search_path = public as
$$ declare t jsonb; mode text; nocert int; run_max int; need int; used int; run int; cur_s date; cur_e date; o leave_requests; found_adj boolean; n int := 0;
begin
  select x into t from jsonb_array_elements(leave_types_of(new.company_id)) x where x->>'name' = new.leave_type;
  if t is null then return new; end if;
  mode := t->>'cert';
  if mode not in ('Optional', 'Required') then new.certificate := null; new.certificate_path := null; new.certificate_name := null; return new; end if;
  if mode = 'Required' then
    if new.certificate is not true then raise exception 'A medical certificate is required for %. Say that you have one.', new.leave_type; end if;
  else
    -- Optional: no answer counts as without a certificate.
    if new.certificate is null then new.certificate := false; end if;
  end if;
  if new.certificate then
    if (t->>'cert_file')::boolean and new.certificate_path is null then
      raise exception 'Attach a copy of the medical certificate for %.', new.leave_type;
    end if;
    return new;
  end if;
  new.certificate_path := null; new.certificate_name := null;
  need := leave_working_days(new.company_id, new.start_date, new.end_date);
  nocert := (t->>'nocert')::int; run_max := (t->>'nocert_run')::int;
  if nocert > 0 then
    used := leave_used_nocert(new.company_id, new.user_id, new.leave_type, extract(year from new.start_date)::int, 'Approved')
          + leave_used_nocert(new.company_id, new.user_id, new.leave_type, extract(year from new.start_date)::int, 'Pending');
    if used + need > nocert then
      raise exception 'Without a certificate % allows % working days a year (% used or waiting). Add a medical certificate for the rest.', new.leave_type, nocert, used;
    end if;
  end if;
  if run_max > 0 then
    cur_s := new.start_date; cur_e := new.end_date;
    loop
      found_adj := false; n := n + 1; exit when n > 20;
      select * into o from leave_requests l
        where l.company_id = new.company_id and l.user_id = new.user_id and l.leave_type = new.leave_type and l.certificate is false
          and l.status in ('Pending', 'Approved') and l.id is distinct from new.id
          and ((l.end_date < cur_s and leave_working_days(new.company_id, l.end_date + 1, cur_s - 1) = 0)
            or (l.start_date > cur_e and leave_working_days(new.company_id, cur_e + 1, l.start_date - 1) = 0))
        limit 1;
      if found then cur_s := least(cur_s, o.start_date); cur_e := greatest(cur_e, o.end_date); found_adj := true; end if;
      exit when not found_adj;
    end loop;
    run := leave_working_days(new.company_id, cur_s, cur_e);
    if run > run_max then
      raise exception 'Without a certificate you can take at most % working days in a row of % (this would make %). Add a medical certificate for longer leave.', run_max, new.leave_type, run;
    end if;
  end if;
  return new;
end $$;

drop function request_leave(uuid, text, date, date, text, boolean);
create function request_leave(p_company uuid, p_type text, p_start date, p_end date, p_note text default null, p_certificate boolean default null,
                              p_certificate_path text default null, p_certificate_name text default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare t jsonb; lim int; need int; used int; r leave_requests;
begin
  if not is_company_member(p_company) then raise exception 'Not a member of this company.'; end if;
  if not exists (select 1 from company_members where company_id = p_company and user_id = auth.uid() and active) then
    raise exception 'Only active staff can ask for leave.'; end if;
  select x into t from jsonb_array_elements(leave_types_of(p_company)) x where x->>'name' = p_type;
  if t is null then raise exception 'That leave type is not available.'; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'Choose valid dates. The end date cannot be before the start.'; end if;
  if p_end - p_start > 365 then raise exception 'Leave cannot be longer than a year.'; end if;
  need := leave_working_days(p_company, p_start, p_end);
  if need = 0 then raise exception 'Those dates are all weekend days.'; end if;
  if (t->>'note')::boolean and coalesce(btrim(p_note), '') = '' then raise exception 'A note is required for %.', p_type; end if;
  if p_certificate_path is not null and p_certificate_path not like p_company::text || '/' || auth.uid()::text || '/%' then
    raise exception 'That certificate file is not yours.'; end if;
  lim := (t->>'days')::int;
  if lim > 0 then
    used := leave_used_days(p_company, auth.uid(), p_type, extract(year from p_start)::int, 'Approved')
          + leave_used_days(p_company, auth.uid(), p_type, extract(year from p_start)::int, 'Pending');
    if used + need > lim then
      raise exception 'That is more than the % working days of % allowed this year (% used or waiting).', lim, p_type, used;
    end if;
  end if;
  if exists (select 1 from leave_requests where company_id = p_company and user_id = auth.uid() and status in ('Pending', 'Approved')
               and start_date <= p_end and end_date >= p_start) then
    raise exception 'You already have leave that overlaps those dates.';
  end if;
  insert into leave_requests (company_id, user_id, leave_type, start_date, end_date, note, certificate, certificate_path, certificate_name)
    values (p_company, auth.uid(), p_type, p_start, p_end, nullif(left(btrim(p_note), 200), ''), p_certificate,
            case when p_certificate is true then p_certificate_path end, case when p_certificate is true then left(p_certificate_name, 200) end)
    returning * into r;
  select * into r from leave_requests where id = r.id;   -- the insert triggers may have changed it
  return jsonb_build_object('id', r.id, 'status', lower(r.status), 'days', need, 'certificate', r.certificate, 'has_file', r.certificate_path is not null);
end $$;
revoke execute on function request_leave(uuid, text, date, date, text, boolean, text, text) from anon, public;
grant execute on function request_leave(uuid, text, date, date, text, boolean, text, text) to authenticated;

-- Add or replace the file on one of your own requests that comes with a certificate.
create function attach_leave_certificate(p_id uuid, p_path text, p_name text) returns void
  language plpgsql security definer set search_path = public as
$$ declare r leave_requests;
begin
  select * into r from leave_requests where id = p_id;
  if not found or r.user_id <> auth.uid() then raise exception 'Leave request not found.'; end if;
  if r.certificate is not true then raise exception 'This request is not marked as having a medical certificate.'; end if;
  if r.status = 'Rejected' then raise exception 'This request was rejected.'; end if;
  if p_path is null or p_path not like r.company_id::text || '/' || auth.uid()::text || '/%' then raise exception 'That certificate file is not yours.'; end if;
  update leave_requests set certificate_path = p_path, certificate_name = left(p_name, 200) where id = p_id;
  insert into company_audit (company_id, actor, action, detail) values (r.company_id, auth.uid(), 'leave_certificate_attached', r.id::text);
end $$;
revoke execute on function attach_leave_certificate(uuid, text, text) from anon, public;
grant execute on function attach_leave_certificate(uuid, text, text) to authenticated;

-- my_leave_overview and my_approvals: certificate file name and path on requests.
create or replace function my_leave_overview(p_company uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare yr int := extract(year from current_date)::int; w jsonb; types jsonb; reqs jsonb;
begin
  if not is_company_member(p_company) then raise exception 'Not a member of this company.'; end if;
  select settings->'8_leave_approval_workflow' into w from companies where id = p_company;
  select coalesce(jsonb_agg(t || jsonb_build_object(
      'taken', leave_used_days(p_company, auth.uid(), t->>'name', yr, 'Approved'),
      'pending', leave_used_days(p_company, auth.uid(), t->>'name', yr, 'Pending'),
      'remaining', case when (t->>'days')::int > 0 then (t->>'days')::int
                          - leave_used_days(p_company, auth.uid(), t->>'name', yr, 'Approved')
                          - leave_used_days(p_company, auth.uid(), t->>'name', yr, 'Pending') end,
      'nocert_used', leave_used_nocert(p_company, auth.uid(), t->>'name', yr, 'Approved') + leave_used_nocert(p_company, auth.uid(), t->>'name', yr, 'Pending'),
      'nocert_remaining', case when t->>'cert' = 'Optional' and (t->>'nocert')::int > 0 then (t->>'nocert')::int
                          - leave_used_nocert(p_company, auth.uid(), t->>'name', yr, 'Approved')
                          - leave_used_nocert(p_company, auth.uid(), t->>'name', yr, 'Pending') end)), '[]'::jsonb)
    into types from jsonb_array_elements(leave_types_of(p_company)) t;
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'type', l.leave_type, 'start', l.start_date, 'end', l.end_date,
      'days', leave_working_days(p_company, l.start_date, l.end_date), 'status', lower(l.status), 'note', l.note, 'certificate', l.certificate, 'certificate_name', l.certificate_name, 'certificate_path', l.certificate_path,
      'decision_note', l.decision_note, 'created_at', l.created_at, 'decided_at', l.decided_at) order by l.start_date desc), '[]'::jsonb)
    into reqs from leave_requests l
    where l.company_id = p_company and l.user_id = auth.uid() and l.end_date >= date_trunc('year', current_date)::date - 365;
  return jsonb_build_object('year', yr, 'approval_on', coalesce((w->>'enabled')::boolean, true), 'weekend', to_jsonb(leave_weekend_dows(p_company)), 'types', types, 'requests', reqs);
end $$;


create or replace function my_approvals(p_company uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare w jsonb; pend jsonb; done_ jsonb;
begin
  if not is_company_member(p_company) then raise exception 'Not a member of this company.'; end if;
  select settings->'8_leave_approval_workflow' into w from companies where id = p_company;

  select coalesce(jsonb_agg(x order by x->>'created_at'), '[]'::jsonb) into pend from (
    select jsonb_build_object('kind', 'leave', 'id', l.id, 'requester_id', l.user_id, 'requester', swap_name(l.user_id),
             'designation', swap_title(l.company_id, l.user_id), 'title', l.leave_type, 'start', l.start_date, 'end', l.end_date,
             'days', l.end_date - l.start_date + 1, 'note', l.note, 'certificate', l.certificate, 'certificate_name', l.certificate_name, 'certificate_path', l.certificate_path, 'created_at', l.created_at) as x
      from leave_requests l where l.company_id = p_company and l.status = 'Pending' and leave_can_decide(l.id)
    union all
    select jsonb_build_object('kind', 'swap', 'id', s.id, 'requester_id', s.requester, 'requester', swap_name(s.requester),
             'designation', swap_title(s.company_id, s.requester), 'title', 'Shift swap', 'day', s.day,
             'requester_shift', s.requester_shift, 'partner', swap_name(s.partner), 'partner_shift', s.partner_shift,
             'note', s.reason, 'partner_note', s.partner_note, 'created_at', s.created_at)
      from shift_swaps s
      where s.company_id = p_company and s.status = 'pending_approval' and s.requester <> auth.uid() and s.partner <> auth.uid()
        and (auth.uid() = any(coalesce(swap_approver_ids(s.id), '{}')) or is_company_hr(s.company_id))
    union all
    select jsonb_build_object('kind', 'attendance', 'id', c.id, 'requester_id', c.user_id, 'requester', swap_name(c.user_id),
             'designation', swap_title(c.company_id, c.user_id), 'title', 'Attendance correction', 'day', c.day,
             'clock_in', c.clock_in, 'clock_out', c.clock_out, 'proposed_status', c.status, 'note', c.reason, 'created_at', c.created_at)
      from attendance_corrections c
      where c.company_id = p_company and c.status_now = 'Pending' and is_company_hr(c.company_id)
  ) q;

  select coalesce(jsonb_agg(x order by x->>'decided_at' desc), '[]'::jsonb) into done_ from (
    select jsonb_build_object('kind', 'leave', 'id', l.id, 'requester', swap_name(l.user_id), 'designation', swap_title(l.company_id, l.user_id),
             'title', l.leave_type, 'start', l.start_date, 'end', l.end_date, 'days', l.end_date - l.start_date + 1, 'note', l.note, 'certificate', l.certificate, 'certificate_name', l.certificate_name, 'certificate_path', l.certificate_path,
             'status', lower(l.status), 'decided_at', l.decided_at, 'decision_note', l.decision_note, 'created_at', l.created_at) as x
      from leave_requests l where l.company_id = p_company and l.decided_by = auth.uid() and l.decided_at > now() - interval '30 days'
    union all
    select jsonb_build_object('kind', 'swap', 'id', s.id, 'requester', swap_name(s.requester), 'designation', swap_title(s.company_id, s.requester),
             'title', 'Shift swap', 'day', s.day, 'requester_shift', s.requester_shift, 'partner', swap_name(s.partner), 'partner_shift', s.partner_shift,
             'note', s.reason, 'status', s.status, 'decided_at', s.decided_at, 'decision_note', s.decision_note, 'created_at', s.created_at)
      from shift_swaps s where s.company_id = p_company and s.decided_by = auth.uid() and s.decided_at > now() - interval '30 days'
    union all
    select jsonb_build_object('kind', 'attendance', 'id', c.id, 'requester', swap_name(c.user_id), 'designation', swap_title(c.company_id, c.user_id),
             'title', 'Attendance correction', 'day', c.day, 'clock_in', c.clock_in, 'clock_out', c.clock_out, 'proposed_status', c.status,
             'note', c.reason, 'status', lower(c.status_now), 'decided_at', c.decided_at, 'created_at', c.created_at)
      from attendance_corrections c where c.company_id = p_company and c.decided_by = auth.uid() and c.decided_at > now() - interval '30 days'
  ) q;

  return jsonb_build_object('comment_required', coalesce((w->>'comment')::boolean, false), 'pending', pend, 'decided', done_);
end $$;
revoke execute on function my_approvals(uuid) from anon, public;
grant execute on function my_approvals(uuid) to authenticated;
