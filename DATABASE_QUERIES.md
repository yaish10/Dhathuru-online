# VEYORA — database queries for UI (Cursor)

Claude owns schema/migrations/RLS. Cursor owns HTML/CSS/JS and calls only what is listed here (or newly added in `supabase/DATABASE_HANDOFF.md`).

---

## Cursor 2026-10-24 — PDF Layout Maker (COMPLETE)

### Architecture

| Layer | Reality |
| --- | --- |
| Frontend | Vanilla JS + `shell.js` |
| PDF | Shared `pdf-render.js` HTML/`@page` + `pdf-engine.js` (html2pdf). Preview === PDF. |
| Company | Always `companies` + `company-logos` public URL — never hard-coded in templates |
| API | `pdf-api.js` → `window.VeyoraPdfApi.generate({ companyId, documentType, source, … })` |

### UI files

| File | Role |
| --- | --- |
| `pdf-layouts.html/js/css` | Template list + editor (sections, table cols, field catalogue, version restore, live record picker) |
| `pdf-schema.js` / `pdf-fields.js` / `pdf-render.js` / `pdf-engine.js` | Schema, fields, HTML, PDF |
| `pdf-api.js` | Load published template, generate, log `document_generation_records` |
| `finance.js` `#invoices` | Invoice list, create draft, record payment, Invoice/Receipt PDF |
| `hr.js` payslip | **Download PDF** (published payslip layout) |
| `reports.js` | Library export → PDF via published report layout + live `finance_summary` / trips / leave / work_orders |

### Persistence (Claude)

**Preferred:** apply `supabase/migrations/0054_document_templates.sql`  
Tables: `document_templates`, `document_template_versions`, `document_generation_records`  
RPCs: `publish_document_template`, `ensure_document_template_draft`, `can_manage_pdf_templates`

**Fallback (works today):** `companies.settings.9_pdf_layout_store` via `set_company_setting` when 0054 is missing. UI banner notes settings store. Generation still works.

### Generate from app code

```js
VeyoraPdfApi.generate({
  companyId, documentType: "invoice"|"receipt"|"payslip"|"financial_report"|"employee_report",
  source, sourceId, filename, allowMissing: true // optional
});
// Payslip: VeyoraPdfApi.mapPayslip(run, line, staff)
// Report:  VeyoraPdfApi.mapReportPayload(meta, columns, rows, summary)
```

### Related Finance queries (already in 0046)

- `finance_summary(p_company, p_from, p_to)` — overview KPIs / export rows  
- `invoices` select/insert/update; `record_invoice_payment(p_id, p_amount, p_method)`  
- **Expenses UI (`finance.html#expenses`):** `finance_entries` where `kind = 'Expense'`  
  - Insert/update/delete **only** `source = 'Manual'` (RLS)  
  - Auto lines (`Payroll`, `Maintenance`, …) are read-only in the UI  
  - Categories: `9_expense_categories`; methods: `9_payment_methods`; default: `9_category_defaults.expenseImport`  
- Settings key `9_pdf_layout_store` (Cursor fallback until 0054)

### Still later / Claude

- Apply 0054 live; optional Chromium Edge Function swap in `pdf-engine.js` only  
- `report_runs` persistence for scheduled exports / XLSX  

---

**Client:** `window.veyoraDb` from `db.js` + publishable key in `config.js`. Never use `service_role`.

**Full catalogue:** `supabase/DATABASE_HANDOFF.md`  
**Company booking API:** `supabase/COMPANY_API.md`  
**Apply order:** `supabase/README.md` (migrations `0001` → latest)

App root for UI work: **`beta/beta/`** (nested folder). Outer `beta/` is an older shallow copy — prefer the nested tree.

**Mobile (Flutter):** `beta/mobile/` — see `beta/mobile/DATABASE_QUERIES.md`. Login uses the same Supabase Auth as web (no new tables).

---

## Collections (tables) by domain

