-- Maintenance round 2 (plan priority 4): spare parts catalogue, stock per store location, stock movements, parts issued to and
-- returned from work orders (parts cost on the job is calculated from them), low-stock alerts, suppliers, purchase requests with
-- approval, purchase orders with delivery and supplier invoice. Uses Spare Parts Categories and Units of Measurement (10_).
-- Maintenance staff (is_company_maint) manage it; the person assigned a work order may draw parts for it and ask for parts.

-- 1. Suppliers.
create table suppliers (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 2 and 120),
  contact    text check (contact is null or char_length(contact) <= 120),
  phone      text check (phone is null or char_length(phone) <= 40),
  email      text check (email is null or char_length(email) <= 120),
  address    text check (address is null or char_length(address) <= 300),
  note       text check (note is null or char_length(note) <= 500),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index on suppliers (company_id);
alter table suppliers enable row level security;
create policy sup_select on suppliers for select to authenticated using (is_company_member(company_id));
create policy sup_insert on suppliers for insert to authenticated with check (is_company_maint(company_id));
create policy sup_update on suppliers for update to authenticated using (is_company_maint(company_id)) with check (is_company_maint(company_id));
create policy sup_delete on suppliers for delete to authenticated using (is_company_maint(company_id));
create trigger sup_subscription before insert or update or delete on suppliers for each row execute function reject_if_subscription_expired();

-- 2. Parts catalogue. Stock is kept per store location in part_stock and only changes through stock_move().
create table parts (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  part_no      text not null check (char_length(btrim(part_no)) between 1 and 60),
  name         text not null check (char_length(btrim(name)) between 2 and 160),
  category     text check (category is null or char_length(category) <= 60),
  unit         text not null default 'Each' check (char_length(unit) between 1 and 30),
  make         text check (make is null or char_length(make) <= 80),
  fits_vessels uuid[] not null default '{}',
  fits_kinds   text[] not null default '{}',
  fits_note    text check (fits_note is null or char_length(fits_note) <= 300),
  min_stock    numeric(12, 2) not null default 0 check (min_stock >= 0),
  reorder_qty  numeric(12, 2) check (reorder_qty is null or reorder_qty > 0),
  location     text check (location is null or char_length(location) <= 80),
  supplier_id  uuid references suppliers(id) on delete set null,
  price        numeric(12, 2) not null default 0 check (price >= 0),
  active       boolean not null default true,
  note         text check (note is null or char_length(note) <= 500),
  created_at   timestamptz not null default now(),
  unique (company_id, part_no)
);
create index on parts (company_id);
alter table parts enable row level security;
create policy par_select on parts for select to authenticated using (is_company_member(company_id));
create policy par_insert on parts for insert to authenticated with check (is_company_maint(company_id));
create policy par_update on parts for update to authenticated using (is_company_maint(company_id)) with check (is_company_maint(company_id));
create policy par_delete on parts for delete to authenticated using (is_company_maint(company_id));
create trigger par_subscription before insert or update or delete on parts for each row execute function reject_if_subscription_expired();

