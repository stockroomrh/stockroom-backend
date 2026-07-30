-- Stage 1/2/6: token config, treasury account, versioned policy.
create table project_tokens (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references projects(id) on delete cascade,
  name text not null,
  symbol text not null,
  total_supply numeric not null,
  decimals integer not null default 18,
  contract_address text,
  chain_id integer,
  deployment_tx_hash text,
  deployment_block bigint,
  deployer_address text,
  contract_version text not null default 'v1',
  verification_status text not null default 'pending' check (verification_status in ('pending', 'verified', 'failed')),
  treasury_allocation_bps integer not null default 0,
  status text not null default 'not_deployed' check (status in ('not_deployed', 'pending', 'deployed', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table treasury_accounts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references projects(id) on delete cascade,
  address text not null,
  chain_id integer not null,
  account_type text not null default 'eoa' check (account_type in ('eoa', 'multisig', 'smart_account')),
  base_currency text not null default 'USDG',
  last_synced_at timestamptz,
  last_synced_block bigint,
  last_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table treasury_policies (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references projects(id) on delete cascade,
  current_version_id uuid,
  minimum_reserve_bps integer not null,
  maximum_single_asset_bps integer not null,
  maximum_crypto_bps integer not null,
  maximum_trade_bps integer not null,
  require_human_approval boolean not null default true,
  allow_automated_execution boolean not null default false,
  trading_paused boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table treasury_policy_versions (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references treasury_policies(id) on delete cascade,
  version text not null,
  minimum_reserve_bps integer not null,
  maximum_single_asset_bps integer not null,
  maximum_crypto_bps integer not null,
  maximum_trade_bps integer not null,
  require_human_approval boolean not null default true,
  allow_automated_execution boolean not null default false,
  summary text not null default '',
  created_by uuid references profiles(id),
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index treasury_policy_versions_policy_idx on treasury_policy_versions(policy_id);

alter table treasury_policies
  add constraint treasury_policies_current_version_fk
  foreign key (current_version_id) references treasury_policy_versions(id);
