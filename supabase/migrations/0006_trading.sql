-- Stage 5: 0x quotes and human-signed executions. No private key ever appears here.
create table trade_quotes (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references recommendations(id),
  provider text not null default '0x',
  sell_token text not null,
  buy_token text not null,
  sell_amount numeric not null,
  expected_buy_amount numeric not null,
  minimum_buy_amount numeric not null,
  estimated_gas numeric,
  provider_fee numeric,
  integrator_fee numeric,
  price_impact_bps integer,
  allowance_target text not null,
  transaction_target text not null,
  transaction_data_encrypted text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index trade_quotes_recommendation_idx on trade_quotes(recommendation_id, created_at desc);

create table trade_executions (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references trade_quotes(id),
  recommendation_id uuid not null references recommendations(id),
  operator_address text not null,
  approval_tx_hash text,
  swap_tx_hash text,
  status text not null default 'pending' check (status in ('pending', 'submitted', 'confirmed', 'failed')),
  failure_reason text,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
create index trade_executions_recommendation_idx on trade_executions(recommendation_id);
