-- Stage 4b: Treasury Plans. A plan sequences several recommendations behind
-- one objective, but does not introduce a second policy authority — every
-- step is still a normal row in `recommendations`, independently evaluated by
-- lib/server/policy/policy-engine.ts exactly as a standalone recommendation
-- would be. plan_steps only adds ordering, human-readable conditions and a
-- stop rule on top of an otherwise unchanged recommendation lifecycle.
create table treasury_plans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  objective text not null,
  reserve_target_bps integer,
  allocation_targets jsonb not null default '[]'::jsonb,
  review_cadence text not null default 'weekly' check (review_cadence in ('daily', 'weekly', 'monthly')),
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'completed', 'cancelled')),
  model text,
  prompt_version text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index treasury_plans_project_idx on treasury_plans(project_id, created_at desc);

create table plan_steps (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references treasury_plans(id) on delete cascade,
  recommendation_id uuid not null references recommendations(id) on delete cascade,
  step_order integer not null,
  condition text,
  stop_rule text,
  created_at timestamptz not null default now(),
  unique (plan_id, step_order),
  unique (recommendation_id)
);
create index plan_steps_plan_idx on plan_steps(plan_id, step_order);

alter table treasury_plans enable row level security;
alter table plan_steps enable row level security;

-- Plans are operator workflow, same visibility as recommendations: member-only, never public.
create policy treasury_plans_select on treasury_plans for select using (is_project_member(project_id, 'viewer'));
create policy treasury_plans_write_operator on treasury_plans for update
  using (is_project_member(project_id, 'operator')) with check (is_project_member(project_id, 'operator'));

create policy plan_steps_select on plan_steps for select
  using (exists (select 1 from treasury_plans tp where tp.id = plan_id and is_project_member(tp.project_id, 'viewer')));