create table part_stock (
  part_id    uuid not null references parts(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  location   text not null check (char_length(btrim(location)) between 1 and 80),
  qty        numeric(12, 2) not null default 0 check (qty >= 0),
  updated_at timestamptz not null default now(),
  primary key (part_id, location)
);
create index on part_stock (company_id);
alter table part_stock enable row level security;
create policy pst_select on part_stock for select to authenticated using (is_company_member(company_id));

create table stock_moves (
  id            bigint generated always as identity primary key,
  company_id    uuid not null references companies(id) on delete cascade,
  part_id       uuid not null references parts(id) on delete cascade,
  location      text not null,
  qty           numeric(12, 2) not null check (qty <> 0),   -- + into the store, - out of it
  kind          text not null check (kind in ('Opening', 'Received', 'Issued', 'Returned', 'Adjusted', 'Transfer')),
  work_order_id uuid references work_orders(id) on delete set null,
  po_id         uuid,
  unit_cost     numeric(12, 2) not null default 0,
  note          text check (note is null or char_length(note) <= 300),
  actor         uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index on stock_moves (part_id, created_at desc);
create index on stock_moves (work_order_id);
create index on stock_moves (company_id, created_at desc);
alter table stock_moves enable row level security;
create policy smv_select on stock_moves for select to authenticated using (is_company_member(company_id));

create function part_total(p_part uuid) returns numeric
  language sql stable security definer set search_path = public as
$$ select coalesce(sum(qty), 0) from part_stock where part_id = p_part $$;
revoke execute on function part_total(uuid) from anon, public;
grant execute on function part_total(uuid) to authenticated;

-- The only way stock changes. Sends a low-stock alert when a part drops to or below its minimum.
create function stock_move(p_part uuid, p_location text, p_qty numeric, p_kind text, p_wo uuid, p_po uuid, p_cost numeric, p_note text) returns bigint
  language plpgsql security definer set search_path = public as
$$ declare p parts; before numeric; after numeric; have numeric; mid bigint; loc text := btrim(coalesce(p_location, ''));
begin
  select * into p from parts where id = p_part;
  if not found then raise exception 'Part not found.'; end if;
  if loc = '' then raise exception 'Choose the store location.'; end if;
  if coalesce(p_qty, 0) = 0 then raise exception 'Enter a quantity.'; end if;
  before := part_total(p_part);
  select qty into have from part_stock where part_id = p_part and location = loc for update;
  if coalesce(have, 0) + p_qty < 0 then
    raise exception 'Only % % of % in %.', trim(to_char(coalesce(have, 0), 'FM999999990.##')), p.unit, p.part_no, loc;
  end if;
  -- Update first: an upsert would check the (negative) insert row against qty >= 0 before resolving the conflict.
  update part_stock set qty = qty + p_qty, updated_at = now() where part_id = p_part and location = loc;
  if not found then insert into part_stock (part_id, company_id, location, qty) values (p_part, p.company_id, loc, p_qty); end if;
  insert into stock_moves (company_id, part_id, location, qty, kind, work_order_id, po_id, unit_cost, note, actor)
    values (p.company_id, p_part, loc, p_qty, p_kind, p_wo, p_po, coalesce(p_cost, p.price, 0), nullif(left(btrim(p_note), 300), ''), auth.uid()) returning id into mid;
  after := part_total(p_part);
  if p.active and p.min_stock > 0 and after <= p.min_stock and before > p.min_stock then
    perform notify_many(p.company_id, maint_user_ids(p.company_id), 'low_stock', 'm' || mid, 'part', p.id::text,
      'Low stock: ' || p.part_no || ' ' || p.name, trim(to_char(after, 'FM999999990.##')) || ' ' || p.unit || ' left, minimum ' || trim(to_char(p.min_stock, 'FM999999990.##')));
  end if;
  return mid;
end $$;
revoke execute on function stock_move(uuid, text, numeric, text, uuid, uuid, numeric, text) from anon, public, authenticated;

-- Opening stock, counts and transfers by maintenance staff.
create function adjust_stock(p_part uuid, p_location text, p_qty numeric, p_kind text, p_note text, p_to text default null) returns void
  language plpgsql security definer set search_path = public as
$$ declare p parts;
begin
  select * into p from parts where id = p_part;
  if not found or not is_company_maint(p.company_id) then raise exception 'Only maintenance staff can change stock.'; end if;
  if p_kind = 'Transfer' then
    if coalesce(p_qty, 0) <= 0 then raise exception 'Enter how many to move.'; end if;
    if btrim(coalesce(p_to, '')) = '' or btrim(p_to) = btrim(p_location) then raise exception 'Choose a different location to move to.'; end if;
    perform stock_move(p_part, p_location, -p_qty, 'Transfer', null, null, null, coalesce(nullif(btrim(p_note), ''), 'Moved to ' || btrim(p_to)));
    perform stock_move(p_part, p_to, p_qty, 'Transfer', null, null, null, coalesce(nullif(btrim(p_note), ''), 'Moved from ' || btrim(p_location)));
  elsif p_kind in ('Opening', 'Adjusted', 'Received') then
    if p_kind = 'Adjusted' and coalesce(char_length(btrim(p_note)), 0) < 2 then raise exception 'Say why the stock is being corrected.'; end if;
    perform stock_move(p_part, p_location, p_qty, p_kind, null, null, null, p_note);
  else raise exception 'Unknown stock change.'; end if;
end $$;
revoke execute on function adjust_stock(uuid, text, numeric, text, text, text) from anon, public;
grant execute on function adjust_stock(uuid, text, numeric, text, text, text) to authenticated;

-- 3. Parts on work orders. Issuing takes stock out; returning puts unused parts back. The job's parts cost follows.
create function wo_parts_cost(p_wo uuid) returns numeric
  language sql stable security definer set search_path = public as
$$ select coalesce(round(sum(-qty * unit_cost), 2), 0) from stock_moves where work_order_id = p_wo and kind in ('Issued', 'Returned') $$;
revoke execute on function wo_parts_cost(uuid) from anon, public;
grant execute on function wo_parts_cost(uuid) to authenticated;

create function wo_issue_part(p_wo uuid, p_part uuid, p_location text, p_qty numeric, p_return boolean default false, p_note text default null) returns numeric
  language plpgsql security definer set search_path = public as
$$ declare w work_orders; p parts; out_now numeric; c numeric;
begin
  select * into w from work_orders where id = p_wo;
  if not found then raise exception 'Work order not found.'; end if;
  if not (is_company_maint(w.company_id) or w.assignee = auth.uid()) then raise exception 'Only the person assigned or maintenance staff can take parts for this job.'; end if;
  if w.status in ('Completed', 'Closed') then raise exception 'This job is %.', lower(w.status); end if;
  select * into p from parts where id = p_part and company_id = w.company_id;
  if not found then raise exception 'Part not found.'; end if;
  if coalesce(p_qty, 0) <= 0 then raise exception 'Enter a quantity.'; end if;
  if p_return then
    select coalesce(sum(-qty), 0) into out_now from stock_moves where work_order_id = p_wo and part_id = p_part and kind in ('Issued', 'Returned');
    if p_qty > out_now then raise exception 'Only % % of % was issued to this job.', trim(to_char(out_now, 'FM999999990.##')), p.unit, p.part_no; end if;
    -- Returned at the average cost it went out at.
    select coalesce(sum(-qty * unit_cost) / nullif(sum(-qty), 0), p.price) into c from stock_moves where work_order_id = p_wo and part_id = p_part and kind = 'Issued';
    perform stock_move(p_part, p_location, p_qty, 'Returned', p_wo, null, c, coalesce(p_note, 'Returned from ' || w.code));
  else
    perform stock_move(p_part, p_location, -p_qty, 'Issued', p_wo, null, p.price, coalesce(p_note, 'Issued to ' || w.code));
  end if;
  update work_orders set cost_parts = wo_parts_cost(p_wo) where id = p_wo;
  perform maint_log(w.company_id, w.vessel_id, 'work_order', w.id, w.code || ': ' || case when p_return then 'returned ' else 'issued ' end
    || trim(to_char(p_qty, 'FM999999990.##')) || ' ' || p.unit || ' ' || p.part_no || ' ' || p.name);
  return wo_parts_cost(p_wo);
end $$;
revoke execute on function wo_issue_part(uuid, uuid, text, numeric, boolean, text) from anon, public;
grant execute on function wo_issue_part(uuid, uuid, text, numeric, boolean, text) to authenticated;

-- Parts cost on a job that has stock issued is calculated, so wo_progress keeps it.
create or replace function wo_progress(p_id uuid, p_patch jsonb) returns work_orders
  language plpgsql security definer set search_path = public as
$$ declare w work_orders; issued boolean;
begin
  select * into w from work_orders where id = p_id;
  if not found then raise exception 'Work order not found.'; end if;
  if not (is_company_maint(w.company_id) or w.assignee = auth.uid()) then raise exception 'Only the person assigned or maintenance staff can update this job.'; end if;
  if w.status in ('Awaiting approval', 'Completed', 'Closed') then raise exception 'This job is %.', lower(w.status); end if;
  if p_patch ? 'status' and p_patch->>'status' not in ('Assigned', 'In progress', 'Awaiting parts') then raise exception 'Use Complete to finish the job.'; end if;
  issued := exists (select 1 from stock_moves where work_order_id = p_id and kind in ('Issued', 'Returned'));
  update work_orders set
    status = coalesce(nullif(p_patch->>'status', ''), status),
    labour_hours = case when p_patch ? 'labour_hours' then nullif(p_patch->>'labour_hours', '')::numeric else labour_hours end,
    parts_used = case when p_patch ? 'parts_used' then nullif(btrim(p_patch->>'parts_used'), '') else parts_used end,
    work_done = case when p_patch ? 'work_done' then nullif(btrim(p_patch->>'work_done'), '') else work_done end,
    cost_labour = case when p_patch ? 'cost_labour' then nullif(p_patch->>'cost_labour', '')::numeric else cost_labour end,
    cost_parts = case when issued then wo_parts_cost(p_id) when p_patch ? 'cost_parts' then nullif(p_patch->>'cost_parts', '')::numeric else cost_parts end,
    cost_other = case when p_patch ? 'cost_other' then nullif(p_patch->>'cost_other', '')::numeric else cost_other end
    where id = p_id returning * into w;
  return w;
end $$;

-- 4. Purchase requests (ask to buy) → approval → purchase order → delivery into stock → supplier invoice.
create function purch_code(p_prefix text, p_n int) returns text
  language sql stable as $$ select p_prefix || '-' || to_char(current_date, 'YYYY') || '-' || lpad(p_n::text, 4, '0') $$;

create table purchase_requests (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  number        integer not null,
  code          text not null,
  status        text not null default 'Waiting' check (status in ('Waiting', 'Approved', 'Rejected', 'Ordered', 'Cancelled')),
  work_order_id uuid references work_orders(id) on delete set null,
  vessel_id     uuid references vessels(id) on delete set null,
  priority      text not null default 'Medium' check (priority in ('Critical', 'High', 'Medium', 'Low')),
  needed_by     date,
  reason        text check (reason is null or char_length(reason) <= 1000),
  supplier_id   uuid references suppliers(id) on delete set null,
  lines         jsonb not null default '[]',   -- [{part_id, description, qty, unit, price}]
  estimate      numeric(12, 2) not null default 0,
  requested_by  uuid references auth.users(id) on delete set null,
  requested_at  timestamptz not null default now(),
  decided_by    uuid references auth.users(id) on delete set null,
  decided_at    timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 300),
  po_id         uuid,
  unique (company_id, number)
);
create index on purchase_requests (company_id, status);
alter table purchase_requests enable row level security;
create policy prq_select on purchase_requests for select to authenticated using (is_company_maint(company_id) or requested_by = auth.uid());
create trigger prq_subscription before insert or update or delete on purchase_requests for each row execute function reject_if_subscription_expired();

create table purchase_orders (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies(id) on delete cascade,
  number         integer not null,
  code           text not null,
  status         text not null default 'Draft' check (status in ('Draft', 'Ordered', 'Part delivered', 'Delivered', 'Cancelled')),
  supplier_id    uuid references suppliers(id) on delete set null,
  request_id     uuid references purchase_requests(id) on delete set null,
  work_order_id  uuid references work_orders(id) on delete set null,
  lines          jsonb not null default '[]',   -- [{part_id, description, qty, unit, price, received}]
  total          numeric(12, 2) not null default 0,
  deliver_to     text check (deliver_to is null or char_length(deliver_to) <= 80),
  ordered_on     date,
  expected_on    date,
  delivered_on   date,
  supplier_ref   text check (supplier_ref is null or char_length(supplier_ref) <= 80),
  invoice_no     text check (invoice_no is null or char_length(invoice_no) <= 80),
  invoice_date   date,
  invoice_amount numeric(12, 2) check (invoice_amount is null or invoice_amount >= 0),
  invoice_status text not null default 'Not received' check (invoice_status in ('Not received', 'Received', 'Paid')),
  note           text check (note is null or char_length(note) <= 1000),
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (company_id, number)
);
create index on purchase_orders (company_id, status);
alter table purchase_orders enable row level security;
create policy pod_select on purchase_orders for select to authenticated using (is_company_maint(company_id));
create trigger pod_subscription before insert or update or delete on purchase_orders for each row execute function reject_if_subscription_expired();

-- Clean lines: [{part_id?, description, qty>0, unit, price>=0}], at most 60.
create function purch_lines(p_company uuid, p_lines jsonb, p_keep_received boolean default false) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare l jsonb; out jsonb := '[]'; p parts; q numeric; pr numeric;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Add at least one item.'; end if;
  if jsonb_array_length(p_lines) > 60 then raise exception 'Too many items (60 at most).'; end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    p := null;
    if nullif(l->>'part_id', '') is not null then
      select * into p from parts where id = (l->>'part_id')::uuid and company_id = p_company;
      if not found then raise exception 'A part on this list was not found.'; end if;
    end if;
    q := nullif(l->>'qty', '')::numeric; pr := coalesce(nullif(l->>'price', '')::numeric, p.price, 0);
    if q is null or q <= 0 then raise exception 'Every item needs a quantity.'; end if;
    if pr < 0 then raise exception 'Prices cannot be negative.'; end if;
    if p.id is null and char_length(btrim(coalesce(l->>'description', ''))) < 2 then raise exception 'Describe each item that is not in the parts list.'; end if;
    out := out || jsonb_build_array(jsonb_build_object('part_id', p.id, 'part_no', p.part_no,
      'description', left(coalesce(nullif(btrim(l->>'description'), ''), p.name), 160), 'qty', q,
      'unit', left(coalesce(nullif(l->>'unit', ''), p.unit, 'Each'), 30), 'price', round(pr, 2),
      'received', case when p_keep_received then least(coalesce(nullif(l->>'received', '')::numeric, 0), q) else 0 end));
  end loop;
  return out;
end $$;
revoke execute on function purch_lines(uuid, jsonb, boolean) from anon, public, authenticated;

create function lines_total(p_lines jsonb) returns numeric
  language sql immutable as $$ select coalesce(round(sum((x->>'qty')::numeric * (x->>'price')::numeric), 2), 0) from jsonb_array_elements(p_lines) x $$;

create function request_parts(p_company uuid, p_row jsonb) returns purchase_requests
  language plpgsql security definer set search_path = public as
$$ declare n int; r purchase_requests; w work_orders; ln jsonb; cfg jsonb; ok boolean;
begin
  if nullif(p_row->>'work_order_id', '') is not null then
    select * into w from work_orders where id = (p_row->>'work_order_id')::uuid and company_id = p_company;
    if not found then raise exception 'Work order not found.'; end if;
  end if;
  if not (is_company_maint(p_company) or (w.id is not null and w.assignee = auth.uid())) then
    raise exception 'Only maintenance staff, or the person assigned the job, can ask for parts.';
  end if;
  ln := purch_lines(p_company, p_row->'lines');
  perform pg_advisory_xact_lock(hashtext('prq_' || p_company::text));
  select coalesce(max(number), 0) + 1 into n from purchase_requests where company_id = p_company;
  select coalesce(settings->'10_maintenance_approval_rules', '{}'::jsonb) into cfg from companies where id = p_company;
  ok := not coalesce((cfg->>'enabled')::boolean, true);   -- approval turned off: approved straight away
  insert into purchase_requests (company_id, number, code, status, work_order_id, vessel_id, priority, needed_by, reason, supplier_id, lines, estimate, requested_by,
      decided_by, decided_at)
    values (p_company, n, purch_code('PR', n), case when ok then 'Approved' else 'Waiting' end, w.id, coalesce(w.vessel_id, nullif(p_row->>'vessel_id', '')::uuid),
      coalesce(nullif(p_row->>'priority', ''), w.priority, 'Medium'), nullif(p_row->>'needed_by', '')::date, nullif(left(btrim(p_row->>'reason'), 1000), ''),
      (select id from suppliers where id = nullif(p_row->>'supplier_id', '')::uuid and company_id = p_company), ln, lines_total(ln), auth.uid(),
      case when ok then auth.uid() end, case when ok then now() end)
    returning * into r;
  if w.id is not null then
    if w.status in ('Open', 'Assigned', 'In progress') then update work_orders set status = 'Awaiting parts' where id = w.id; end if;
    perform maint_log(p_company, w.vessel_id, 'work_order', w.id, w.code || ': parts requested on ' || r.code);
  end if;
  if not ok then
    perform notify_many(p_company, (select coalesce(array_agg(u), '{}') from unnest(maint_user_ids(p_company)) u where u <> auth.uid()), 'purchase_request', 'new', 'purchase_request', r.id::text,
      r.code || ' needs approval', jsonb_array_length(ln) || ' item' || case when jsonb_array_length(ln) > 1 then 's' else '' end || ' · ' || coalesce(w.code, 'stock') || coalesce(' · ' || r.reason, ''));
  end if;
  return r;
end $$;
revoke execute on function request_parts(uuid, jsonb) from anon, public;
grant execute on function request_parts(uuid, jsonb) to authenticated;

create function decide_purchase_request(p_id uuid, p_ok boolean, p_note text default null) returns purchase_requests
  language plpgsql security definer set search_path = public as
$$ declare r purchase_requests; cfg jsonb;
begin
  select * into r from purchase_requests where id = p_id;
  if not found then raise exception 'Request not found.'; end if;
  if not is_maint_approver(r.company_id) then raise exception 'Only maintenance approvers can approve purchase requests.'; end if;
  if r.status <> 'Waiting' then raise exception 'This request is already %.', lower(r.status); end if;
  select coalesce(settings->'10_maintenance_approval_rules', '{}'::jsonb) into cfg from companies where id = r.company_id;
  if not coalesce((cfg->>'self')::boolean, false) and r.requested_by = auth.uid() and not is_platform_admin() then
    raise exception 'Someone else must approve a request you made yourself.';
  end if;
  if (not p_ok or coalesce((cfg->>'comment')::boolean, false)) and coalesce(char_length(btrim(p_note)), 0) < 2 then
    raise exception '%', case when p_ok then 'A comment is required.' else 'Say why it is turned down.' end;
  end if;
  update purchase_requests set status = case when p_ok then 'Approved' else 'Rejected' end, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(p_note), '')
    where id = p_id returning * into r;
  perform notify_user(r.company_id, r.requested_by, 'purchase_request', 'decided', 'purchase_request', r.id::text,
    r.code || case when p_ok then ' approved' else ' turned down' end, coalesce(nullif(btrim(p_note), ''), 'Your request for parts'));
  return r;
