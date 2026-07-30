-- Row Level Security for every exposed table. The service-role key (used only
-- from lib/supabase/server.ts's getSupabaseServiceClient, inside app/api/**)
-- bypasses RLS by design and performs authorization in application code via
-- lib/server/auth/session.ts + roles.ts. These policies are the backstop for
-- any direct anon/authenticated access and the sole path for public reads.

alter table profiles enable row level security;
alter table projects enable row level security;
alter table project_members enable row level security;
alter table project_tokens enable row level security;
alter table treasury_accounts enable row level security;
alter table treasury_policies enable row level security;
alter table treasury_policy_versions enable row level security;
alter table asset_registry enable row level security;
alter table project_approved_assets enable row level security;
alter table agent_settings enable row level security;
alter table treasury_snapshots enable row level security;
alter table treasury_positions enable row level security;
alter table activity_items enable row level security;
alter table agent_reports enable row level security;
alter table recommendations enable row level security;
alter table recommendation_events enable row level security;
alter table trade_quotes enable row level security;
alter table trade_executions enable row level security;
alter table deployment_records enable row level security;
alter table audit_logs enable row level security;

-- Helper: is the current user a member (any role) of a project?
create or replace function is_project_member(target_project_id uuid, min_role text default 'viewer')
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from project_members pm
    where pm.project_id = target_project_id
      and pm.profile_id = auth.uid()
      and pm.is_active
      and (
        min_role = 'viewer'
        or (min_role = 'operator' and pm.role in ('operator', 'owner'))
        or (min_role = 'owner' and pm.role = 'owner')
      )
  );
$$;

create or replace function project_is_published(target_project_id uuid)
returns boolean language sql stable as $$
  select exists (select 1 from projects p where p.id = target_project_id and p.status = 'published');
$$;

-- profiles: users manage only their own row.
create policy profiles_select_own on profiles for select using (id = auth.uid());
create policy profiles_update_own on profiles for update using (id = auth.uid());

-- projects: public can read published projects; members can read their own (incl. drafts).
create policy projects_select_public on projects for select
  using (status = 'published' or is_project_member(id, 'viewer'));
create policy projects_insert_owner on projects for insert
  with check (owner_profile_id = auth.uid());
create policy projects_update_owner on projects for update
  using (is_project_member(id, 'owner'));

-- project_members: visible to other members of the same project; only owners manage membership.
create policy project_members_select on project_members for select
  using (profile_id = auth.uid() or is_project_member(project_id, 'viewer'));
create policy project_members_write_owner on project_members for all
  using (is_project_member(project_id, 'owner'))
  with check (is_project_member(project_id, 'owner'));

-- project_tokens / treasury_accounts / treasury_policies / treasury_policy_versions:
-- public read when the parent project is published; write restricted to owners.
create policy project_tokens_select on project_tokens for select
  using (project_is_published(project_id) or is_project_member(project_id, 'viewer'));
create policy project_tokens_write_owner on project_tokens for all
  using (is_project_member(project_id, 'owner')) with check (is_project_member(project_id, 'owner'));

create policy treasury_accounts_select on treasury_accounts for select
  using (project_is_published(project_id) or is_project_member(project_id, 'viewer'));
create policy treasury_accounts_write_owner on treasury_accounts for all
  using (is_project_member(project_id, 'owner')) with check (is_project_member(project_id, 'owner'));

create policy treasury_policies_select on treasury_policies for select
  using (project_is_published(project_id) or is_project_member(project_id, 'viewer'));
create policy treasury_policies_write_owner on treasury_policies for all
  using (is_project_member(project_id, 'owner')) with check (is_project_member(project_id, 'owner'));

create policy treasury_policy_versions_select on treasury_policy_versions for select
  using (
    exists (select 1 from treasury_policies tp where tp.id = policy_id and (project_is_published(tp.project_id) or is_project_member(tp.project_id, 'viewer')))
  );

-- asset_registry: globally readable (canonical, verified metadata is public by design); writes are admin/service-role only.
create policy asset_registry_select_all on asset_registry for select using (true);

-- project_approved_assets: public read when project published (it's the public policy page's asset list); operator+ can write.
create policy project_approved_assets_select on project_approved_assets for select
  using (project_is_published(project_id) or is_project_member(project_id, 'viewer'));
create policy project_approved_assets_write on project_approved_assets for all
  using (is_project_member(project_id, 'operator')) with check (is_project_member(project_id, 'operator'));

create policy agent_settings_select on agent_settings for select
  using (is_project_member(project_id, 'viewer'));
create policy agent_settings_write_owner on agent_settings for all
  using (is_project_member(project_id, 'owner')) with check (is_project_member(project_id, 'owner'));

-- treasury_snapshots / treasury_positions / activity_items: public balance-sheet data.
create policy treasury_snapshots_select on treasury_snapshots for select
  using (project_is_published(project_id) or is_project_member(project_id, 'viewer'));

create policy treasury_positions_select on treasury_positions for select
  using (
    exists (select 1 from treasury_snapshots ts where ts.id = snapshot_id and (project_is_published(ts.project_id) or is_project_member(ts.project_id, 'viewer')))
  );

create policy activity_items_select on activity_items for select
  using (project_is_published(project_id) or is_project_member(project_id, 'viewer'));
create policy activity_items_classify on activity_items for update
  using (is_project_member(project_id, 'operator')) with check (is_project_member(project_id, 'operator'));

-- agent_reports: public reports are public; internal ones require membership.
create policy agent_reports_select on agent_reports for select
  using ((is_public and project_is_published(project_id)) or is_project_member(project_id, 'viewer'));

-- recommendations / recommendation_events: members only (never public — these are operator workflow, not the public ledger).
create policy recommendations_select on recommendations for select using (is_project_member(project_id, 'viewer'));
create policy recommendations_update_operator on recommendations for update
  using (is_project_member(project_id, 'operator')) with check (is_project_member(project_id, 'operator'));

create policy recommendation_events_select on recommendation_events for select
  using (exists (select 1 from recommendations r where r.id = recommendation_id and is_project_member(r.project_id, 'viewer')));

-- trade_quotes / trade_executions: operator+ only, never public, never anon-writable directly.
create policy trade_quotes_select on trade_quotes for select
  using (exists (select 1 from recommendations r where r.id = recommendation_id and is_project_member(r.project_id, 'operator')));

create policy trade_executions_select on trade_executions for select
  using (exists (select 1 from recommendations r where r.id = recommendation_id and is_project_member(r.project_id, 'operator')));

-- deployment_records: public once a project is published (the whole point is a public, verifiable contract).
create policy deployment_records_select on deployment_records for select
  using (project_is_published(project_id) or is_project_member(project_id, 'viewer'));

-- audit_logs: owner-only, never public, never client-writable (written exclusively via the service-role client).
create policy audit_logs_select_owner on audit_logs for select
  using (project_id is not null and is_project_member(project_id, 'owner'));
