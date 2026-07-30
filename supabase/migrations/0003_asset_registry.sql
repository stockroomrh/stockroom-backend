-- Stage 3: verified asset registry (never trust addresses submitted by the browser)
-- and per-project approved-asset rules (the live version of lib/asset-catalog.ts).
create table asset_registry (
  id uuid primary key default gen_random_uuid(),
  chain_id integer not null,
  contract_address text not null,
  symbol text not null,
  display_symbol text,
  name text not null,
  decimals integer not null default 18,
  asset_type text not null check (asset_type in ('Stablecoin', 'Crypto', 'Stock Token', 'ETF Token')),
  price_source text not null default 'chainlink' check (price_source in ('chainlink', 'robinhood_rest', 'swap_quote')),
  current_multiplier numeric not null default 1,
  display_precision integer not null default 2,
  verification_status text not null default 'unverified' check (verification_status in ('unverified', 'verified', 'flagged')),
  metadata_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chain_id, contract_address)
);

create table project_approved_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  asset_id uuid not null references asset_registry(id),
  approved boolean not null default false,
  max_allocation_bps integer not null default 0,
  max_single_purchase_usd numeric not null default 0,
  agent_may_recommend boolean not null default false,
  automatic_execution boolean not null default false,
  trading_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, asset_id)
);
create index project_approved_assets_project_idx on project_approved_assets(project_id);

create table agent_settings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references projects(id) on delete cascade,
  objective text not null default '',
  risk_profile text not null default 'Balanced' check (risk_profile in ('Conservative', 'Balanced', 'Growth')),
  reporting_frequency text not null default 'Weekly' check (reporting_frequency in ('Daily', 'Weekly', 'Monthly')),
  recommendation_preference text not null default 'Policy-first, conservative proposals',
  model text,
  prompt_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
