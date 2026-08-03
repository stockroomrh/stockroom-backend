-- Telegram treasury alerts MVP: one linked chat per project, deposit/
-- withdrawal alerts, an optional daily summary, and a link-code flow so
-- linking a chat requires real operator access (the code is only ever
-- shown inside the authenticated Operator Console) rather than trusting
-- whoever happens to message the bot first.

alter table activity_items add column counterparty_address text;

create table telegram_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references projects(id) on delete cascade,
  chat_id text not null,
  chat_title text,
  linked_by uuid references profiles(id),
  daily_summary_enabled boolean not null default true,
  last_alerted_activity_at timestamptz,
  last_daily_summary_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index telegram_links_chat_idx on telegram_links(chat_id);

create table telegram_link_codes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  code text not null unique,
  created_by uuid references profiles(id),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index telegram_link_codes_code_idx on telegram_link_codes(code);

alter table telegram_links enable row level security;
alter table telegram_link_codes enable row level security;

-- Same visibility model as recommendations/plans: operator workflow, member-only, never public.
create policy telegram_links_select on telegram_links for select using (is_project_member(project_id, 'operator'));
create policy telegram_link_codes_select on telegram_link_codes for select using (is_project_member(project_id, 'operator'));
