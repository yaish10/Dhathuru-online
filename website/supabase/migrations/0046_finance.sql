-- Finance: one ledger (finance_entries) that fills itself from the rest of VEYORA, invoices, and one call for the page.
--  * finance_entries: Revenue / Expense / Refund lines. Rows with source 'Manual' are typed in by staff; the others are
--    kept in step automatically (one row per source record):
--      Booking     → Revenue  = bookings.paid_amount          (category "Passenger tickets", route/vessel/trip from the trip)
--      Refund      → Refund   = bookings.refund_amount once payment_status is 'Refunded'
--      Invoice     → Revenue  = invoices.amount_paid          (category from invoices.category, default "Other income")
--      Payroll     → Expense  = payroll_runs.employer_cost (else gross) once the run is 'Paid'   (category "Salaries")
--      Maintenance → Expense  = work order labour + parts + other + contractor once 'Completed'/'Closed' (category "Maintenance")
--    Parts bought on purchase orders are not added separately (they reach the ledger through the work orders that use them).
--  * invoices: numbered from 9_invoice_number_format, totals and tax (9_tax_configuration) worked out on save, status
--    follows payments (Draft / Sent / Partly paid / Paid / Void; Overdue is shown when due_on has passed).
--  * finance_summary(p_company, p_from, p_to): KPIs (with the previous period), daily series, revenue by route,
--    expenses by category, recent entries.
-- Who: owners, admins and Operations (is_company_finance). Built to extend: meta jsonb, categories are free text from settings.

create or replace function is_company_finance(cid uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select is_company_ops(cid) $$;
revoke execute on function is_company_finance(uuid) from anon, public;
grant execute on function is_company_finance(uuid) to authenticated;

-- 1. Invoices
create table invoices (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  number        integer,
  code          text,
  customer_name text not null check (char_length(btrim(customer_name)) between 1 and 160),
  customer_email text check (customer_email is null or char_length(customer_email) <= 200),
  customer_phone text check (customer_phone is null or char_length(customer_phone) <= 40),
  passenger_id  uuid references passengers(id) on delete set null,
  booking_id    uuid references bookings(id) on delete set null,
  category      text not null default 'Other income' check (char_length(btrim(category)) between 1 and 60),
  issue_date    date not null default current_date,
  due_on        date,
  items         jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and pg_column_size(items) <= 50000),
  subtotal      numeric(14, 2) not null default 0,
  tax           numeric(14, 2) not null default 0,
  total         numeric(14, 2) not null default 0,
  amount_paid   numeric(14, 2) not null default 0 check (amount_paid >= 0),
  currency      text not null default 'MVR',
  status        text not null default 'Draft' check (status in ('Draft', 'Sent', 'Partly paid', 'Paid', 'Void')),
  payment_method text,
  note          text check (note is null or char_length(note) <= 1000),
  meta          jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 16384),
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, number),
  check (due_on is null or due_on >= issue_date)
);
create index on invoices (company_id, status);
alter table invoices enable row level security;
create policy inv_select on invoices for select to authenticated using (is_company_finance(company_id));
create policy inv_insert on invoices for insert to authenticated with check (is_company_finance(company_id));
create policy inv_update on invoices for update to authenticated using (is_company_finance(company_id)) with check (is_company_finance(company_id));
create policy inv_delete on invoices for delete to authenticated using (is_company_finance(company_id) and status = 'Draft');
create trigger inv_subscription before insert or update or delete on invoices for each row execute function reject_if_subscription_expired();

-- 2. Ledger
create table finance_entries (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies(id) on delete cascade,
  entry_date     date not null default current_date,
  kind           text not null check (kind in ('Revenue', 'Expense', 'Refund')),
  amount         numeric(14, 2) not null check (amount > 0),
  currency       text not null default 'MVR',
  category       text not null default 'Other' check (char_length(btrim(category)) between 1 and 60),
  description    text check (description is null or char_length(description) <= 300),
  payment_method text check (payment_method is null or char_length(payment_method) <= 60),
  route_id       uuid references routes(id) on delete set null,
  vessel_id      uuid references vessels(id) on delete set null,
  trip_id        uuid references trips(id) on delete set null,
  booking_id     uuid references bookings(id) on delete set null,
  invoice_id     uuid references invoices(id) on delete set null,
  source         text not null default 'Manual' check (source in ('Manual', 'Booking', 'Refund', 'Invoice', 'Payroll', 'Maintenance')),
  source_ref     uuid,
  meta           jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 16384),
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (source = 'Manual' or source_ref is not null)
);
create unique index finance_entries_source_key on finance_entries (company_id, source, source_ref) where source <> 'Manual';
create index on finance_entries (company_id, entry_date);
alter table finance_entries enable row level security;
create policy fin_select on finance_entries for select to authenticated using (is_company_finance(company_id));
-- Staff only add, change and remove their own typed-in lines; automatic lines follow their source.
create policy fin_insert on finance_entries for insert to authenticated with check (is_company_finance(company_id) and source = 'Manual');
create policy fin_update on finance_entries for update to authenticated using (is_company_finance(company_id) and source = 'Manual') with check (is_company_finance(company_id) and source = 'Manual');
create policy fin_delete on finance_entries for delete to authenticated using (is_company_finance(company_id) and source = 'Manual');