end $$;
revoke execute on function decide_purchase_request(uuid, boolean, text) from anon, public;
grant execute on function decide_purchase_request(uuid, boolean, text) to authenticated;

create function cancel_purchase_request(p_id uuid) returns void
  language plpgsql security definer set search_path = public as
$$ declare r purchase_requests;
begin
  select * into r from purchase_requests where id = p_id;
  if not found or not (is_company_maint(r.company_id) or r.requested_by = auth.uid()) then raise exception 'Request not found.'; end if;
  if r.status not in ('Waiting', 'Approved') then raise exception 'This request is already %.', lower(r.status); end if;
  update purchase_requests set status = 'Cancelled' where id = p_id;
end $$;
revoke execute on function cancel_purchase_request(uuid) from anon, public;
grant execute on function cancel_purchase_request(uuid) to authenticated;

-- Create or edit a purchase order. From an approved request it copies the items. Lines can change until goods arrive.
create function save_purchase_order(p_company uuid, p_id uuid, p_row jsonb) returns purchase_orders
  language plpgsql security definer set search_path = public as
$$ declare o purchase_orders; r purchase_requests; n int; ln jsonb; st text;
begin
  if not is_company_maint(p_company) then raise exception 'Only maintenance staff can raise purchase orders.'; end if;
  if p_id is not null then
    select * into o from purchase_orders where id = p_id and company_id = p_company;
    if not found then raise exception 'Order not found.'; end if;
  end if;
  if p_id is null and nullif(p_row->>'request_id', '') is not null then
    select * into r from purchase_requests where id = (p_row->>'request_id')::uuid and company_id = p_company for update;
    if not found then raise exception 'Request not found.'; end if;
    if r.status <> 'Approved' then raise exception 'Only approved requests can be ordered (this one is %).', lower(r.status); end if;
  end if;
  st := coalesce(nullif(p_row->>'status', ''), o.status, 'Draft');
  if st not in ('Draft', 'Ordered', 'Cancelled') and st is distinct from o.status then raise exception 'Use Receive delivery to record goods arriving.'; end if;
  if o.id is not null and o.status in ('Part delivered', 'Delivered') then
    ln := o.lines;   -- items are fixed once goods have arrived
    if st = 'Cancelled' then raise exception 'Goods have already arrived on this order.'; end if;
  else
    ln := purch_lines(p_company, coalesce(p_row->'lines', r.lines, o.lines), false);
  end if;
  if p_id is null then
    perform pg_advisory_xact_lock(hashtext('pod_' || p_company::text));
    select coalesce(max(number), 0) + 1 into n from purchase_orders where company_id = p_company;
    insert into purchase_orders (company_id, number, code, status, supplier_id, request_id, work_order_id, lines, total, deliver_to, ordered_on, expected_on, supplier_ref, note, created_by)
      values (p_company, n, purch_code('PO', n), st,
        (select id from suppliers where id = coalesce(nullif(p_row->>'supplier_id', '')::uuid, r.supplier_id) and company_id = p_company),
        r.id, coalesce(nullif(p_row->>'work_order_id', '')::uuid, r.work_order_id), ln, lines_total(ln), nullif(btrim(p_row->>'deliver_to'), ''),
        case when st = 'Ordered' then coalesce(nullif(p_row->>'ordered_on', '')::date, current_date) end, nullif(p_row->>'expected_on', '')::date,
        nullif(btrim(p_row->>'supplier_ref'), ''), nullif(left(btrim(p_row->>'note'), 1000), ''), auth.uid())
      returning * into o;
    if r.id is not null then update purchase_requests set status = 'Ordered', po_id = o.id where id = r.id; end if;
  else
    update purchase_orders set status = st, lines = ln, total = lines_total(ln),
      supplier_id = case when p_row ? 'supplier_id' then (select id from suppliers where id = nullif(p_row->>'supplier_id', '')::uuid and company_id = p_company) else supplier_id end,
      deliver_to = case when p_row ? 'deliver_to' then nullif(btrim(p_row->>'deliver_to'), '') else deliver_to end,
      ordered_on = case when st = 'Ordered' and ordered_on is null then coalesce(nullif(p_row->>'ordered_on', '')::date, current_date) when p_row ? 'ordered_on' then nullif(p_row->>'ordered_on', '')::date else ordered_on end,
      expected_on = case when p_row ? 'expected_on' then nullif(p_row->>'expected_on', '')::date else expected_on end,
      supplier_ref = case when p_row ? 'supplier_ref' then nullif(btrim(p_row->>'supplier_ref'), '') else supplier_ref end,
      invoice_no = case when p_row ? 'invoice_no' then nullif(btrim(p_row->>'invoice_no'), '') else invoice_no end,
      invoice_date = case when p_row ? 'invoice_date' then nullif(p_row->>'invoice_date', '')::date else invoice_date end,
      invoice_amount = case when p_row ? 'invoice_amount' then nullif(p_row->>'invoice_amount', '')::numeric else invoice_amount end,
      invoice_status = coalesce(nullif(p_row->>'invoice_status', ''), invoice_status),
      note = case when p_row ? 'note' then nullif(left(btrim(p_row->>'note'), 1000), '') else note end, updated_at = now()
      where id = p_id returning * into o;
    if st = 'Cancelled' and o.request_id is not null then update purchase_requests set status = 'Approved', po_id = null where id = o.request_id and po_id = o.id; end if;
  end if;
  return o;
