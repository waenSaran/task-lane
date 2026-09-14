# Task Lane Architecture

This document defines the stable system boundaries that coding agents must preserve. Keep it concise; implementation details belong in code and issue acceptance criteria.

## Purpose

Task Lane is a local, single-user orchestration service for the existing Plane + `/plan-feature` workflow. It discovers eligible Plane UCs, lets the user select repositories and an agent, runs planning, persists reviewable plan revisions, and resumes the same planning flow after human review.

Task Lane orchestrates the workflow. `/plan-feature` owns planning decisions and Plane writes.

## Runtime shape

```text
Browser
  |
  v
SvelteKit web/API
  |
  v
PostgreSQL <---- Node/TypeScript worker
                   |
                   +--> Plane API (read-only from Task Lane)
                   +--> Git repositories
                   +--> Codex CLI / Grok CLI
                   +--> /plan-feature
```

Docker Compose runs three services on macOS:

- `web` — SvelteKit UI and HTTP API served by adapter-node
- `worker` — scheduler, DB-backed jobs, repo sync, and agent execution
- `postgres` — durable workflow state and queue storage

The web UI binds to `127.0.0.1` only. Task Lane v1 has no multi-user authentication and is not intended for remote deployment.

## Repository layout

```text
apps/web        SvelteKit UI and API
apps/worker     background worker
packages/domain shared workflow types and invariants
packages/db     PostgreSQL access and queue primitives
packages/plane  read-only Plane integration
packages/repos  repository registry, validation, sync, and leases
packages/agents agent adapter contracts and CLI adapters
packages/planning planning orchestration
packages/config shared configuration
```

Keep boundaries directional where practical: application packages may depend on shared packages, but shared packages should not import application code.

## Sources of truth

Do not collapse these domains into one state model:

- **Plane** owns external work-item facts: UC content, labels, state, assignees, and story/task hierarchy.
- **Task Lane** owns orchestration state: cases, runs, revisions, review feedback, retries, stale/re-plan state, and runtime history.
- **Git** owns source revisions. Every planning run records the exact commit SHA for every selected repository.
- **`/plan-feature`** owns readiness decisions, implementation-plan semantics, TASK creation/reconciliation, `plan-ready`, comments, assignments, and all other Plane writes.

Task Lane must not reproduce `/plan-feature` readiness logic or infer business requirements on its own.

## Plane boundary

Task Lane may:

- fetch Plane data
- detect configured queue eligibility
- snapshot requirement/source fingerprints
- compare source snapshots for conservative stale invalidation

Task Lane must not directly:

- change Plane state or labels
- create/edit comments
- create/reconcile child TASKs
- change assignments

All Plane writes happen inside `/plan-feature` through repository Plane tooling.

## Planning flow

```text
eligible UC
  -> choose primary repo (+ optional related repos) and agent
  -> acquire repo planning lease
  -> sync main and record commit SHA(s)
  -> start/resume coding-agent session
  -> invoke /plan-feature
  -> consume machine handoff

READY_FOR_REVIEW
  -> persist immutable plan revision
  -> human Approve or Request changes

Request changes
  -> resume agent
  -> create a new immutable revision

Approve
  -> re-check requirement freshness
  -> resume exact reviewed draft by SHA
  -> /plan-feature performs Plane publication
  -> PUBLISHED
```

Business ambiguity is not a technical failure. `/plan-feature` returns the work to BA and emits `BA_REVIEW_REQUIRED` rather than guessing.

## Repository and concurrency model

A planning case uses one primary repository and zero or more related repositories.

For v1:

- planning reads branch `main`
- each selected repository is synced before a new run and its SHA is recorded
- source is read-only during planning; Task Lane does not implement features in target repositories
- a repository has a per-repository planning lease while an active case depends on its shared checkout
- default agent concurrency is 1

The worker keeps repository storage writable for trusted clone/fetch/revalidation code at `/data/repos`.
It exposes the same host storage a second time at `/data/agent-repos` as a read-only mount. Agent
adapters translate a managed checkout path to this agent-facing view before starting Codex or Grok;
plans, handoffs, logs, scratch files, and agent sessions use separate writable paths. This gives
repository management and planning source safety separate filesystem views without copying the
repository.

Do not replace the lease model with shared concurrent mutation. If throughput later requires it, use an explicit migration to per-run worktrees/snapshots.

## Agent boundary

Agent integrations implement a common adapter contract for start, resume, capability detection, and health checks.

- Prefer resuming the same session.
- If resume is unsupported or the session is unavailable, start a fresh session and recover from the persisted draft/checkpoint.
- Record the actual agent name and version used by every run.
- Do not infer workflow state from natural-language stdout when a valid machine handoff exists.

## Persistence

PostgreSQL stores workflow metadata and the DB-backed queue.

Persistent host data lives under:

```text
~/.task-lane/repos
~/.task-lane/plans
~/.task-lane/logs
```

Plan revisions are immutable files with DB metadata. Full run logs are persisted separately and may expire according to retention policy; workflow metadata remains durable.

## Queue and retry rules

The worker claims jobs transactionally using PostgreSQL locking (`FOR UPDATE SKIP LOCKED`). No Redis or RabbitMQ is required in v1.

Technical failures do not auto-retry. A failed job remains failed until the user explicitly retries it. Retry prefers the same agent session and falls back to checkpoint recovery.

## Change guardrails

Do not introduce these without an explicit issue and human approval:

- Redis, RabbitMQ, or another queue system
- Kubernetes or remote deployment architecture
- multi-user auth/RBAC
- Plane writes outside `/plan-feature`
- automatic business-rule inference
- parallel planning that violates repository SHA reproducibility
- React/Next.js or a second frontend/component framework alongside the canonical Svelte stack

For UI-specific rules, follow the root `AGENTS.md`.
