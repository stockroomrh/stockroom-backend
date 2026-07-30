insert into storage.buckets (id, name, public) values ('project-media', 'project-media', true) on conflict (id) do nothing;