| Domain | Tables |
|--------|--------|
| Tenancy | `companies`, `profiles`, `company_members`, `company_invites`, `departments`, `job_titles`, `platform_admins`, `platform_settings`, `platform_audit`, `company_audit` |
| Billing | `subscription_plans`, `subscription_requests` |
| HR | `staff_certifications`, `leave_requests`, `member_private`, `employee_events`, `roster_entries`, `roster_periods`, `attendance_records`, `attendance_corrections`, `timesheet_weeks`, `member_pay`, `payroll_runs`, `payroll_lines`, `staff_documents`, `staff_document_versions`, `agreement_templates`, `agreements`, `notifications` |
| IT | `it_networks`, `it_devices`, `it_assets`, `it_tickets`, `it_ticket_notes`, `it_events` |
| Ops / Fleet | `routes`, `schedule_templates`, `trips`, `trip_crew`, `trip_events`, `dispatch_tasks`, `ops_advisories`, `vessels` (+ `followme_links` / `followme_cache` — not readable for URLs) |
| Passengers | `passengers`, `bookings`, `booking_passengers` |
| Company API | `company_api_keys`, `api_usage` |
| Finance | `finance_entries`, `invoices` |
| Reports | `report_runs`, `report_defs`, `report_schedules` |
| Maintenance | `vessels`, `vessel_components`, `hour_readings`, `maint_schedules`, `work_orders`, `defects`, `maint_checklists`, `maint_inspections`, `maint_events`, `maint_files`, `suppliers`, `parts`, `part_stock`, `stock_moves`, `purchase_requests`, `purchase_orders`, `maint_budgets`, `technician_skills`, `component_events`, `warranty_claims`, `vessel_status_periods` |

---

## Storage buckets

| Bucket | Public | Typical path |
|--------|--------|----------------|
| `company-logos` | yes | `{company_id}/…` |
| `staff-documents` | no | company + user |
| `agreements` | no | `{company_id}/…` |
| `maintenance` | no | company-prefixed |
| `reports` | no | `{company_id}/{run_id}.{ext}` |

---

## Page → main queries / RPCs

| Page | Prefer |
|------|--------|
| Auth / shell | `companies`, `company_members`, `platform_admins`; `company_subscription`, `it_network_status` |
| Platform | `platform_*` RPCs |
| **Onboarding** (`onboarding.html`) | First-run wizard after company create. See section below. |
| Settings | `set_company_setting`, `set_member_org`, `assign_employee_no`; depts / titles / members |
| HR | leave / attendance / timesheet / payroll RPCs; `crew_availability`, `set_member_*`, `preview_allowances_all`; bucket `staff-documents`; **Departments & Designations** (`hr.html#organization`) → `departments`, `job_titles` CRUD (dept writes: admin; titles: HR after 0014) |
| Roster | `set_roster`, `publish_roster`, `set_roster_period_status`, `can_edit_roster`, `roster_coverage_gaps` |
| Agreements | tables + bucket `agreements` |
| Notifications | `scan_hr_notifications`, `mark_notifications_read` |
| IT | `register_device`, `open_ticket`, `add_ticket_note`, `scan_it_assets`, `it_network_status` |
| Maintenance | WO/defect/parts/PO RPCs; `scan_maintenance`, `scan_low_stock`; bucket `maintenance` |
| Fleet | `vessels` (+ capacity / standby / `meta`); `set_vessel_crew_mix` via `vessel-crew.js` |
| Schedules | `schedule_trips`, `generate_trips`, `copy_trips`, `import_trips`, `set_trip_status`; **delete Fixed** = all days for `template_id` (empty trips delete, booked cancel, then delete `schedule_templates`); one-off trips delete/cancel that day only; **override kinds** (Promotional / Temporary / etc.) **replace Fixed** on same route+day+time (UI cancels/deletes Fixed then `import_trips`; list hides Fixed when override exists). Claude: optional later — bake replace into `import_trips` |
| Operations | Home (`operations.html`): vessels + `schedule_trips` for KPIs / today’s schedule / fleet cards. Map is **coming soon** (no `followme_fetch` on home). Dispatch (`#board`): `scan_operations`, `ops_board`, `schedule_trips`, `clear_trip`, `set_trip_status`, `finish_dispatch_task`, `trip_manifest`, booking RPCs (`create_booking`, **`update_booking`** for mark paid → `paid_amount` = `fare_total`), `assign_trip_crew`, **`followme_fetch(p_vessel)`** |
| Passengers | `passengers`, `bookings`, `booking_passengers`; `create_booking`, `update_booking`, `cancel_booking`, `set_passenger_status`, `trip_manifest` |
| Finance | **`finance_summary(p_company, p_from, p_to)`**; `finance_entries` (Manual only edit); `invoices` + `record_invoice_payment`; settings `9_*` via `set_company_setting` |
| Reports | **`reports_overview`**, **`run_report`**, **`finish_report_run`**; upload to bucket `reports` |

