-- Draft state for launching a new Stockroom project entirely from Telegram
-- (a separate bot from the operator alerts bot). The conversation is
-- inherently multi-step and the webhook is stateless per-request, so the
-- in-progress answers have to live somewhere between messages — this table
-- is that, keyed by chat rather than by project (the project doesn't exist
-- yet). draft_token is the unguessable bearer credential the web sign-in
-- page uses to pull this draft up — nobody is authenticated at this point,
-- the wallet signature at the end is what actually authorizes anything.
create table telegram_launch_drafts (
  id uuid primary key default gen_random_uuid(),
  chat_id text not null,
  draft_token text not null unique,
  step text not null default 'project_name',
  status text not null default 'in_progress', -- in_progress | awaiting_signature | completed | abandoned
  data jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index telegram_launch_drafts_chat_idx on telegram_launch_drafts(chat_id);

alter table telegram_launch_drafts enable row level security;
-- No select/insert/update policies: this table has no authenticated owner
-- until the project it describes actually exists, so every access path is
-- the service role (the launch webhook, and the draft-token lookup the
-- sign-in page uses) rather than a logged-in user's own session.
