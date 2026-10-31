-- HR & Crew: duty status, vessel assignment, certifications and leave requests, all per company.

-- Owners, admins and HR staff (and the platform owner) manage HR data.
create function is_company_hr(cid uuid) returns boolean
  language sql stable security definer set search_path = public as
  $$ select is_platform_admin()
     or exists (select 1 from company_members
       where company_id = cid and user_id = auth.uid() and active and role in ('owner','admin','hr')) $$;
revoke execute on function is_company_hr(uuid) from anon, public;
grant execute on function is_company_hr(uuid) to authenticated;

alter table company_members
  add column duty_status text not null default 'Off duty' check (duty_status in ('On duty', 'Off duty', 'On leave')),
  add column assigned_vessel text check (assigned_vessel is null or char_length(assigned_vessel) <= 60);

create table staff_certifications (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null,
  user_id     uuid not null,
  name        text not null check (char_length(btrim(name)) between 2 and 80),
  valid_until date,
  created_at  timestamptz not null default now(),
  foreign key (company_id, user_id) references company_members (company_id, user_id) on delete cascade
);
create index on staff_certifications (company_id, user_id);

create table leave_requests (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null,
  user_id     uuid not null,
  leave_type  text not null check (char_length(btrim(leave_type)) between 2 and 40),
  start_date  date not null,
  end_date    date not null,
  note        text check (note is null or char_length(note) <= 200),
  status      text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected')),
  decided_by  uuid references auth.users(id) on delete set null,
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  check (end_date >= start_date),
  foreign key (company_id, user_id) references company_members (company_id, user_id) on delete cascade
);
create index on leave_requests (company_id, status);

alter table staff_certifications enable row level security;
alter table leave_requests enable row level security;

-- People see their own HR records; HR sees the whole company's.
create policy certs_select on staff_certifications for select to authenticated
  using (is_company_hr(company_id) or user_id = auth.uid());
create policy certs_insert on staff_certifications for insert to authenticated with check (is_company_hr(company_id));
create policy certs_update on staff_certifications for update to authenticated
  using (is_company_hr(company_id)) with check (is_company_hr(company_id));
create policy certs_delete on staff_certifications for delete to authenticated using (is_company_hr(company_id));

create policy leave_select on leave_requests for select to authenticated
  using (is_company_hr(company_id) or user_id = auth.uid());
create policy leave_insert on leave_requests for insert to authenticated
  with check (is_company_hr(company_id) or (user_id = auth.uid() and is_company_member(company_id)));
create policy leave_delete on leave_requests for delete to authenticated using (is_company_hr(company_id));
-- No update policy: decisions go through decide_leave().

-- A new request is always Pending, whoever files it.
create function leave_requests_new() returns trigger language plpgsql security definer set search_path = public as
$$ begin
  new.status := 'Pending'; new.decided_by := null; new.decided_at := null;
  return new;
end $$;
create trigger leave_requests_new before insert on leave_requests
  for each row execute function leave_requests_new();

-- Expired subscriptions are read-only here too.
create trigger certs_subscription before insert or update or delete on staff_certifications
  for each row execute function reject_if_subscription_expired();
create trigger leave_subscription before insert or update or delete on leave_requests
  for each row execute function reject_if_subscription_expired();

create function decide_leave(p_id uuid, p_approve boolean) returns void
  language plpgsql security definer set search_path = public as
$$ declare r leave_requests;
begin
  select * into r from leave_requests where id = p_id;
  if not found then raise exception 'Leave request not found.'; end if;
  if not is_company_hr(r.company_id) then raise exception 'Only HR, owners and admins can decide leave.'; end if;
  if r.status <> 'Pending' then raise exception 'That request has already been decided.'; end if;
  update leave_requests set status = case when p_approve then 'Approved' else 'Rejected' end,
    decided_by = auth.uid(), decided_at = now() where id = p_id;
  if p_approve and current_date between r.start_date and r.end_date then
    update company_members set duty_status = 'On leave' where company_id = r.company_id and user_id = r.user_id;
  end if;
  insert into company_audit (company_id, actor, action, detail)
    values (r.company_id, auth.uid(), case when p_approve then 'leave_approved' else 'leave_rejected' end, r.user_id::text);
end $$;

create function set_member_hr(p_company uuid, p_user uuid, p_patch jsonb) returns void
  language plpgsql security definer set search_path = public as
$$ begin
  if not is_company_hr(p_company) then raise exception 'Only HR, owners and admins can change this.'; end if;
  if not exists (select 1 from company_members where company_id = p_company and user_id = p_user) then
    raise exception 'That person is not in this company.'; end if;
  if p_patch ? 'duty_status' then
    if p_patch->>'duty_status' not in ('On duty', 'Off duty', 'On leave') then raise exception 'Unknown duty status.'; end if;
    update company_members set duty_status = p_patch->>'duty_status' where company_id = p_company and user_id = p_user;
  end if;
  if p_patch ? 'assigned_vessel' then
    update company_members set assigned_vessel = nullif(left(btrim(p_patch->>'assigned_vessel'), 60), '')
      where company_id = p_company and user_id = p_user;
  end if;
  insert into company_audit (company_id, actor, action, detail) values (p_company, auth.uid(), 'duty_changed', p_user::text);
end $$;
revoke execute on function decide_leave(uuid, boolean), set_member_hr(uuid, uuid, jsonb) from anon, public;
grant execute on function decide_leave(uuid, boolean), set_member_hr(uuid, uuid, jsonb) to authenticated;
