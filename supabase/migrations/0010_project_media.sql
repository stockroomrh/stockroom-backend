-- Logo/banner images for live-launched projects, stored in a public Supabase
-- Storage bucket. Each user may only write under their own auth.uid() folder;
-- reads are public since these are marketing assets shown on public pages.
alter table projects add column banner_url text;
