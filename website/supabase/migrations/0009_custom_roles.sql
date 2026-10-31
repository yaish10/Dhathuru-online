-- Custom roles keep a display name. Database access stays on the built-in role:
-- owner and admin can manage the company; every other role, including a custom one, is staff.

alter table company_members add column role_label text
  check (role_label is null or char_length(btrim(role_label)) between 2 and 40);
alter table company_invites add column role_label text
  check (role_label is null or char_length(btrim(role_label)) between 2 and 40);

drop function if exists get_invite(text);
create function get_invite(p_token text)
  returns table (company_name text, role member_role, email text, role_label text)
  language sql stable security definer set search_path = public as
  $$ select c.name, i.role, i.email, i.role_label
     from company_invites i
     join companies c on c.id = i.company_id
     where i.token = p_token and i.accepted_at is null and i.expires_at > now() $$;
grant execute on function get_invite(text) to anon, authenticated;

create or replace function accept_invite(p_token text) returns uuid
  language plpgsql security definer set search_path = public as
$$ declare inv company_invites; begin
  select * into inv from company_invites where token = p_token and accepted_at is null and expires_at > now();
  if not found then raise exception 'This invite is invalid or has expired.'; end if;
  if lower(inv.email) <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'This invite was sent to a different email address.';
  end if;
  insert into company_members (company_id, user_id, role, role_label)
  values (inv.company_id, auth.uid(), inv.role, inv.role_label)
  on conflict (company_id, user_id) do update
    set role = excluded.role, role_label = excluded.role_label, active = true;
  update company_invites set accepted_at = now() where id = inv.id;
  return inv.company_id;
end $$;
revoke execute on function accept_invite(text) from anon;
grant execute on function accept_invite(text) to authenticated;
