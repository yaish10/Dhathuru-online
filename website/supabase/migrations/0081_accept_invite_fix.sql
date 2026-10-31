-- accept_invite fix: joining with an invite link failed with
--   42702 column reference "settings" is ambiguous
-- because the function's variable `settings` has the same name as the companies.settings column used in its UPDATE.
-- The person's login was created, but they were never added to the company, so the employee stayed "Invite sent"
-- and a second try said "User already registered". Same logic as 0050, variable renamed to v_settings.

create or replace function accept_invite(p_token text) returns uuid
  language plpgsql security definer set search_path = public as
$$
declare
  inv company_invites;
  prof jsonb := '{}'::jsonb;
  v_settings jsonb;
  pending jsonb;
  item jsonb;
  kept jsonb := '[]'::jsonb;
begin
  select * into inv from company_invites
    where token = p_token and accepted_at is null and expires_at > now();
  if not found then raise exception 'This invite is invalid or has expired.'; end if;
  if lower(inv.email) <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'This invite was sent to a different email address.';
  end if;

  insert into company_members (company_id, user_id, role, role_label)
  values (inv.company_id, auth.uid(), inv.role, inv.role_label)
  on conflict (company_id, user_id) do update
    set role = excluded.role, role_label = excluded.role_label, active = true;

  -- Prefer invite.meta.profile; fall back to companies.settings pending list.
  if jsonb_typeof(inv.meta->'profile') = 'object' then
    prof := inv.meta->'profile';
  end if;
  select c.settings into v_settings from companies c where c.id = inv.company_id;
  pending := coalesce(v_settings->'8_pending_employee_invites', '[]'::jsonb);
  if jsonb_typeof(pending) = 'array' then
    for item in select * from jsonb_array_elements(pending) loop
      if (item->>'invite_id') = inv.id::text
         or lower(coalesce(item->>'email', '')) = lower(inv.email) then
        if prof = '{}'::jsonb and jsonb_typeof(item->'profile') = 'object' then
          prof := item->'profile';
        end if;
      else
        kept := kept || jsonb_build_array(item);
      end if;
    end loop;
    update companies set settings = jsonb_set(coalesce(v_settings, '{}'::jsonb), '{8_pending_employee_invites}', kept)
      where id = inv.company_id;
  end if;

  perform apply_invite_profile(inv.company_id, auth.uid(), prof);

  update company_invites set accepted_at = now() where id = inv.id;
  return inv.company_id;
end;
$$;
revoke execute on function accept_invite(text) from anon;
grant execute on function accept_invite(text) to authenticated;
