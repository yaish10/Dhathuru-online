-- Attendance "Absent" must not stop HR from putting someone on a working shift.
-- Approved leave is still refused by set_roster via leave_requests.
-- Attendance "On leave" stays blocked as a safety net when leave status is mirrored onto attendance.

create or replace function roster_extra_block(p_company uuid, p_user uuid, p_day date, p_shift text) returns text
  language plpgsql stable security definer set search_path = public as
$$ declare st text; nm text;
begin
  if p_shift in ('OFF', 'L', 'TRN') then return null; end if;
  select status into st from attendance_records where company_id = p_company and user_id = p_user and day = p_day;
  -- Absent is a soft signal only (shown in the UI). Do not refuse the roster save.
  if st = 'On leave' then
    select coalesce(p.full_name, split_part(p.email, '@', 1)) into nm from profiles p where p.id = p_user;
    return nm || ' is marked On leave on ' || to_char(p_day, 'DD Mon') || ', so they cannot take a working shift.';
  end if;
  return null;
end $$;
revoke execute on function roster_extra_block(uuid, uuid, date, text) from anon, public;
