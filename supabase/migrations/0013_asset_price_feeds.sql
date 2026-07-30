alter table asset_registry add column price_feed_address text;
alter table asset_registry add column price_feed_heartbeat_seconds integer not null default 3600;
