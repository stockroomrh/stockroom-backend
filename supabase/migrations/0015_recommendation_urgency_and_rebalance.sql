-- Stage 4: AI CFO output includes a "rebalance" action and an urgency level.
alter table recommendations drop constraint recommendations_action_check;
alter table recommendations add constraint recommendations_action_check check (action in ('BUY', 'SELL', 'HOLD', 'BUILD_RESERVES', 'REBALANCE'));
alter table recommendations add column urgency text check (urgency in ('low', 'medium', 'high'));
