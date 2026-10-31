-- Safeguards for the notice settings (0078).
--  1. Personal notices (addressed to the person they are about) can never be switched off or have that person dropped: the setting
--     can only ADD people to them. Enforced where notices are sent, so an old or hand-edited setting cannot silence anyone.
--  2. Settings are saved through set_notice_type(): only owners and admins, only known notice kinds, a cleaned-up shape, and an
--     entry in the audit log saying who changed which notice and how. A null value resets the notice to its default.

create function notice_kinds() returns text[]
  language sql immutable as
$$ select array['new_booking','passenger_added','booking_cancelled','trip','ops_advisory','leave_request','leave_decision','leave_reminder',
  'attendance_correction','attendance_decision','swap_request','swap_approval','swap_result','cert_expiry','document_expiry','payslip',
  'work_order','maint_plan','defect','vessel_status','maint_due','maint_warranty','maint_contract','maint_budget','low_stock',
  'purchase_request','purchase_order','it_device','it_alert','it_ticket','it_ticket_reply','it_ticket_assigned','it_ticket_done'] $$;

-- Notices that always reach the person they are about.
create function notice_required(p_kind text) returns boolean
  language sql immutable as
$$ select p_kind = any(array['leave_decision','attendance_decision','payslip','swap_request','swap_result','it_ticket_reply','it_ticket_assigned','it_ticket_done']) $$;

create or replace function notice_cfg(p_company uuid, p_kind text) returns jsonb
  language sql stable security definer set search_path = public as
$$ select case when notice_required(p_kind) then coalesce(company_setting(p_company, '11_notice_types') -> p_kind, '{}'::jsonb) || '{"enabled": true, "keepDefault": true}'::jsonb
               else company_setting(p_company, '11_notice_types') -> p_kind end $$;

create function set_notice_type(p_company uuid, p_kind text, p_cfg jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare old jsonb; cur jsonb; blk jsonb; parts text[] := '{}'; teams jsonb; desig jsonb; o text; n text;
begin
  if not is_company_admin(p_company) then raise exception 'Only owners and admins can change notice settings.'; end if;
  if not (p_kind = any(notice_kinds())) then raise exception 'Unknown notice type.'; end if;
  cur := coalesce(company_setting(p_company, '11_notice_types'), '{}'::jsonb);
  old := cur -> p_kind;
  if p_cfg is null or jsonb_typeof(p_cfg) = 'null' then
    cur := cur - p_kind; blk := null; parts := array['reset to default'];
  else
    if jsonb_typeof(p_cfg) <> 'object' then raise exception 'Invalid notice settings.'; end if;
    teams := coalesce((select jsonb_agg(distinct x) from jsonb_array_elements_text(coalesce(p_cfg->'teams', '[]'::jsonb)) x
                       where x in ('operations', 'hr', 'it', 'maintenance')), '[]'::jsonb);
    desig := coalesce((select jsonb_agg(distinct left(btrim(x), 80)) from jsonb_array_elements_text(coalesce(p_cfg->'designations', '[]'::jsonb)) x
                       where btrim(x) <> ''), '[]'::jsonb);
    if jsonb_array_length(desig) > 60 then raise exception 'Too many designations.'; end if;
    blk := jsonb_build_object(
      'enabled', case when notice_required(p_kind) then true else coalesce((p_cfg->>'enabled')::boolean, true) end,
      'keepDefault', case when notice_required(p_kind) then true else coalesce((p_cfg->>'keepDefault')::boolean, true) end,
      'teams', teams, 'designations', desig, 'rosteredOnly', coalesce((p_cfg->>'rosteredOnly')::boolean, true));
    cur := jsonb_set(cur, array[p_kind], blk, true);
    if coalesce(old->>'enabled', 'true') <> blk->>'enabled' then parts := parts || ('sending ' || case when (blk->>'enabled')::boolean then 'on' else 'OFF' end); end if;
    if coalesce(old->>'keepDefault', 'true') <> blk->>'keepDefault' then parts := parts || ('normal recipients ' || case when (blk->>'keepDefault')::boolean then 'kept' else 'dropped' end); end if;
    o := coalesce(old->'teams', '[]'::jsonb)::text; n := teams::text;
    if o <> n then parts := parts || ('teams ' || n); end if;
    o := coalesce(old->'designations', '[]'::jsonb)::text; n := desig::text;
    if o <> n then parts := parts || ('designations ' || n); end if;
    if coalesce(old->>'rosteredOnly', 'true') <> blk->>'rosteredOnly' then parts := parts || ('roster only ' || case when (blk->>'rosteredOnly')::boolean then 'on' else 'off' end); end if;
    if array_length(parts, 1) is null then parts := array['saved, no change']; end if;
  end if;
  update companies set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{11_notice_types}', cur, true) where id = p_company;
  insert into company_audit (company_id, actor, action, detail) values (p_company, auth.uid(), 'notice_changed', left(p_kind || ': ' || array_to_string(parts, '; '), 300));
  return blk;
end $$;
revoke execute on function set_notice_type(uuid, text, jsonb) from anon, public;
grant execute on function set_notice_type(uuid, text, jsonb) to authenticated;
