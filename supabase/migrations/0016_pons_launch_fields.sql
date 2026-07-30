-- Live mainnet launches go through Pons's PonsLaunchFactory (real Uniswap V3
-- market + trading fees redirected to the project treasury) instead of the
-- plain StockroomToken.sol deployment; testnet keeps using the plain path
-- since Pons has no testnet deployment. These columns distinguish which
-- mechanism a given project's token used and record the resulting pool.
alter table project_tokens add column launch_provider text not null default 'stockroom' check (launch_provider in ('stockroom', 'pons'));
alter table project_tokens add column pool_address text;
