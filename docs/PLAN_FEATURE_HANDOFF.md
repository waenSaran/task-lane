# `/plan-feature` Handoff Contract

This document defines the deterministic machine boundary Task Lane places around the existing `/plan-feature` coding-agent skill. Task Lane must never infer workflow state from prose output and must not modify or duplicate the skill's business/readiness logic.

See `docs/ARCHITECTURE_DECISIONS.md` for the accepted ownership decision.

## Ownership

The existing `/plan-feature` remains the source of truth for:

- planning readiness and business ambiguity decisions
- combined implementation-plan drafting
- `/plan-check`
- TASK tree design
- TASK creation/reconciliation after approval
- `plan-publish`, `plan-ready`, readiness checks, comments, labels, and assignments in Plane
- all Plane writes

Task Lane owns:

- orchestration and agent invocation
- persistence and review UI
- stale invalidation, retries, and run history
- the machine handoff protocol
- a Task Lane-owned handoff helper
- mechanical verification of run IDs, Plane IDs, file identities, hashes, schema, and protocol version

Task Lane must not recreate `/plan-feature` readiness semantics or business decisions.

## Canonical execution flow

```text
Task Lane
  -> AgentAdapter
  -> TaskLanePlanFeatureRunner
  -> Codex/Grok
  -> existing /plan-feature unchanged
  -> agent observes the skill's terminal workflow boundary
  -> Task Lane-owned handoff helper writes strict JSON
  -> TaskLanePlanFeatureRunner validates the handoff
```

The Task Lane helper serializes terminal facts; it does not decide business readiness itself.

## Invocation environment and stale-output safety

Before invoking the agent, the runner provides at minimum:

```text
TASK_LANE_RUN_ID=<planning run id>
TASK_LANE_HANDOFF_PATH=<absolute writable path for handoff JSON>
```

The active runner context also knows the expected Plane UC identifier and validates the returned `planeId` against it.

Before each start or resume attempt, Task Lane must clear or rotate any prior handoff at the destination path so a stale artifact cannot be mistaken for the current run's output.

The Task Lane-owned helper writes handoff JSON atomically: write a temporary file in the same filesystem, close it, then rename/replace `TASK_LANE_HANDOFF_PATH` only after the JSON is complete.

A process exit without one valid current handoff is a technical worker/agent failure, even when the process exit code is `0`.

## Contract version

Current contract version: `1.0`.

Every handoff MUST contain `contractVersion`, `runId`, `status`, and `planeId`.

Task Lane must reject unsupported versions instead of guessing how to interpret them.

## Terminal statuses

The Task Lane handoff protocol supports exactly these terminal statuses in v1:

- `READY_FOR_REVIEW` — the existing skill completed its draft/readiness flow and `/plan-check`; no Plane publication has happened yet.
- `BA_REVIEW_REQUIRED` — the existing skill stopped because material business/requirement information is unresolved and completed its normal BA handling.
- `PUBLISHED` — the approved draft completed the existing skill's publication/reconciliation/readiness flow successfully.
- `STALE_DRAFT` — mechanical verification proves the exact approved draft identity no longer matches the draft that would be published; no publication may proceed.

Technical failures such as CLI crashes, auth failures, missing/corrupt JSON, mismatched run/Plane IDs, unsupported versions, filesystem failures, or process termination are not workflow statuses. The worker records them as technical `PlanningRun` failures.

## Base envelope

```json
{
  "contractVersion": "1.0",
  "runId": "run_123",
  "status": "READY_FOR_REVIEW",
  "planeId": "DOAE-1841"
}
```

Validation requires:

- `runId` equals the active planning run ID
- `planeId` equals the Plane UC expected by the active Task Lane invocation
- `status` is one of the supported terminal statuses

## `READY_FOR_REVIEW`

A ready handoff includes the exact draft artifact and the requirement source fingerprint associated with the skill run.

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

The helper may compute file hashes mechanically, but Task Lane must not decide whether the business plan is ready. `READY_FOR_REVIEW` is valid only after the existing `/plan-feature` flow has reached that terminal boundary.

Task Lane then:

1. verifies the handoff schema/version/run/Plane identity
2. verifies the draft file exists
3. verifies its SHA-256 matches the handoff
4. copies it to immutable persistent storage, for example `/data/plans/<case-id>/<run-id>/v001.md`
5. stores revision metadata in PostgreSQL
6. presents that immutable revision for review

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

The handoff may report `BA_REVIEW_REQUIRED` only after the existing skill has reached its normal BA terminal boundary. Task Lane records the case as BA review and does not recreate or second-guess the skill's reasoning.

When Plane later returns the UC from `BA-review` to the configured `DEV-review` eligibility state, Task Lane may resume/re-plan with the remembered repositories and agent, subject to repository availability.

## Approval safety and `STALE_DRAFT`

Approval is tied to one exact immutable revision.

Task Lane records at minimum:

```text
approvedRevisionId
approvedDraftSha256
approvedAt
```

Before an approval-triggered publication continuation, the Task Lane bridge mechanically verifies that the current draft bytes still match `approvedDraftSha256`.

If they do not match:

1. write a valid `STALE_DRAFT` handoff for the active run
2. perform no publication continuation
3. treat the run as a protocol-level stale result, not as successful publication

This hash comparison is mechanical identity verification; it is not planning/business logic.

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

`PUBLISHED` may be written only after the existing `/plan-feature` flow has completed its publication/reconciliation/readiness work successfully.

Task Lane may mark the planning run complete only after receiving and validating this handoff. It must not infer publication by scraping natural-language output or by merely observing Plane queue labels.

## Requirement fingerprint and stale checks

The handoff can carry exact requirement source IDs/hashes plus an aggregate hash. Task Lane uses these for conservative mechanical invalidation, not to reproduce `/plan-feature` readiness semantics.

Before review/approval, Task Lane refetches the relevant Plane source family and compares it with the recorded fingerprint. Any relevant change may mark the case `STALE` and require a new planning run.

After a run is already `PUBLISHED`, a later requirements change becomes `REPLAN_REQUIRED`. Task Lane remembers prior repo/agent selections but does not auto-run the re-plan; the user explicitly starts it.

## Validation rules

Task Lane treats the handoff as invalid if any of these are true:

- no current handoff exists after the agent attempt completes
- JSON cannot be parsed
- `contractVersion` is unsupported
- `runId` does not match the active run
- `planeId` does not match the active Plane UC
- `status` is unknown
- required fields for the emitted status are missing
- a referenced draft does not exist
- a referenced draft SHA-256 does not match
- the file is demonstrably stale output from another attempt

Invalid handoff is a technical failure. Do not silently fall back to parsing stdout.

## Agent/adaptor responsibility

Task Lane presents an agent-agnostic `/plan-feature <Plane UC>` operation to the planning runner.

An adapter may translate that operation into the exact explicit skill-invocation syntax required by its pinned CLI. The translation must preserve the same canonical existing skill and must not create a divergent Task Lane copy of `/plan-feature` business instructions.

The runner is responsible for enforcing that a successful agent attempt is followed by a valid handoff before workflow state advances.

## Evolution rule

Changes that alter required fields, status meaning, identity verification, or publication safety must bump the contract version and update the Task Lane runner/helper/consumer together.

Task Lane-specific protocol evolution must not require modifying the canonical HRCS `/plan-feature` skill. If the underlying business workflow itself changes independently, update the architecture decision and relevant business sources explicitly rather than coupling that change to the machine protocol.

Additive optional fields that old consumers can safely ignore may remain within the same contract version.
