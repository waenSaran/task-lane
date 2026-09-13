# `/plan-feature` Handoff Contract

This document defines the machine boundary between Task Lane and the existing `/plan-feature` coding-agent skill. It is intentionally small and deterministic so Task Lane never has to infer workflow state from prose output.

## Ownership

`/plan-feature` remains the source of truth for:

- planning readiness and business ambiguity decisions
- combined implementation-plan drafting
- `/plan-check`
- TASK tree design
- TASK creation/reconciliation after approval
- `plan-publish`, `plan-ready`, readiness checks, comments, labels, and assignments in Plane

Task Lane owns orchestration, persistence, review UI, stale invalidation, retries, and run history.

## Invocation environment

Before invoking `/plan-feature`, the worker sets:

```text
TASK_LANE_RUN_ID=<planning run id>
TASK_LANE_HANDOFF_PATH=<absolute writable path for handoff JSON>
```

The skill writes the handoff atomically: write a temporary file first, then rename/replace the configured handoff path only after the JSON is complete.

A process exit without a valid handoff is a technical worker/agent failure.

## Contract version

Current contract version: `1.0`.

Every handoff MUST contain `contractVersion` and `runId`. Task Lane must reject unsupported contract versions instead of guessing how to interpret them.

## Skill statuses

The skill may emit these terminal handoff statuses:

- `READY_FOR_REVIEW` — draft and `/plan-check` are ready for human review; no Plane publication has happened yet.
- `BA_REVIEW_REQUIRED` — planning stopped because business/requirement information is materially unresolved. `/plan-feature` owns the Plane-side BA handoff.
- `PUBLISHED` — the approved draft was published/reconciled successfully in Plane.
- `STALE_DRAFT` — the draft/hash approved by the user no longer matches the draft presented for publication; no Plane publication may occur.

Technical failures such as CLI crashes, auth failures, invalid JSON, missing files, or process termination are not skill statuses. The worker records those as a failed `PlanningRun`.

## Base envelope

```json
{
  "contractVersion": "1.0",
  "runId": "run_123",
  "status": "READY_FOR_REVIEW",
  "planeId": "DOAE-1841"
}
```

`runId` MUST equal `TASK_LANE_RUN_ID`.

## `READY_FOR_REVIEW`

A ready handoff includes the exact draft artifact and the requirement source fingerprint used to produce it.

```json
{
  "contractVersion": "1.0",
  "runId": "run_123",
  "status": "READY_FOR_REVIEW",
  "planeId": "DOAE-1841",
  "draft": {
    "path": "/tmp/claude_drafts/260913_1830_leave-type.md",
    "sha256": "<sha256>"
  },
  "requirements": {
    "aggregateHash": "<hash>",
    "sources": [
      {
        "planeId": "DOAE-1841",
        "hash": "<hash>"
      }
    ]
  },
  "taskTreeReady": true
}
```

Task Lane then:

1. verifies the draft file exists
2. verifies its SHA-256 matches the handoff
3. copies it to immutable persistent storage, for example `/data/plans/<case-id>/<run-id>/v001.md`
4. stores revision metadata in PostgreSQL
5. presents that immutable revision for review

Every requested revision produces a new immutable `PlanRevision`; do not overwrite a prior reviewed draft.

## `BA_REVIEW_REQUIRED`

Example:

```json
{
  "contractVersion": "1.0",
  "runId": "run_123",
  "status": "BA_REVIEW_REQUIRED",
  "planeId": "DOAE-1841",
  "requirements": {
    "aggregateHash": "<hash>",
    "sources": []
  }
}
```

Task Lane records the case as BA review and does not retry automatically. It must not recreate or second-guess the skill's business reasoning.

When Plane later returns the UC from `BA-review` to the configured `DEV-review` eligibility state, Task Lane may resume/re-plan with the remembered repositories and agent, subject to repository availability.

## Approval safety

Approval is tied to one exact immutable revision.

Task Lane records at minimum:

```text
approvedRevisionId
approvedDraftSha256
approvedAt
```

On approval, the worker resumes the agent with the exact reviewed draft identity/hash. Before any Plane writes, `/plan-feature` MUST verify that the draft SHA-256 still matches the approved hash.

If the hash does not match, the skill emits `STALE_DRAFT` and performs no publication.

A fresh-session fallback must restore the persisted reviewed draft to the expected local draft path and verify its hash before continuing.

## `PUBLISHED`

Example:

```json
{
  "contractVersion": "1.0",
  "runId": "run_123",
  "status": "PUBLISHED",
  "planeId": "DOAE-1841",
  "draft": {
    "sha256": "<approved sha256>"
  }
}
```

Task Lane may mark the planning run complete only after receiving a valid `PUBLISHED` handoff. It should not infer publication by scraping natural-language output or by merely observing that the Plane UC still matches queue labels.

## Requirement fingerprint and stale checks

The handoff provides exact requirement source IDs/hashes plus an aggregate hash. Task Lane uses these for conservative invalidation, not to reproduce `/plan-feature` readiness semantics.

Before review/approval, Task Lane refetches the relevant Plane source family and compares it with the recorded fingerprint. Any relevant change may mark the case `STALE` and require a new planning run.

After a run is already `PUBLISHED`, a later requirements change becomes `REPLAN_REQUIRED`. Task Lane remembers prior repo/agent selections but does not auto-run the re-plan; the user explicitly starts it.

## Validation rules

Task Lane treats the handoff as invalid if any of these are true:

- JSON cannot be parsed
- `contractVersion` is unsupported
- `runId` does not match the active run
- `status` is unknown
- required fields for the emitted status are missing
- a referenced draft does not exist
- a referenced draft SHA-256 does not match

Invalid handoff is a technical failure. Do not silently fall back to parsing stdout.

## Evolution rule

Changes that alter required fields, status meaning, or publication safety must bump the contract version and update both Task Lane and `/plan-feature` together. Additive optional fields that old consumers can safely ignore may remain within the same version.