create or replace function finance_entries_touch() returns trigger language plpgsql security definer set search_path = public as
$$ begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    if new.currency is null or new.currency = 'MVR' then new.currency := coalesce((select currency from companies where id = new.company_id), 'MVR'); end if;
  end if;
  return new;
end $$;
create trigger fin_touch before insert or update on finance_entries for each row execute function finance_entries_touch();
create trigger fin_subscription before insert or update on finance_entries for each row
  when (new.source = 'Manual') execute function reject_if_subscription_expired();
create trigger fin_subscription_del before delete on finance_entries for each row
  when (old.source = 'Manual') execute function reject_if_subscription_expired();

-- Keep one automatic line per source record (amount 0 or null removes it).
create or replace function fin_sync(p_company uuid, p_source text, p_ref uuid, p_kind text, p_amount numeric, p_date date,
  p_category text, p_desc text, p_route uuid default null, p_vessel uuid default null, p_trip uuid default null,
  p_booking uuid default null, p_invoice uuid default null, p_method text default null) returns void
  language plpgsql security definer set search_path = public as
$$ begin
  if p_amount is null or p_amount <= 0 then
    delete from finance_entries where company_id = p_company and source = p_source and source_ref = p_ref;
    return;
  end if;
  insert into finance_entries (company_id, entry_date, kind, amount, category, description, payment_method, route_id, vessel_id, trip_id, booking_id, invoice_id, source, source_ref)
  values (p_company, coalesce(p_date, (now() at time zone company_tz(p_company))::date), p_kind, round(p_amount, 2), coalesce(nullif(btrim(p_category), ''), 'Other'),
          left(p_desc, 300), p_method, p_route, p_vessel, p_trip, p_booking, p_invoice, p_source, p_ref)
  on conflict (company_id, source, source_ref) where source <> 'Manual'
  do update set kind = excluded.kind, amount = excluded.amount, category = excluded.category, description = excluded.description,
                payment_method = excluded.payment_method, route_id = excluded.route_id, vessel_id = excluded.vessel_id,
                trip_id = excluded.trip_id, booking_id = excluded.booking_id, invoice_id = excluded.invoice_id;
end $$;
revoke execute on function fin_sync(uuid, text, uuid, text, numeric, date, text, text, uuid, uuid, uuid, uuid, uuid, text) from anon, public;

-- 3. Bookings → ticket revenue and refunds
create or replace function bookings_finance() returns trigger language plpgsql security definer set search_path = public as
$$ declare tr trips; d date; code text;
begin
  if tg_op = 'DELETE' then
    delete from finance_entries where company_id = old.company_id and source in ('Booking', 'Refund') and source_ref = old.id;
    return old;
  end if;
  if tg_op = 'UPDATE' and new.paid_amount is not distinct from old.paid_amount and new.refund_amount is not distinct from old.refund_amount
     and new.payment_status is not distinct from old.payment_status and new.trip_id is not distinct from old.trip_id
     and new.payment_method is not distinct from old.payment_method then
    return new;
  end if;
  select * into tr from trips where id = new.trip_id;
  d := (coalesce(new.created_at, now()) at time zone company_tz(new.company_id))::date;
  code := coalesce(new.reference, 'Booking');
  perform fin_sync(new.company_id, 'Booking', new.id, 'Revenue', new.paid_amount, d, 'Passenger tickets',
                   code || coalesce(' · ' || new.contact_name, ''), tr.route_id, tr.vessel_id, tr.id, new.id, null, new.payment_method);
  perform fin_sync(new.company_id, 'Refund', new.id, 'Refund', case when new.payment_status = 'Refunded' then new.refund_amount end,
                   (now() at time zone company_tz(new.company_id))::date, 'Passenger tickets', 'Refund · ' || code,
                   tr.route_id, tr.vessel_id, tr.id, new.id, null, new.payment_method);
  return new;
