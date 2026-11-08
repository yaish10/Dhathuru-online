# VEYORA beta — working rules for Claude

## Ownership (do not blur)

- **You (Claude):** database only — schema, migrations, RLS, RPCs, storage buckets/policies. Apply SQL in the Supabase SQL editor for project **veyora**.
- **Cursor:** UI and app functions — HTML/CSS/JS under `beta/`. Cursor must not invent tables or put `service_role` in the client.

## Before any database work

1. Read **`supabase/DATABASE_HANDOFF.md`** — full table / RPC / settings / bucket catalogue and DO NOTs.
2. Read **`supabase/README.md`** — migration order and platform-owner seed note.
3. Apply new SQL as the next numbered file: `supabase/migrations/00NN_short_name.sql` after the highest existing number.
4. Update **`DATABASE_HANDOFF.md`** in the same change (tables, RPCs, RLS, buckets, migration one-liner).

## Hard rules

- Never put `service_role` (or any secret) in front-end files or `config.js`.
- Do not skip or reorder migrations.
- Prefer security-definer RPCs + RLS for privileged writes; do not weaken RLS to unblock the UI.
- Build new tables to extend without SQL changes: a `meta jsonb` object column, free-text kinds/types whose option lists live in settings, and fixed CHECK lists only where the database itself acts on the value.
- Settings keys stay `^[a-z0-9_]{1,60}$` with prefix ACLs (`8_` HR, `10_` maint, `13_`/`14_`/`17_` IT, `16_` agreements, `3_`/`4_`/`5_`/`6_` operations).

## After schema changes

Tell Cursor the exact new/changed object names (table columns, RPC args, bucket paths) so the UI can call them.
