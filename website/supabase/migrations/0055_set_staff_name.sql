-- Cursor 2026-10-26: HR (or the person) can set the real name from the employee edit form.
-- apply_invite_profile only fills profiles.full_name when it is still empty.

create or replace function set_staff_name(p_company uuid, p_user uuid, p_name text)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if p_user is distinct from auth.uid() and not is_company_hr(p_company) then
    raise exception 'Only HR can change someone else''s name.';
  end if;
  if not exists (
    select 1 from company_members where company_id = p_company and user_id = p_user
  ) then
    raise exception 'That person is not in this company.';
  end if;
  update profiles
    set full_name = nullif(left(btrim(coalesce(p_name, '')), 120), '')
    where id = p_user;
end;
$$;

revoke all on function set_staff_name(uuid, uuid, text) from public, anon;
grant execute on function set_staff_name(uuid, uuid, text) to authenticated;