Settings keys: `{n}_{slug}` in `companies.settings` via `set_company_setting`. Prefix ACL: HR `8_`/`16_`, maint `10_`, IT `13_`/`14_`/`17_`, ops `3_`/`4_`/`5_`/`6_`. **Finance `9_*` today: owner/admin only** — see Claude ask below.

### Cursor 2026-10-24 — Finance Settings (sectioned)

**UI:** `finance.html#settings/<section>` — left nav, one section at a time (`finance-settings.js`).

| Section | Phase | Editors |
| --- | --- | --- |
| `general` | Essential | Default currency, decimals, supported currencies, FY start, date format |
| `categories` | Essential | Revenue/expense categories (active flag), import defaults |
| `payments` | Essential | Payment methods, cash/bank accounts, reconciliation |
| `invoices` | Essential | Invoice/receipt number formats, document branding, payment terms |
| `tax` | Essential | Registration, inclusive flag, **configurable tax rates** (`9_tax_rates`) |
| `approvals` | Essential | Expense/payment/purchase/refund limits, requester≠approver |
| `budgets` | Next | Roadmap (FY start already in general) |
| `payroll` | Later | Posting rules only — calculations stay in HR |
| `reports` | Next | Report period / export prefs (+ roadmap) |

**Keys** (via `set_company_setting`, slug from title under cat 9):

| Key | Notes |
| --- | --- |
| `9_base_currency` | `{ base, decimals }` — Ops/Finance money |
| `9_supported_currencies` | string list |
| `9_financial_periods` | `{ start, period, dateFormat, lock }` |
| `9_revenue_categories` / `9_expense_categories` | `[{ name, active }]` (legacy string rows still read) |
| `9_category_defaults` | `{ revenueImport, expenseImport }` |
| `9_payment_methods` | string list — **Ops Mark paid / New booking** |
| `9_finance_accounts` | `[{ name, type: Cash\|Bank, currency, active }]` |
| `9_reconciliation_settings` | `{ requireAccount, matchDays, warnUnmatched }` |
| `9_invoice_number_format` / `9_receipt_number_format` | fmt `{ prefix, sep, year, digits, start }` |
| `9_document_branding` | `{ showLogo, showAddress, showReg, footer }` |
| `9_payment_terms` | `{ days, note }` |
| `9_tax_configuration` | `{ inclusive, taxId, name, rate }` — primary mirrored from rates |
| `9_tax_rates` | `[{ name, rate, active }]` |
| `9_financial_approval_limits` | `{ expense, payment, purchase, refund, above, separate, … }` |
| `9_payroll_finance_posting` | `{ expenseCategory, account, method, posting, exportOnlyApproved }` |
| `9_financial_report_preferences` | `{ format, range, zero, trackUnpaid, reconcileRules }` |

**Claude:** allow `9\_%` writes for `is_company_finance`. Prefer `9_tax_rates` over a single hard-coded rate when taxing invoices.

Module toggles: `17_module_and_feature_management` (shell `modsOf`).

---

## Live DB status (as of handoff notes, Oct 2026)

- Project **`veyora`**: migrations **0001–0049** applied.
- FollowMe: save `vessels.meta.followme_url`; UI shows `followme_hint` / `followme_set`; call `followme_fetch` (no URL in response). Prefer API URLs `https://followme.mv/api/v5/public/<key>/`.
- Trip seats follow vessel capacity (0048); do not write `seats_total` when assigning a vessel unless `meta.seats_override`.
- Delays are **manual only**; held trips stay Scheduled/Boarding with “Held at departure” events.

---

## Still thin / next UI work

1. **`finance.js`** — wire to `finance_summary` / invoices (DB ready 0046).
2. **`reports.js`** — wire to `run_report` / `finish_report_run` / overview (DB ready 0047).
3. **`passengers.js`** — finish registry / bookings / check-in against 0038 RPCs.
4. **API keys UI** under Settings — `create_api_key` / `update_api_key` / `revoke_api_key` / list `company_api_keys`.
5. Claude one-off: rewrite stored FollowMe public share URLs to `/api/v5/public/…` (see top of DATABASE_HANDOFF).

### Cursor 2026-10-24 — Staff login ID on Add Employee

