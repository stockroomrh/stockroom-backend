-- Stage 6/7: token deployment records and the sensitive-operation audit trail.
create table deployment_records (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  contract_address text,
  deployment_tx_hash text,
  deployer_address text not null,
  chain_id integer not null,
  deployment_block bigint,
  contract_version text not null default 'v1',
  verification_status text not null default 'pending' check (verification_status in ('pending', 'verified', 'failed')),
  token_supply numeric not null,
  treasury_allocation_bps integer not null default 0,
  created_at timestamptz not null default now()
);
create index deployment_records_project_idx on deployment_records(project_id);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id),
  actor_profile_id uuid references profiles(id),
  action text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_project_idx on audit_logs(project_id, created_at desc);
