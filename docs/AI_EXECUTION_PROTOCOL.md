# Task Lane AI Execution Protocol

This document defines how ChatGPT/Codex-style coding agents plan, implement, verify, review, and merge Task Lane work.

The goal is not merely to make CI green. The goal is to prove that an implementation satisfies the intended system contract, including cross-package and external-tool behavior.

## Source-of-truth order

Before implementation, coding agents must read the applicable sources in this order:

1. root `AGENTS.md`
2. `docs/ARCHITECTURE.md`
3. `docs/ARCHITECTURE_DECISIONS.md`
4. `docs/AI_EXECUTION_PROTOCOL.md`
5. boundary-specific canonical docs such as `docs/PLAN_FEATURE_HANDOFF.md`
6. the GitHub issue and its accepted review/guidance comments
7. existing code and tests

If two sources conflict, stop treating the older/lower-precedence interpretation as authoritative. Prefer an explicit accepted architecture decision over an earlier implementation proposal.

## Required implementation brief

Every non-trivial implementation issue must be translated into a compact executable brief before coding.

The brief must contain these sections:

### 1. Contract

Define exact inputs, outputs, side effects, persisted data, and failure behavior.

### 2. Invariants

State properties that must always remain true.

Examples:

- Task Lane never writes Plane directly.
- Planning source revisions are reproducible.
- An invalid repository cannot become a planning primary repository.
- Workflow state is never inferred from free-form agent stdout when a machine handoff is required.

### 3. Proof obligations

For every important behavior, state what evidence proves it is correct.

A unit test that only verifies mocked command arguments is not sufficient proof of an external CLI semantic contract.

Examples of stronger proof:

- inspect the exact pinned CLI's supported syntax/capabilities
- run a deterministic fixture through the real parser/validator
- prove runtime packaging contains the required built package
- prove the SHA being persisted corresponds to the exact tree that was validated
- prove missing/corrupt handoff data becomes a technical failure

### 4. Mandatory tests

List concrete success, failure, stale, mismatch, security, and regression cases before implementation.

### 5. Cross-issue interfaces

If multiple issues may execute in parallel, define the shared interface first.

Parallel branches must not independently invent incompatible contracts.

### 6. Non-goals

Explicitly state what belongs to downstream issues and what must not leak into the current change.

### 7. Adversarial self-review

Before opening or updating a PR, the implementing agent must ask:

> How could this implementation pass its own tests and still fail in production or violate the architecture?

The agent must inspect at least:

- mocked assumptions not proven against real runtime behavior
- stale files/state from prior runs
- mismatched identities, SHAs, run IDs, Plane IDs, or versions
- unsupported external-tool behavior
- source mutation or security boundary leaks
- runtime/container packaging omissions
- cross-PR/interface mismatches
- process exit success without required protocol output

Discovered edge cases require focused regression tests where practical.

## External CLI rule

For Codex, Grok, Git, or another external executable:

- pin versions deliberately where reproducibility requires it
- verify behavior against the exact pinned version, not memory
- prefer official documentation plus executable `--help`/version evidence
- separate command-construction tests from semantic/integration proof
- do not claim a capability exists merely because a fake executable accepted the arguments

If the implementation depends on skill discovery, resume semantics, sandboxing, authentication layout, network behavior, or output events, those capabilities require explicit proof.

## Runtime-boundary rule

Security constraints must be enforced at the intended boundary.

Do not satisfy a narrow invariant by breaking the whole runtime.

Example: "planning source is read-only" means the target source tree must not be mutated. It does not automatically mean the entire agent process must lose access to required temporary files, Task Lane-owned output paths, subprocesses, or Plane network access used by the existing `/plan-feature` workflow.

Tests must exercise the useful runtime behavior and the restricted boundary together.

## Protocol-output rule

When a workflow requires a machine-readable handoff:

- clear or rotate stale destination state before invocation
- bind the artifact to the active run identity
- validate all required context identities
- reject missing, corrupt, ambiguous, unsupported, or mismatched output as a technical failure
- never fall back to free-form stdout state inference

Process exit code `0` alone is not workflow success.

## TDD and verification

Use focused TDD for meaningful behavior:

1. write a focused failing test
2. confirm it fails for the intended reason
3. implement the smallest correct change
4. make the focused test pass
5. refactor while green

Before requesting merge, run:

- focused tests for the changed boundary
- issue-specified tests
- relevant integration/regression tests
- root test/typecheck/lint/build gates as applicable
- Docker/runtime verification when the change affects packaged/runtime behavior

CI is an independent regression gate, not the first or only verifier.

## PR completion contract

A PR is not merge-ready merely because CI is green.

Before merge, verify all of the following:

- issue acceptance criteria are satisfied
- invariants remain true
- proof obligations have evidence
- mandatory tests pass
- cross-issue interfaces remain compatible
- runtime packaging is complete
- no known security/secret leak exists
- no unresolved review blocker remains
- no downstream-scope behavior leaked into the PR

ChatGPT or another independent reviewer should inspect the actual diff and runtime contract rather than relying only on the implementing agent's summary.

## Parallel-work rule

Parallel implementation is encouraged only when shared contracts are already stable.

Safe pattern:

```text
shared contract first
  -> independent issue A
  -> independent issue B
  -> integration review
```

Unsafe pattern:

```text
issue A invents interface X
issue B independently invents interface Y
  -> reconcile only after both PRs are complete
```

When a shared contract is still changing, stabilize it first or serialize the dependent work.

## Merge authority

Implementing agents must not merge their own Task Lane implementation PRs unless a human explicitly changes this policy.

The normal flow is:

```text
human/ChatGPT defines contract and proof obligations
  -> Codex implements in an isolated branch/worktree
  -> Codex self-reviews and runs verification
  -> GitHub CI
  -> independent ChatGPT review
  -> fix loop if needed
  -> merge
```

## Lessons encoded from the A/B/C implementation cycle

The following classes of failure are now explicitly guarded against:

- validating one Git tree while persisting the SHA of another
- prerequisite parsers that pass synthetic fixtures but fail the canonical skill
- external CLI tests that verify argument forwarding without proving skill invocation
- read-only sandboxing applied so broadly that required subprocess/network/output behavior stops working
- packages implemented in source but missing from the final worker image
- handoff consumers that validate JSON in isolation but are not enforced at the runner boundary
- stale handoff reuse across runs
- cross-PR instruction formats that silently bypass adapter translation
- protocol designs that require modifying the canonical HRCS `/plan-feature` despite Task Lane not owning that business workflow
