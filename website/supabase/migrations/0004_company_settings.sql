-- Settings page: extra company profile fields plus a free-form bag for per-category settings.
alter table companies
  add column region           text,
  add column currency         text not null default 'MVR',
  add column timezone         text not null default 'Indian/Maldives',
  add column date_format      text not null default 'DD MMM YYYY',
  add column language         text not null default 'English',
  add column registration_no  text,
  add column address          text,
  add column settings         jsonb not null default '{}'::jsonb;
