-- activity_items.raw_amount was always being displayed as the raw onchain
-- integer (wei/smallest-unit) with no decimal conversion, and usd_value was
-- never actually computed at insertion time (always null) — both real bugs
-- affecting the web dashboard's activity feed and Telegram alerts alike.
-- Storing decimals per activity row (rather than joining asset_registry by
-- symbol on every read) keeps display cheap and correct even if an asset's
-- registry entry changes later — the row reflects what was true when the
-- activity was recorded.
alter table activity_items add column decimals integer not null default 18;
