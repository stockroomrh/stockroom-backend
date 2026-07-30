-- Stage 1: identity and project membership.
create extension if not exists pgcrypto;

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  wallet_address text not null unique,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  ticker text not null,
  description text not null default '',
  short_description text not null default '',
  logo_url text,
  website_url text,
  socials jsonb not null default '{}'::jsonb,
  treasury_objective text not null default '',
  chain_id integer not null,
  owner_profile_id uuid not null references profiles(id),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_status_idx on projects(status);
create index projects_owner_idx on projects(owner_profile_id);

create table project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'operator', 'viewer')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (project_id, profile_id)
);
create index project_members_profile_idx on project_members(profile_id);
