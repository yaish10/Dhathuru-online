-- INSERT ... RETURNING checks the select policy against the pre-trigger snapshot, so the
-- creator is not yet a member at that moment. Let creators always read their own company.
drop policy companies_select on companies;
create policy companies_select on companies for select to authenticated
  using (is_company_member(id) or created_by = auth.uid());
