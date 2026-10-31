-- Staff photos: one picture per person per company, shown in the avatar on the website and in both phone apps.
-- The picture lives in the private bucket `staff-photos` at {company_id}/{user_id}/{file}; company_members.photo_path points at it.
-- Anyone in the company can see it (they already see the name); HR can set anyone's photo, a person can set their own.
-- Clients call set_staff_photo() after uploading, then show it through a short-lived signed link.

alter table company_members add column photo_path text
  check (photo_path is null or char_length(photo_path) between 10 and 300);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('staff-photos', 'staff-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- staff_doc_file_company / staff_doc_file_user (0022) read the company and user out of the first two path parts.
create policy staff_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'staff-photos' and is_company_member(staff_doc_file_company(name)));
create policy staff_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'staff-photos' and (
    is_company_hr(staff_doc_file_company(name))
    or (staff_doc_file_user(name) = auth.uid() and is_company_member(staff_doc_file_company(name)))));
create policy staff_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'staff-photos' and (
    is_company_hr(staff_doc_file_company(name))
    or (staff_doc_file_user(name) = auth.uid() and is_company_member(staff_doc_file_company(name)))));
create policy staff_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'staff-photos' and (
    is_company_hr(staff_doc_file_company(name))
    or (staff_doc_file_user(name) = auth.uid() and is_company_member(staff_doc_file_company(name)))));

-- Point a member at an uploaded picture, or clear it with a null path.
create function set_staff_photo(p_company uuid, p_user uuid, p_path text) returns void
  language plpgsql security definer set search_path = public as
$$ begin
  if not (is_company_hr(p_company) or (p_user = auth.uid() and is_company_member(p_company))) then
    raise exception 'Only HR or the person themselves can change this photo.';
  end if;
  if p_path is not null and p_path not like p_company::text || '/' || p_user::text || '/%' then
    raise exception 'The photo must be stored under the person''s own folder.';
  end if;
  update company_members set photo_path = nullif(btrim(p_path), '') where company_id = p_company and user_id = p_user;
  if not found then raise exception 'That person is not in this company.'; end if;
  insert into company_audit (company_id, actor, action, detail)
    values (p_company, auth.uid(), 'staff_photo_changed', case when p_path is null then 'removed' else 'updated' end || ' for ' || p_user::text);
end $$;
revoke execute on function set_staff_photo(uuid, uuid, text) from anon, public;
grant execute on function set_staff_photo(uuid, uuid, text) to authenticated;
