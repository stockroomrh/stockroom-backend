-- Auto-create a profiles row the moment Supabase Auth creates a user via
-- Sign in with Web3, so project_members (and everything else that FKs to
-- profiles) always has a row to reference without extra application code.
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  wallet text;
begin
  wallet := coalesce(
    new.raw_user_meta_data->>'address',
    new.raw_user_meta_data->'custom_claims'->>'address'
  );
  insert into public.profiles (id, wallet_address)
  values (new.id, lower(coalesce(wallet, new.id::text)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