**UI:** Staff ID = **HR prefix + 4 digits** (e.g. `vy-1000`). Prefix from **HR Settings → Employee ID Format** (`settings.html?in=hr`, key `2_employee_id_format.prefix`, default `vy`). Number starts at 1000. Stored as `company_members.employee_no` / invite `profile.employee_no`.

**0053 view:** login_code = `lower(employee_no)` when it matches `prefix-####`; else legacy `lower(company.code || '-' || employee_no)`.

**Claude:** apply updated **0053** + deploy `staff-login` function.

### Cursor 2026-10-24 — Pending invites on Employees directory

**UI:** `hr.js` merges open `company_invites` (+ `settings.8_pending_employee_invites` drafts) into the Employees list so people who have not set a password yet still appear as **Invite sent** / **Awaiting signup**.

**Migration:** `0052_invites_hr_select.sql` — `invites_select` / `invites_delete` use `is_company_hr` (was admin-only). Without 0052, list still works from settings drafts; invite copy-link needs invite `token` from the table.

**Claude:** apply 0052 on live `veyora`.

### Cursor 2026-10-23 — Company first-run onboarding wizard

**UI:** `onboarding.html` + `onboarding.js` / `onboarding.css`. After `company.js` creates a company → `onboarding.html`. Finish → `fleet.html` (vessels). Resume from dashboard banner / `settings.html?welcome=1` if `0_setup_wizard.done` is not true.

**Phases (UI):**
1. Company profile columns on `companies` (region, address, currency, timezone, …)
2. Insert `departments` + `job_titles` (admin/owner RLS)
3. Access: save dept→modules map + role matrices
4. Per-department detail forms → then mark wizard done

**Settings keys (via `set_company_setting`):**

| Key | Value |
| --- | --- |
| `0_setup_wizard` | `{ phase, deptPhaseIdx, selectedDepts, selectedTitles, deptModules, deptDetails, done, finishedAt }` |
| `0_setup_dept_modules` | `{ "HR": ["Dashboard","HR & Crew",…], … }` — **source of truth for dept-based module access** (Claude: enforce later when member has `department_id`) |
| `1_module_access` | Role→module matrix (same shape as Settings → Module Access) |
| `1_department_access` | Role→department matrix (same shape as Settings → Department Access) |

**Tables written:** `companies` (update), `departments` (insert), `job_titles` (insert). No new migration required for the wizard itself.

**Claude:** When enforcing access, prefer `0_setup_dept_modules` + member `department_id` over role-only matrices when the map is present. Owners/admins remain full access.

### Cursor 2026-10-23 — Owner full access (0051)

**Intent:** Company `owner` (and platform admin) can do anything on every page.

**UI (`shell.js`):** `info.canAll` / `isOwner`; owners bypass module off-gates and network gates; every page capability flag (`canHr`, `canOps`, `canIT`, `canMaint`, `canFinance`, `canReports`, `isAdmin`) is true for owners.

**Migration:** `0051_owner_full_access.sql` — `is_company_owner`; `is_company_hr` / `ops` / `it` / `maint` / `finance` / `reports` all include `is_company_admin` (hence owner).

**Claude:** apply 0051 on live `veyora` DB; note in DATABASE_HANDOFF.

### Cursor 2026-10-23 — Add New Employee profile apply (0050)

**Bug:** Wizard filled many fields, but `accept_invite` only inserted a blank `company_members` row — name/dept/etc. never landed.

**Migration (apply on live DB):** `supabase/migrations/0050_employee_invite_profile.sql`

| Piece | What |
| --- | --- |
| `company_invites.meta` | jsonb; stores `{ profile: {…} }` |
| `company_members.hr_meta` | jsonb overflow (gender, dob, address, shift, docs…) |
| `apply_invite_profile(company, user, profile)` | Writes full_name, org fields, phone/emergency, hr_meta |
| `accept_invite` | After join: apply `meta.profile` or matching `settings.8_pending_employee_invites`, then clear pending entry |
| `create_employee_invite(company, email, role, profile, role_label)` | Invite + meta + settings draft in one call (HR) |
| `apply_pending_employee_profiles(company)` | HR backfill for people who already accepted with an empty record |

**UI:** `hr-add-employee.js` calls `create_employee_invite` (falls back to insert + settings). `hr.js` runs `apply_pending_employee_profiles` once on HR load.

**Claude:** run migration 0050 on the `veyora` project; update `DATABASE_HANDOFF.md` to note 0050 applied. Photo/docs files still after join (`staff-documents`).
