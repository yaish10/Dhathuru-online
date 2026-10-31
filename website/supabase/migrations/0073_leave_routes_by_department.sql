-- Leave routing is by department only (crew group = department). Existing 'Group:<crew group>' rules in
-- 8_approvers_and_responsibilities.leave.routes are rewritten to 'Dept:<uuid>' rules: one rule per department
-- that has job titles in that crew group, same position in the list, same approvers (a department that already
-- has its own rule keeps that one). Rules for a group with no department are dropped. leave_approver_ids then
-- matches 'All staff' and 'Dept:<uuid>' only.

do $$ declare c record; route jsonb; out jsonb; d uuid; seen text[]; grp text;
begin
  for c in select id, settings->'8_approvers_and_responsibilities' as cfg from companies
           where settings->'8_approvers_and_responsibilities'->'leave'->'routes' @> '[{}]'::jsonb loop
    out := '[]'::jsonb; seen := '{}';
    -- departments that already have their own rule keep it
    for route in select * from jsonb_array_elements(c.cfg->'leave'->'routes') loop
      if route->>'applies' like 'Dept:%' then seen := seen || (route->>'applies'); end if;
    end loop;
    for route in select * from jsonb_array_elements(c.cfg->'leave'->'routes') loop
      if route->>'applies' like 'Group:%' then
        grp := substr(route->>'applies', 7);
        for d in select distinct jt.department_id from job_titles jt
                 where jt.company_id = c.id and jt.crew_group = grp and jt.department_id is not null loop
          if not ('Dept:' || d::text) = any(seen) then
            seen := seen || ('Dept:' || d::text);
            out := out || jsonb_build_array(jsonb_build_object('applies', 'Dept:' || d::text, 'approvers', coalesce(route->'approvers', '[]'::jsonb)));
          end if;
        end loop;
      else
        out := out || jsonb_build_array(route);
      end if;
    end loop;
    update companies set settings = jsonb_set(settings, '{8_approvers_and_responsibilities,leave,routes}', out) where id = c.id;
  end loop;
end $$;

create or replace function leave_approver_ids(p_id uuid) returns uuid[]
  language plpgsql stable security definer set search_path = public as
$$ declare
  r leave_requests; cfg jsonb; route jsonb; dept uuid; mgr uuid; out uuid[] := '{}'; matched boolean := false;
begin
  select * into r from leave_requests where id = p_id;
  if not found then return null; end if;
  select settings->'8_approvers_and_responsibilities'->'leave' into cfg from companies where id = r.company_id;
  if cfg is null then return null; end if;
  select m.department_id, m.manager_id into dept, mgr
    from company_members m where m.company_id = r.company_id and m.user_id = r.user_id;
  if coalesce((cfg->>'useManager')::boolean, false) and mgr is not null then out := array[mgr]; end if;
  for route in select * from jsonb_array_elements(coalesce(cfg->'routes', '[]'::jsonb)) loop
    if route->>'applies' = 'All staff'
       or (dept is not null and route->>'applies' = 'Dept:' || dept::text) then
      out := out || array(select (x)::uuid from jsonb_array_elements_text(coalesce(route->'approvers', '[]'::jsonb)) x);
      matched := true;
      exit;
    end if;
  end loop;
  if not matched then
    out := out || array(select (x)::uuid from jsonb_array_elements_text(coalesce(cfg->'fallback', '[]'::jsonb)) x);
  end if;
  out := array(select distinct u from unnest(out) u
               where u <> r.user_id and exists (select 1 from company_members m where m.company_id = r.company_id and m.user_id = u and m.active));
  return out;
end $$;
revoke execute on function leave_approver_ids(uuid) from anon, public;
grant execute on function leave_approver_ids(uuid) to authenticated;