end $$;
revoke execute on function save_purchase_order(uuid, uuid, jsonb) from anon, public;
grant execute on function save_purchase_order(uuid, uuid, jsonb) to authenticated;

-- Goods arriving: [{i: line index, qty}] into a store location. Parts go into stock at the order price (and update the part price);
-- items not in the parts list are just marked received. Telling the person who asked, and the work order's assignee.
create function receive_purchase_order(p_id uuid, p_items jsonb, p_location text, p_note text default null) returns purchase_orders
  language plpgsql security definer set search_path = public as
$$ declare o purchase_orders; it jsonb; i int; q numeric; l jsonb; ln jsonb; got int := 0; all_in boolean := true; r purchase_requests; w work_orders;
begin
  select * into o from purchase_orders where id = p_id for update;
  if not found or not is_company_maint(o.company_id) then raise exception 'Order not found.'; end if;
  if o.status not in ('Ordered', 'Part delivered') then raise exception 'Mark the order as sent to the supplier first.'; end if;
  ln := o.lines;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    i := (it->>'i')::int; q := nullif(it->>'qty', '')::numeric;
    if q is null or q = 0 then continue; end if;
    if q < 0 then raise exception 'Quantities cannot be negative.'; end if;
    l := ln->i;
    if l is null then raise exception 'Unknown line on the order.'; end if;
    if (l->>'received')::numeric + q > (l->>'qty')::numeric then
      raise exception 'More than ordered for %: % ordered, % already in.', l->>'description', l->>'qty', l->>'received';
    end if;
    if nullif(l->>'part_id', '') is not null then
      perform stock_move((l->>'part_id')::uuid, coalesce(nullif(btrim(p_location), ''), o.deliver_to), q, 'Received', o.work_order_id, o.id, (l->>'price')::numeric, coalesce(nullif(btrim(p_note), ''), 'Delivered on ' || o.code));
      update parts set price = (l->>'price')::numeric, supplier_id = coalesce(o.supplier_id, supplier_id) where id = (l->>'part_id')::uuid and (l->>'price')::numeric > 0;
    end if;
    ln := jsonb_set(ln, array[i::text, 'received'], to_jsonb((l->>'received')::numeric + q));
    got := got + 1;
  end loop;
  if got = 0 then raise exception 'Enter how many arrived.'; end if;
  select bool_and((x->>'received')::numeric >= (x->>'qty')::numeric) into all_in from jsonb_array_elements(ln) x;
  update purchase_orders set lines = ln, status = case when all_in then 'Delivered' else 'Part delivered' end, delivered_on = case when all_in then current_date else delivered_on end,
    deliver_to = coalesce(deliver_to, nullif(btrim(p_location), '')), updated_at = now() where id = p_id returning * into o;
  if o.request_id is not null then select * into r from purchase_requests where id = o.request_id; end if;
  if o.work_order_id is not null then select * into w from work_orders where id = o.work_order_id; end if;
  perform notify_many(o.company_id, array_remove(array[r.requested_by, w.assignee], auth.uid()), 'purchase_order', 'in' || to_char(now(), 'YYYYMMDDHH24MISS'), 'purchase_order', o.id::text,
    o.code || case when all_in then ' delivered' else ' partly delivered' end, coalesce(w.code || ' · ', '') || 'Parts are in ' || coalesce(nullif(btrim(p_location), ''), o.deliver_to, 'the store'));
  if w.id is not null then perform maint_log(o.company_id, w.vessel_id, 'work_order', w.id, w.code || ': parts delivered on ' || o.code); end if;
  return o;
