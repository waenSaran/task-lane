import assert from "node:assert/strict";
import test from "node:test";
import { InvalidStateTransitionError } from "../src/errors.ts";
import {
  PLANNING_CASE_STATUSES,
  PLANNING_RUN_STATUSES,
  assertPlanningCaseTransition,
  assertPlanningRunTransition,
  canTransitionPlanningCase,
  canTransitionPlanningRun,
  type PlanningCaseStatus,
  type PlanningRunStatus,
} from "../src/state-machine.ts";

const CASE_ALLOWED: Record<PlanningCaseStatus, readonly PlanningCaseStatus[]> = {
  WAITING_REPO: ["PLANNING", "NO_LONGER_ELIGIBLE"],
  PLANNING: ["READY_FOR_REVIEW", "BA_REVIEW", "FAILED", "STALE", "NO_LONGER_ELIGIBLE"],
  READY_FOR_REVIEW: ["PLANNING", "FAILED", "PUBLISHED", "STALE", "NO_LONGER_ELIGIBLE"],
  BA_REVIEW: ["PLANNING"],
  FAILED: ["WAITING_REPO", "PLANNING"],
  PUBLISHED: ["REPLAN_REQUIRED"],
  STALE: ["WAITING_REPO", "PLANNING"],
  REPLAN_REQUIRED: ["WAITING_REPO", "PLANNING"],
  NO_LONGER_ELIGIBLE: ["WAITING_REPO", "PLANNING", "READY_FOR_REVIEW", "FAILED", "STALE"],
};

const RUN_ALLOWED: Record<PlanningRunStatus, readonly PlanningRunStatus[]> = {
  QUEUED: ["WAITING_REPO_LOCK", "FAILED"],
  WAITING_REPO_LOCK: ["SYNCING_REPO", "FAILED"],
  SYNCING_REPO: ["STARTING_AGENT", "FAILED"],
  STARTING_AGENT: ["RUNNING_PLAN", "FAILED"],
  RUNNING_PLAN: ["WAITING_FOR_REVIEW", "COMPLETED", "FAILED"],
  WAITING_FOR_REVIEW: ["RESUMING_AGENT", "FAILED"],
  RESUMING_AGENT: ["RUNNING_PLAN", "PUBLISHING", "FAILED"],
  PUBLISHING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: [],
};

for (const from of PLANNING_CASE_STATUSES) {
  for (const to of PLANNING_CASE_STATUSES) {
    const expected = CASE_ALLOWED[from].includes(to);
    test(`PlanningCase ${from} -> ${to} is ${expected ? "allowed" : "rejected"}`, () => {
      assert.equal(canTransitionPlanningCase(from, to), expected);
      if (expected) {
        assert.doesNotThrow(() => assertPlanningCaseTransition(from, to));
      } else {
        assert.throws(
          () => assertPlanningCaseTransition(from, to),
          (error: unknown) =>
            error instanceof InvalidStateTransitionError &&
            error.entity === "PlanningCase" &&
            error.from === from &&
            error.to === to,
        );
      }
    });
  }
}

for (const from of PLANNING_RUN_STATUSES) {
  for (const to of PLANNING_RUN_STATUSES) {
    const expected = RUN_ALLOWED[from].includes(to);
    test(`PlanningRun ${from} -> ${to} is ${expected ? "allowed" : "rejected"}`, () => {
      assert.equal(canTransitionPlanningRun(from, to), expected);
      if (expected) {
        assert.doesNotThrow(() => assertPlanningRunTransition(from, to));
      } else {
        assert.throws(
          () => assertPlanningRunTransition(from, to),
          (error: unknown) =>
            error instanceof InvalidStateTransitionError &&
            error.entity === "PlanningRun" &&
            error.from === from &&
            error.to === to,
        );
      }
    });
  }
}

test("critical impossible case transitions stay rejected", () => {
  assert.equal(canTransitionPlanningCase("FAILED", "PUBLISHED"), false);
  assert.equal(canTransitionPlanningCase("WAITING_REPO", "READY_FOR_REVIEW"), false);
  assert.equal(canTransitionPlanningCase("STALE", "PUBLISHED"), false);
});
