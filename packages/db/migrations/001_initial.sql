create table repositories (
  id text primary key,
  name text not null,
  ssh_url text not null,
  local_path text not null,
  validation_status text not null check (validation_status in ('PENDING', 'VALID', 'INVALID')),
  last_synced_sha text,
  last_used_agent text check (last_used_agent is null or last_used_agent in ('CODEX', 'GROK')),
  last_used_related_repo_ids text[] not null default '{}',
  validation_report jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index repositories_ssh_url_uidx on repositories (ssh_url);

create table planning_cases (
  id text primary key,
  plane_issue_id text not null unique,
  plane_identifier text not null unique,
  title text not null,
  current_status text not null check (current_status in (
    'WAITING_REPO', 'PLANNING', 'READY_FOR_REVIEW', 'BA_REVIEW', 'FAILED',
    'PUBLISHED', 'STALE', 'REPLAN_REQUIRED', 'NO_LONGER_ELIGIBLE'
  )),
  previous_status text check (previous_status is null or previous_status in (
    'WAITING_REPO', 'PLANNING', 'READY_FOR_REVIEW', 'BA_REVIEW', 'FAILED',
    'PUBLISHED', 'STALE', 'REPLAN_REQUIRED', 'NO_LONGER_ELIGIBLE'
  )),
  eligibility text not null check (eligibility in ('ELIGIBLE', 'INELIGIBLE')),
  primary_repo_id text references repositories(id) on delete set null,
  preferred_agent text check (preferred_agent is null or preferred_agent in ('CODEX', 'GROK')),
  last_published_run_id text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index planning_cases_status_idx on planning_cases (current_status);
create index planning_cases_eligibility_idx on planning_cases (eligibility);

create table planning_runs (
  id text primary key,
  planning_case_id text not null references planning_cases(id) on delete cascade,
  run_type text not null check (run_type in ('INITIAL', 'REVISION', 'REPLAN', 'RETRY')),
  agent text not null check (agent in ('CODEX', 'GROK')),
  agent_version text,
  session_id text,
  repo_revisions jsonb not null default '[]'::jsonb,
  requirement_fingerprint text,
  status text not null check (status in (
    'QUEUED', 'WAITING_REPO_LOCK', 'SYNCING_REPO', 'STARTING_AGENT', 'RUNNING_PLAN',
    'WAITING_FOR_REVIEW', 'RESUMING_AGENT', 'PUBLISHING', 'COMPLETED', 'FAILED'
  )),
  started_at timestamptz,
  finished_at timestamptz,
  failure jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index planning_runs_case_idx on planning_runs (planning_case_id, created_at desc);
create index planning_runs_status_idx on planning_runs (status);

alter table planning_cases
  add constraint planning_cases_last_published_run_fk
  foreign key (last_published_run_id) references planning_runs(id) on delete set null;

create table plan_revisions (
  id text primary key,
  planning_run_id text not null references planning_runs(id) on delete cascade,
  version integer not null check (version > 0),
  draft_path text not null,
  sha256 text not null,
  created_at timestamptz not null,
  approved_at timestamptz,
  unique (planning_run_id, version)
);

create table review_feedback (
  id text primary key,
  revision_id text not null references plan_revisions(id) on delete cascade,
  sections text[] not null,
  comment text not null,
  created_at timestamptz not null
);

create table jobs (
  id text primary key,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null check (status in ('QUEUED', 'LEASED', 'COMPLETED', 'FAILED')),
  priority integer not null default 0,
  available_at timestamptz not null,
  lease_owner text,
  lease_expires_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index jobs_claim_idx on jobs (status, available_at, priority desc, created_at);
create index jobs_lease_expiry_idx on jobs (lease_expires_at) where status = 'LEASED';

create table settings (
  id text primary key check (id = 'global'),
  default_agent text not null check (default_agent in ('CODEX', 'GROK')),
  agent_concurrency integer not null check (agent_concurrency > 0),
  log_retention_days integer not null check (log_retention_days > 0),
  fetch_times text[] not null,
  timezone text not null,
  updated_at timestamptz not null
);

create table schedule_slots (
  slot_key text primary key,
  scheduled_at timestamptz not null,
  status text not null check (status in ('PENDING', 'SUCCESS', 'FAILED')),
  completed_at timestamptz,
  error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