end $$;
revoke execute on function receive_purchase_order(uuid, jsonb, text, text) from anon, public;
grant execute on function receive_purchase_order(uuid, jsonb, text, text) to authenticated;

-- 5. Low-stock reminder once a day on opening Maintenance, for parts at or below their minimum with nothing on order.
create function scan_low_stock(p_company uuid) returns integer
  language plpgsql security definer set search_path = public as
$$ declare p record; n int := 0; who uuid[];
begin
  if not is_company_member(p_company) then return 0; end if;
  who := maint_user_ids(p_company);
  for p in select pa.id, pa.part_no, pa.name, pa.unit, pa.min_stock, part_total(pa.id) have from parts pa
           where pa.company_id = p_company and pa.active and pa.min_stock > 0 and part_total(pa.id) <= pa.min_stock
             and not exists (select 1 from purchase_orders o, jsonb_array_elements(o.lines) x where o.company_id = p_company and o.status in ('Draft', 'Ordered', 'Part delivered') and x->>'part_id' = pa.id::text)
             and not exists (select 1 from purchase_requests r, jsonb_array_elements(r.lines) x where r.company_id = p_company and r.status in ('Waiting', 'Approved') and x->>'part_id' = pa.id::text) loop
    n := n + notify_many(p_company, who, 'low_stock', 'd' || to_char(current_date, 'YYYYMMDD'), 'part', p.id::text, 'Low stock: ' || p.part_no || ' ' || p.name,
      trim(to_char(p.have, 'FM999999990.##')) || ' ' || p.unit || ' left, minimum ' || trim(to_char(p.min_stock, 'FM999999990.##')) || '. Nothing on order.');
  end loop;
  return n;
end $$;
revoke execute on function scan_low_stock(uuid) from anon, public;
grant execute on function scan_low_stock(uuid) to authenticated;

-- 6. Supplier invoices and delivery notes can be attached to purchase orders; part photos and data sheets to parts.
alter table maint_files drop constraint if exists maint_files_ref_type_check;
alter table maint_files add constraint maint_files_ref_type_check check (ref_type in ('vessel', 'component', 'work_order', 'defect', 'part', 'purchase_order'));
