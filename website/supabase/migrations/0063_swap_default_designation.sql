-- 0063: shift swaps default to "Same designation" (a crew member cannot swap with a captain).
-- HR can still choose Anyone or Same crew group under HR Settings -> Shift Swap Rules -> Staff can swap with.
-- Companies that already saved a value keep it; only the unset default changes.

create or replace function swap_rules(p_company uuid) returns jsonb
  language sql stable security definer set search_path = public as
$$ select jsonb_build_object(
     'enabled', coalesce((settings->'8_shift_swap_rules'->>'enabled')::boolean, true),
     'hod', coalesce((settings->'8_shift_swap_rules'->>'hod')::boolean, true),
     'scope', coalesce(nullif(settings->'8_shift_swap_rules'->>'scope', ''), 'Same designation'),
     'notice_hours', coalesce(nullif(settings->'8_shift_swap_rules'->>'notice', '')::int, 0))
   from companies where id = p_company $$;
