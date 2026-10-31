-- Renumbered by Claude 2026-10-30: was 0061 (taken — veyora already has 0001–0081 applied). Apply after 0081.
-- Cursor 2026-10-30: platform owner can erase a company's passengers, including copies kept on bookings.
-- Bookings, fares and payments stay. The people do not: registry rows, booking lines, and invoice names tied to a passenger.

create or replace function platform_delete_passengers(p_company uuid, p_confirm text, p_passenger uuid default null)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_code text;
  n_pax int := 0;
  n_lines int := 0;
  n_inv int := 0;
  v_id text;
begin
  if not is_platform_admin() then
    raise exception 'Only the platform owner can delete passengers.';
  end if;
  select code into v_code from companies where id = p_company;
  if v_code is null then raise exception 'Company not found.'; end if;
  if btrim(coalesce(p_confirm, '')) is distinct from v_code then
    raise exception 'Type the company code to confirm.';
  end if;
  if p_passenger is not null and not exists (
    select 1 from passengers where id = p_passenger and company_id = p_company
  ) then
    raise exception 'Passenger not found in this company.';
  end if;

  perform pg_advisory_xact_lock(hashtext('pax_wipe_' || p_company::text));

  v_id := case when p_passenger is null then null else (
    select nullif(btrim(id_number), '') from passengers where id = p_passenger and company_id = p_company
  ) end;

  update invoices
     set customer_name = 'Removed',
         customer_email = null,
         customer_phone = null,
         passenger_id = null,
         updated_at = now()
   where company_id = p_company
     and passenger_id is not null
     and (p_passenger is null or passenger_id = p_passenger);
  get diagnostics n_inv = row_count;

  delete from booking_passengers
   where company_id = p_company
     and (
       p_passenger is null
       or passenger_id = p_passenger
       or (v_id is not null and id_number is not null and lower(id_number) = lower(v_id))
     );
  get diagnostics n_lines = row_count;

  if p_passenger is null then
    update bookings
       set contact_name = null,
           contact_phone = null,
           contact_email = null,
           updated_at = now()
     where company_id = p_company
       and (contact_name is not null or contact_phone is not null or contact_email is not null);
  end if;

  delete from passengers
   where company_id = p_company
     and (p_passenger is null or id = p_passenger);
  get diagnostics n_pax = row_count;

  insert into platform_audit (actor, action, company_id, detail)
  values (auth.uid(), 'delete_passengers', p_company,
          n_pax || ' passenger record(s), ' || n_lines || ' booking line(s), ' || n_inv || ' invoice(s)');

  return jsonb_build_object('passengers', n_pax, 'booking_lines', n_lines, 'invoices', n_inv);
end $$;

revoke execute on function platform_delete_passengers(uuid, text, uuid) from anon, public;
grant execute on function platform_delete_passengers(uuid, text, uuid) to authenticated;