end $$;
create trigger bookings_finance after insert or update or delete on bookings for each row execute function bookings_finance();

-- 4. Payroll → salaries once paid
create or replace function payroll_finance() returns trigger language plpgsql security definer set search_path = public as
$$ begin
  if tg_op = 'DELETE' then
    delete from finance_entries where company_id = old.company_id and source = 'Payroll' and source_ref = old.id; return old;
  end if;
  perform fin_sync(new.company_id, 'Payroll', new.id, 'Expense',
                   case when new.status = 'Paid' then coalesce(nullif(new.employer_cost, 0), new.gross) end,
                   (coalesce(new.paid_at, now()) at time zone company_tz(new.company_id))::date, 'Salaries',
                   'Payroll ' || to_char(new.period_start, 'DD Mon') || ' – ' || to_char(new.period_end, 'DD Mon YYYY'));
  return new;
end $$;
create trigger payroll_finance after insert or update or delete on payroll_runs for each row execute function payroll_finance();

-- 5. Maintenance → cost of finished work orders
create or replace function work_orders_finance() returns trigger language plpgsql security definer set search_path = public as
$$ declare amt numeric;
begin
  if tg_op = 'DELETE' then
    delete from finance_entries where company_id = old.company_id and source = 'Maintenance' and source_ref = old.id; return old;
  end if;
  amt := case when new.status in ('Completed', 'Closed')
              then coalesce(new.cost_labour, 0) + coalesce(new.cost_parts, 0) + coalesce(new.cost_other, 0) + coalesce(new.cost_contractor, 0) end;
  perform fin_sync(new.company_id, 'Maintenance', new.id, 'Expense', amt,
                   (coalesce(new.completed_at, new.closed_at, now()) at time zone company_tz(new.company_id))::date, 'Maintenance',
                   new.code || ' · ' || new.title, null, new.vessel_id);
  return new;
end $$;
create trigger work_orders_finance after insert or update or delete on work_orders for each row execute function work_orders_finance();

-- 6. Invoices: number, totals, status; payments → revenue
create or replace function invoices_before() returns trigger language plpgsql security definer set search_path = public as
$$ declare f jsonb; tx jsonb; rate numeric; incl boolean; sub numeric := 0; it jsonb; sep text;
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.currency := coalesce((select currency from companies where id = new.company_id), new.currency, 'MVR');
    perform pg_advisory_xact_lock(hashtext('invoice_' || new.company_id::text));
    f := coalesce((select settings->'9_invoice_number_format' from companies where id = new.company_id), '{}'::jsonb);
    select greatest(coalesce(max(number), 0) + 1, coalesce(nullif(f->>'start', '')::int, 1)) into new.number from invoices where company_id = new.company_id;
    sep := case coalesce(f->>'sep', '-') when 'none' then '' else coalesce(f->>'sep', '-') end;
    new.code := coalesce(nullif(regexp_replace(coalesce(f->>'prefix', 'INV'), '[^A-Za-z0-9]', '', 'g'), ''), 'INV') || sep
      || case when coalesce((f->>'year')::boolean, true) then to_char(new.issue_date, 'YYYY') || sep else '' end
      || lpad(new.number::text, greatest(1, least(10, coalesce(nullif(f->>'digits', '')::int, 6))), '0');
  else
    new.number := old.number; new.code := old.code; new.company_id := old.company_id; new.created_by := old.created_by; new.created_at := old.created_at;
  end if;
  -- Items: [{description, qty, unit_price}] → subtotal; tax from Tax Configuration unless meta.no_tax.
  for it in select * from jsonb_array_elements(new.items) loop
    sub := sub + coalesce(nullif(it->>'qty', '')::numeric, 1) * coalesce(nullif(it->>'unit_price', '')::numeric, 0);
  end loop;
  tx := coalesce((select settings->'9_tax_configuration' from companies where id = new.company_id), '{}'::jsonb);
  rate := case when coalesce((new.meta->>'no_tax')::boolean, false) then 0 else coalesce(nullif(tx->>'rate', '')::numeric, 8) end;
  incl := coalesce((tx->>'inclusive')::boolean, true);
  if incl then
    new.total := round(sub, 2); new.tax := round(sub - sub / (1 + rate / 100), 2); new.subtotal := new.total - new.tax;
  else
    new.subtotal := round(sub, 2); new.tax := round(sub * rate / 100, 2); new.total := new.subtotal + new.tax;
  end if;
  if new.status <> 'Void' and new.status <> 'Draft' then
    new.status := case when new.amount_paid >= new.total and new.total > 0 then 'Paid' when new.amount_paid > 0 then 'Partly paid' else 'Sent' end;
  elsif new.status = 'Draft' and new.amount_paid > 0 then
    new.status := case when new.amount_paid >= new.total and new.total > 0 then 'Paid' else 'Partly paid' end;
  end if;
  return new;
