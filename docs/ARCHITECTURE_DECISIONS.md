# Task Lane Architecture Decisions

This file records explicit architecture decisions that refine or supersede earlier proposals. Coding agents must treat accepted decisions here as binding and keep `docs/ARCHITECTURE.md`, `docs/PLAN_FEATURE_HANDOFF.md`, issue acceptance criteria, and implementation consistent with them.

Do not use this file for transient implementation notes. New entries require explicit human approval when they change ownership, interfaces, or system boundaries.

## ADR-001: `/plan-feature` integration ownership

**Status:** Accepted  
**Date:** 2026-09-14

### Context

Task Lane must orchestrate the existing `/plan-feature` workflow across Codex and Grok without becoming a second owner of planning semantics or Plane mutations.

An earlier producer-side approach proposed modifying `softsq-th/DOAE-HRCS/.claude/skills/plan-feature/` so the skill itself emitted Task Lane handoff JSON. That approach is superseded.

### Decision

Do **not** modify the canonical HRCS `/plan-feature` skill for Task Lane integration.

`softsq-th/DOAE-HRCS/.claude/skills/plan-feature/` remains unchanged by Task Lane-specific protocol work.

HRCS `/plan-feature` remains the owner of:

- business readiness decisions
- BA ambiguity handling
- planning semantics
- `/plan-check`
- TASK tree design
- TASK creation/reconciliation
- plan publication/readiness behavior
- all Plane writes

Task Lane owns only:

- orchestration
- agent/runtime invocation
- machine protocol
- persistence and review state
- mechanical verification of protocol artifacts and identities
- retries and run history

Task Lane must never duplicate `/plan-feature` business/readiness logic.

### Canonical execution flow

```text
Task Lane
  -> AgentAdapter
  -> TaskLanePlanFeatureRunner
  -> Codex/Grok
  -> existing /plan-feature unchanged
  -> Task Lane-owned handoff helper
  -> strict JSON handoff
```

After the existing skill reaches a terminal workflow boundary, the agent uses a Task Lane-owned helper to write the machine-readable handoff.

The handoff protocol supports exactly these v1 terminal statuses:

- `READY_FOR_REVIEW`
- `BA_REVIEW_REQUIRED`
- `PUBLISHED`
- `STALE_DRAFT`

Missing, corrupt, ambiguous, stale, mismatched, or unsupported handoff data is a **technical failure**. Task Lane must not recover workflow state by parsing free-form stdout.

### Superseded producer work

`softsq-th/DOAE-HRCS` PR `#1218` is superseded by this decision.

It must not be reopened or cherry-picked as the Task Lane integration path.

Useful concepts from that exploration may be reimplemented on the Task Lane side only when they preserve the ownership boundary above.

### Consequences

- Task Lane PRs may add protocol schemas, validators, runners, helper tooling, and mechanical checks.
- Task Lane must not patch HRCS planning instructions to emit protocol state.
- Agent adapters may translate Task Lane's agent-agnostic invocation into the exact syntax required by the pinned CLI, but the semantic operation remains the existing `/plan-feature` skill.
- CI success alone is insufficient proof that the workflow boundary is correct; cross-component protocol behavior must be verified independently.
