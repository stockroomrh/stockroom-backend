-- A single transaction can contain multiple distinct transfers (e.g. a
-- faucet call that sends several different tokens at once) — dedupe per
-- transfer, not per transaction, or all but one transfer silently vanish.
alter table activity_items drop constraint activity_items_project_id_tx_hash_key;
alter table activity_items add constraint activity_items_project_tx_asset_key unique (project_id, tx_hash, asset_symbol);