end $$;
create trigger invoices_before before insert or update on invoices for each row execute function invoices_before();

create or replace function invoices_finance() returns trigger language plpgsql security definer set search_path = public as
$$ begin
  if tg_op = 'DELETE' then
    delete from finance_entries where company_id = old.company_id and source = 'Invoice' and source_ref = old.id; return old;
  end if;
  perform fin_sync(new.company_id, 'Invoice', new.id, 'Revenue', case when new.status <> 'Void' then new.amount_paid end,
                   (now() at time zone company_tz(new.company_id))::date, new.category, new.code || ' · ' || new.customer_name,
                   null, null, null, new.booking_id, new.id, new.payment_method);
  return new;
end $$;
create trigger invoices_finance after insert or update or delete on invoices for each row execute function invoices_finance();

-- Record a payment against an invoice (adds to amount_paid).
create or replace function record_invoice_payment(p_id uuid, p_amount numeric, p_method text default null) returns invoices
  language plpgsql security definer set search_path = public as
$$ declare v invoices;
begin
  select * into v from invoices where id = p_id;
  if not found then raise exception 'Invoice not found.'; end if;
  if not is_company_finance(v.company_id) then raise exception 'Only owners, admins and Operations can record payments.'; end if;
  if v.status = 'Void' then raise exception 'This invoice is void.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount above 0.'; end if;
  if v.amount_paid + p_amount > v.total then raise exception 'That is more than the % still owed.', v.total - v.amount_paid; end if;
  update invoices set amount_paid = amount_paid + p_amount, payment_method = coalesce(p_method, payment_method),
         status = case when status = 'Draft' then 'Sent' else status end
   where id = p_id returning * into v;
  return v;
end $$;
revoke execute on function record_invoice_payment(uuid, numeric, text) from anon, public;
grant execute on function record_invoice_payment(uuid, numeric, text) to authenticated;

