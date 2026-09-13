export const PLANNING_CASE_STATUSES = [
  "WAITING_REPO",
  "PLANNING",
  "READY_FOR_REVIEW",
  "BA_REVIEW",
  "FAILED",
  "PUBLISHED",
  "STALE",
  "REPLAN_REQUIRED",
  "NO_LONGER_ELIGIBLE",
] as const;

export type PlanningCaseStatus = (typeof PLANNING_CASE_STATUSES)[number];

export const PLANNING_RUN_STATUSES = [
  "QUEUED",
  "WAITING_REPO_LOCK",
  "SYNCING_REPO",
  "STARTING_AGENT",
  "RUNNING_PLAN",
  "WAITING_FOR_REVIEW",
  "RESUMING_AGENT",
  "PUBLISHING",
  "COMPLETED",
  "FAILED",
] as const;

export type PlanningRunStatus = (typeof PLANNING_RUN_STATUSES)[number];
export type StateMachineEntity = "PlanningCase" | "PlanningRun";

export class InvalidStateTransitionError extends Error {
  readonly code = "INVALID_STATE_TRANSITION" as const;

  constructor(
    readonly entity: StateMachineEntity,
    readonly from: string,
    readonly to: string,
  ) {
    super(`Illegal ${entity} transition: ${from} -> ${to}`);
    this.name = "InvalidStateTransitionError";
  }
}

const planningCaseTransitions = {
  WAITING_REPO: ["PLANNING", "NO_LONGER_ELIGIBLE"],
  PLANNING: ["READY_FOR_REVIEW", "BA_REVIEW", "FAILED", "STALE", "NO_LONGER_ELIGIBLE"],
  READY_FOR_REVIEW: ["PLANNING", "FAILED", "PUBLISHED", "STALE", "NO_LONGER_ELIGIBLE"],
  BA_REVIEW: ["PLANNING"],
  FAILED: ["WAITING_REPO", "PLANNING"],
  PUBLISHED: ["REPLAN_REQUIRED"],
  STALE: ["WAITING_REPO", "PLANNING"],
  REPLAN_REQUIRED: ["WAITING_REPO", "PLANNING"],
  NO_LONGER_ELIGIBLE: ["WAITING_REPO", "PLANNING", "READY_FOR_REVIEW", "FAILED", "STALE"],
} as const satisfies Record<PlanningCaseStatus, readonly PlanningCaseStatus[]>;

const planningRunTransitions = {
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
} as const satisfies Record<PlanningRunStatus, readonly PlanningRunStatus[]>;

export function canTransitionPlanningCase(from: PlanningCaseStatus, to: PlanningCaseStatus): boolean {
  return (planningCaseTransitions[from] as readonly PlanningCaseStatus[]).includes(to);
}

export function assertPlanningCaseTransition(from: PlanningCaseStatus, to: PlanningCaseStatus): void {
  if (!canTransitionPlanningCase(from, to)) {
    throw new InvalidStateTransitionError("PlanningCase", from, to);
  }
}

export function canTransitionPlanningRun(from: PlanningRunStatus, to: PlanningRunStatus): boolean {
  return (planningRunTransitions[from] as readonly PlanningRunStatus[]).includes(to);
}

export function assertPlanningRunTransition(from: PlanningRunStatus, to: PlanningRunStatus): void {
  if (!canTransitionPlanningRun(from, to)) {
    throw new InvalidStateTransitionError("PlanningRun", from, to);
  }
}
