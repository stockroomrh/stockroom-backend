-- Stage 3: chain-derived treasury data. Snapshots are the source of truth for
-- point-in-time valuation; activity_items is the public ledger.
create table treasury_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  block_number bigint,
  total_value_usd numeric not null,
  reserve_value_usd numeric not null,
  captured_at timestamptz not null default now()
);
create index treasury_snapshots_project_idx on treasury_snapshots(project_id, captured_at desc);

create table treasury_positions (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references treasury_snapshots(id) on delete cascade,
  asset_id uuid not null references asset_registry(id),
  raw_balance numeric not null,
  display_balance numeric not null,
  price_usd numeric not null,
  value_usd numeric not null,
  allocation_bps integer not null,
  price_source text not null,
  price_updated_at timestamptz,
  is_stale boolean not null default false,
  created_at timestamptz not null default now()
);
create index treasury_positions_snapshot_idx on treasury_positions(snapshot_id);

create table activity_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  tx_hash text,
  block_number bigint,
  occurred_at timestamptz not null default now(),
  activity_type text not null check (activity_type in ('Deposit', 'Revenue', 'Trade', 'Expense', 'Withdrawal', 'Unclassified', 'Policy', 'Report')),
  description text not null default '',
  asset_symbol text,
  raw_amount numeric,
  usd_value numeric,
  status text not null default 'confirmed' check (status in ('confirmed', 'pending', 'needs_review')),
  classified_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (project_id, tx_hash)
);
create index activity_items_project_idx on activity_items(project_id, occurred_at desc);
