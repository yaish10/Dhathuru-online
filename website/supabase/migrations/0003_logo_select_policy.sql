-- Storage upsert needs read access to existing objects. Members can list their own company's logos.
create policy logos_read on storage.objects for select to authenticated
  using (bucket_id = 'company-logos' and is_company_member(((storage.foldername(name))[1])::uuid));