-- 7. One call for the Finance page.
create or replace function finance_summary(p_company uuid, p_from date, p_to date) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare len int; pf date; pt date; today date; out jsonb;
begin
  if not is_company_finance(p_company) then raise exception 'Only owners, admins and Operations can see finance.'; end if;
  if p_to < p_from or p_to - p_from > 400 then raise exception 'Choose a period of up to about 13 months.'; end if;
  len := p_to - p_from + 1; pt := p_from - 1; pf := p_from - len;
  today := (now() at time zone company_tz(p_company))::date;
  with e as (select * from finance_entries where company_id = p_company and entry_date between p_from and p_to),
       ep as (select * from finance_entries where company_id = p_company and entry_date between pf and pt),
       inv as (select * from invoices where company_id = p_company and status in ('Sent', 'Partly paid'))
  select jsonb_build_object(
    'currency', coalesce((select currency from companies where id = p_company), 'MVR'),
    'kpis', jsonb_build_object(
      'revenue',  coalesce((select sum(amount) from e where kind = 'Revenue'), 0),
      'refunds',  coalesce((select sum(amount) from e where kind = 'Refund'), 0),
      'expenses', coalesce((select sum(amount) from e where kind = 'Expense'), 0),
      'net',      coalesce((select sum(case kind when 'Revenue' then amount else -amount end) from e), 0),
      'outstanding', coalesce((select sum(total - amount_paid) from inv), 0),
      'outstanding_count', (select count(*) from inv),
      'overdue_count', (select count(*) from inv where due_on < today),
      'prev', jsonb_build_object(
        'revenue',  coalesce((select sum(amount) from ep where kind = 'Revenue'), 0),
        'expenses', coalesce((select sum(amount) from ep where kind = 'Expense'), 0),
        'net',      coalesce((select sum(case kind when 'Revenue' then amount else -amount end) from ep), 0))),
    'series', (select coalesce(jsonb_agg(jsonb_build_object('day', g::date,
                  'revenue', coalesce((select sum(amount) from e where entry_date = g::date and kind = 'Revenue'), 0),
                  'expenses', coalesce((select sum(amount) from e where entry_date = g::date and kind in ('Expense', 'Refund')), 0)) order by g), '[]'::jsonb)
               from generate_series(p_from, p_to, interval '1 day') g),
    'by_route', (select coalesce(jsonb_agg(x order by (x->>'revenue')::numeric desc), '[]'::jsonb) from (
                  select jsonb_build_object('route_id', e.route_id, 'route', coalesce(r.name, 'No route'), 'revenue', sum(e.amount), 'entries', count(*)) x
                  from e left join routes r on r.id = e.route_id where e.kind = 'Revenue' group by e.route_id, r.name) s),
    'by_category', (select coalesce(jsonb_agg(x order by (x->>'amount')::numeric desc), '[]'::jsonb) from (
                  select jsonb_build_object('category', category, 'amount', sum(amount), 'entries', count(*)) x
                  from e where kind = 'Expense' group by category) s),
    'revenue_by_category', (select coalesce(jsonb_agg(x order by (x->>'amount')::numeric desc), '[]'::jsonb) from (
                  select jsonb_build_object('category', category, 'amount', sum(amount)) x from e where kind = 'Revenue' group by category) s),
    'by_source', (select coalesce(jsonb_object_agg(source, amt), '{}'::jsonb) from (select source, sum(amount) amt from e group by source) s),
    'recent', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                  select jsonb_build_object('id', e.id, 'date', e.entry_date, 'kind', e.kind, 'amount', e.amount, 'category', e.category,
                         'description', e.description, 'source', e.source, 'route', r.name, 'vessel', coalesce(v.code, v.name),
                         'payment_method', e.payment_method, 'created_at', e.created_at) x
                  from e left join routes r on r.id = e.route_id left join vessels v on v.id = e.vessel_id
                  order by e.entry_date desc, e.created_at desc limit 15) s)
  ) into out;
  return out;
end $$;
revoke execute on function finance_summary(uuid, date, date) from anon, public;
grant execute on function finance_summary(uuid, date, date) to authenticated;

-- 8. Backfill from what already exists.
do $$ declare b bookings; tr trips;
begin
  for b in select * from bookings loop
    select * into tr from trips where id = b.trip_id;
    perform fin_sync(b.company_id, 'Booking', b.id, 'Revenue', b.paid_amount, (b.created_at at time zone company_tz(b.company_id))::date,
                     'Passenger tickets', coalesce(b.reference, 'Booking') || coalesce(' · ' || b.contact_name, ''), tr.route_id, tr.vessel_id, tr.id, b.id, null, b.payment_method);
    perform fin_sync(b.company_id, 'Refund', b.id, 'Refund', case when b.payment_status = 'Refunded' then b.refund_amount end,
                     (coalesce(b.cancelled_at, b.updated_at) at time zone company_tz(b.company_id))::date, 'Passenger tickets',
                     'Refund · ' || coalesce(b.reference, 'Booking'), tr.route_id, tr.vessel_id, tr.id, b.id, null, b.payment_method);
  end loop;
end $$;
do $$ declare p payroll_runs;
begin
  for p in select * from payroll_runs where status = 'Paid' loop
    perform fin_sync(p.company_id, 'Payroll', p.id, 'Expense', coalesce(nullif(p.employer_cost, 0), p.gross),
                     (coalesce(p.paid_at, now()) at time zone company_tz(p.company_id))::date, 'Salaries',
                     'Payroll ' || to_char(p.period_start, 'DD Mon') || ' – ' || to_char(p.period_end, 'DD Mon YYYY'));
  end loop;
end $$;
do $$ declare w work_orders;
begin
  for w in select * from work_orders where status in ('Completed', 'Closed') loop
    perform fin_sync(w.company_id, 'Maintenance', w.id, 'Expense',
                     coalesce(w.cost_labour, 0) + coalesce(w.cost_parts, 0) + coalesce(w.cost_other, 0) + coalesce(w.cost_contractor, 0),
                     (coalesce(w.completed_at, w.closed_at, now()) at time zone company_tz(w.company_id))::date, 'Maintenance',
                     w.code || ' · ' || w.title, null, w.vessel_id);
  end loop;
end $$;
