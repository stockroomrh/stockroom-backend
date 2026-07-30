-- Stage 4: AI CFO reports and the deterministic recommendation lifecycle.
-- The model never decides its own policy outcome — policy_result is written
-- by lib/server/policy/policy-engine.ts, never by the LLM.
create table agent_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  snapshot_id uuid references treasury_snapshots(id),
  report_type text not null default 'manual' check (report_type in ('manual', 'scheduled', 'post_trade')),
  financial_health text not null check (financial_health in ('healthy', 'watch', 'critical')),
  summary text not null,
  findings jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  public_report text not null default '',
  model text,
  prompt_version text,
  raw_response jsonb,
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);
create index agent_reports_project_idx on agent_reports(project_id, created_at desc);

create table recommendations (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references agent_reports(id),
  project_id uuid not null references projects(id) on delete cascade,
  action text not null check (action in ('BUY', 'SELL', 'HOLD', 'BUILD_RESERVES')),
  asset_symbol text,
  asset_address text,
  suggested_notional_usd numeric,
  target_allocation_bps integer,
  rationale text not null default '',
  policy_result jsonb,
  status text not null default 'proposed' check (status in (
    'proposed', 'policy_blocked', 'pending_review', 'approved', 'rejected',
    'quote_requested', 'quote_expired', 'awaiting_signature', 'submitted',
    'confirmed', 'failed', 'cancelled'
  )),
  expires_at timestamptz,
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);
create index recommendations_project_idx on recommendations(project_id, created_at desc);

create table recommendation_events (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references recommendations(id) on delete cascade,
  event_type text not null,
  actor_profile_id uuid references profiles(id),
  detail jsonb,
  created_at timestamptz not null default now()
);
create index recommendation_events_recommendation_idx on recommendation_events(recommendation_id, created_at);
