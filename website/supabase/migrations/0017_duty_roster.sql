-- Duty roster: one entry per person per day, per company.
-- Shift codes come from Settings > HR & Crew > Shift Definitions (8_shift_definitions[].code),
-- plus the reserved codes OFF (off duty), L (leave) and TRN (training).
create table roster_entries (
  company_id uuid not null,
  user_id    uuid not null,
  day        date not null,
  shift      text not null check (char_length(shift) between 1 and 6),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (company_id, user_id, day),
  foreign key (company_id, user_id) references company_members (company_id, user_id) on delete cascade
);
create index on roster_entries (company_id, day);
alter table roster_entries enable row level security;
-- Everyone in the company can see the roster; changes go through set_roster().
create policy roster_select on roster_entries for select to authenticated using (is_company_member(company_id));
create trigger roster_subscription before insert or update or delete on roster_entries
  for each row execute function reject_if_subscription_expired();

-- HR, owners, admins, and the people named for "Crew assignments" (Approvers & Responsibilities) edit the roster.
create function can_edit_roster(cid uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select is_company_hr(cid) or exists (
    select 1 from companies c,
      lateral (select coalesce(c.settings->'8_approvers_and_responsibilities'->'duties'->'crew_assign', '{}'::jsonb) d) x
    where c.id = cid
      and exists (select 1 from company_members m where m.company_id = cid and m.user_id = auth.uid() and m.active)
      and (auth.uid()::text in (select jsonb_array_elements_text(coalesce(x.d->'people', '[]'::jsonb)))
           or auth.uid()::text = x.d->>'backup')) $$;
revoke execute on function can_edit_roster(uuid) from anon, public;
grant execute on function can_edit_roster(uuid) to authenticated;


-- True when the person holds a qualification that has expired by p_day and has not been renewed.
create function has_expired_cert(p_company uuid, p_user uuid, p_day date) returns boolean
  language sql stable security definer set search_path = public as
$$ select exists (
    select 1 from staff_certifications c
    where c.company_id = p_company and c.user_id = p_user and c.valid_until < p_day
      and not exists (select 1 from staff_certifications c2
        where c2.company_id = c.company_id and c2.user_id = c.user_id and lower(btrim(c2.name)) = lower(btrim(c.name))
          and (c2.valid_until is null or c2.valid_until >= p_day))) $$;
revoke execute on function has_expired_cert(uuid, uuid, date) from anon, public;

-- The duty/vessel rule from 0015 uses the same renewal-aware check.
create or replace function set_member_hr(p_company uuid, p_user uuid, p_patch jsonb) returns void
  language plpgsql security definer set search_path = public as
$fn$ declare v_block boolean; v_expired boolean;
begin
  if not is_company_hr(p_company) then raise exception 'Only HR, owners and admins can change this.'; end if;
  if not exists (select 1 from company_members where company_id = p_company and user_id = p_user) then
    raise exception 'That person is not in this company.'; end if;
  select coalesce((settings->'8_crew_assignment_rules'->>'expired')::boolean, true) into v_block from companies where id = p_company;
  v_expired := has_expired_cert(p_company, p_user, current_date);
  if v_block and v_expired and (
       p_patch->>'duty_status' = 'On duty'
       or (coalesce(btrim(p_patch->>'assigned_vessel'), '') <> ''
           and coalesce(btrim(p_patch->>'assigned_vessel'), '') is distinct from
               coalesce((select assigned_vessel from company_members where company_id = p_company and user_id = p_user), ''))) then
    raise exception 'This person has an expired certificate, so they cannot go on duty or be assigned a vessel (see Crew Assignment Rules).';
  end if;
  if p_patch ? 'job_title_id' then
    if p_patch->>'job_title_id' is not null and not exists (select 1 from job_titles where id = (p_patch->>'job_title_id')::uuid and company_id = p_company) then
      raise exception 'Unknown designation.'; end if;
    update company_members set job_title_id = (p_patch->>'job_title_id')::uuid where company_id = p_company and user_id = p_user;
  end if;
  if p_patch ? 'duty_status' then
    if p_patch->>'duty_status' not in ('On duty', 'Off duty', 'On leave') then raise exception 'Unknown duty status.'; end if;
    update company_members set duty_status = p_patch->>'duty_status' where company_id = p_company and user_id = p_user;
  end if;
  if p_patch ? 'assigned_vessel' then
    update company_members set assigned_vessel = nullif(left(btrim(p_patch->>'assigned_vessel'), 60), '')
      where company_id = p_company and user_id = p_user;
  end if;
  insert into company_audit (company_id, actor, action, detail) values (p_company, auth.uid(), 'duty_changed', p_user::text);
end $fn$;

-- Save many cells at once: p_rows = [{ "u": user_id, "d": "2026-10-01", "s": "D" | null }]  (null clears the cell)
create function set_roster(p_company uuid, p_rows jsonb) returns integer
  language plpgsql security definer set search_path = public as
$$ declare
  st jsonb; codes text[]; rules jsonb; ros jsonb; rw jsonb; u uuid; d date; s text; n integer := 0; nm text;
begin
  if not can_edit_roster(p_company) then raise exception 'Only HR, owners, admins and the people named for crew assignments can change the roster.'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then raise exception 'Send up to 2000 roster cells at a time.'; end if;
  select settings into st from companies where id = p_company;
  codes := array(select upper(btrim(coalesce(x->>'code', left(x->>'name', 1)))) from jsonb_array_elements(
             case when jsonb_typeof(st->'8_shift_definitions') = 'array' then st->'8_shift_definitions'
                  else '[{"code":"D"},{"code":"E"},{"code":"N"}]'::jsonb end) x where jsonb_typeof(x) = 'object')
           || array['OFF', 'L', 'TRN'];
  rules := coalesce(st->'8_crew_assignment_rules', '{}'::jsonb);
  ros := coalesce(st->'8_duty_roster', '{}'::jsonb);
  for rw in select * from jsonb_array_elements(p_rows) loop
    u := (rw->>'u')::uuid; d := (rw->>'d')::date; s := upper(btrim(rw->>'s'));
    if not exists (select 1 from company_members where company_id = p_company and user_id = u and active) then
      raise exception 'Someone in this roster is not an active member of the company.'; end if;
    select coalesce(p.full_name, split_part(p.email, '@', 1)) into nm from profiles p where p.id = u;
    if coalesce((ros->>'lockPast')::boolean, false) and d < current_date then
      raise exception 'Past days are locked (see Duty Roster settings).'; end if;
    if s is null or s = '' then
      delete from roster_entries where company_id = p_company and user_id = u and day = d;
    else
      if not (s = any(codes)) then raise exception 'Unknown shift code "%". Add it under Shift Definitions.', s; end if;
      if s not in ('OFF', 'L') and exists (select 1 from leave_requests where company_id = p_company and user_id = u
            and status = 'Approved' and d between start_date and end_date) then
        raise exception '% is on approved leave on %.', nm, to_char(d, 'DD Mon');
      end if;
      if s not in ('OFF', 'L', 'TRN') and coalesce((rules->>'expired')::boolean, true) and has_expired_cert(p_company, u, d) then
        raise exception '% has an expired certificate on %, so they cannot work a shift (see Crew Assignment Rules).', nm, to_char(d, 'DD Mon');
      end if;
      insert into roster_entries (company_id, user_id, day, shift, updated_by) values (p_company, u, d, s, auth.uid())
        on conflict (company_id, user_id, day) do update set shift = excluded.shift, updated_by = excluded.updated_by, updated_at = now();
    end if;
    n := n + 1;
  end loop;
  insert into company_audit (company_id, actor, action, detail) values (p_company, auth.uid(), 'roster_changed', n || ' cells');
  return n;
end $$;
revoke execute on function set_roster(uuid, jsonb) from anon, public;
grant execute on function set_roster(uuid, jsonb) to authenticated;
