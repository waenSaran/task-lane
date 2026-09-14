import assert from "node:assert/strict";
import test from "node:test";
import type {
  Job,
  PlanRevision,
  PlanningCase,
  PlanningRun,
  Repository,
  ReviewFeedback,
  Settings,
} from "../src/index.ts";

const now = "2026-09-13T16:00:00+07:00";

const planningCase: PlanningCase = {
  id: "case_1",
  planeIssueId: "plane-uuid",
  planeIdentifier: "DOAE-1841",
  title: "Example UC",
  currentStatus: "WAITING_REPO",
  previousStatus: null,
  eligibility: "ELIGIBLE",
  primaryRepoId: null,
  preferredAgent: null,
  lastPublishedRunId: null,
  createdAt: now,
  updatedAt: now,
};

const planningRun: PlanningRun = {
  id: "run_1",
  planningCaseId: planningCase.id,
  runType: "INITIAL",
  agent: "CODEX",
  agentVersion: null,
  sessionId: null,
  repoRevisions: [],
  requirementFingerprint: null,
  status: "QUEUED",
  startedAt: null,
  finishedAt: null,
  failure: null,
  createdAt: now,
  updatedAt: now,
};

const revision: PlanRevision = {
  id: "revision_1",
  planningRunId: planningRun.id,
  version: 1,
  draftPath: "/data/plans/case_1/run_1/v001.md",
  sha256: "abc123",
  createdAt: now,
  approvedAt: null,
};

const feedback: ReviewFeedback = {
  id: "feedback_1",
  revisionId: revision.id,
  sections: ["TO_BE"],
  comment: "Clarify the target flow",
  createdAt: now,
};

const repository: Repository = {
  id: "repo_1",
  name: "doae-hrcs",
  sshUrl: "git@github.com:example/doae-hrcs.git",
  localPath: "/data/repos/doae-hrcs",
  validationStatus: "VALID",
  lastSyncedSha: null,
  lastUsedAgent: null,
  presetRelatedRepoIds: [],
  lastUsedRelatedRepoIds: [],
  validationReport: null,
  createdAt: now,
  updatedAt: now,
};

const job: Job<"PLANE_FETCH", { manual: boolean }> = {
  id: "job_1",
  type: "PLANE_FETCH",
  payload: { manual: true },
  status: "QUEUED",
  priority: 0,
  availableAt: now,
  leaseOwner: null,
  leaseExpiresAt: null,
  attempts: 0,
  error: null,
  createdAt: now,
  updatedAt: now,
};

const settings: Settings = {
  defaultAgent: "CODEX",
  agentConcurrency: 1,
  logRetentionDays: 30,
  fetchTimes: ["09:00", "14:00"],
  timezone: "Asia/Bangkok",
  updatedAt: now,
};

test("shared domain model contract can represent the agreed workflow without Plane workflow state", () => {
  assert.equal(planningCase.currentStatus, "WAITING_REPO");
  assert.equal(planningRun.status, "QUEUED");
  assert.equal(revision.version, 1);
  assert.deepEqual(feedback.sections, ["TO_BE"]);
  assert.equal(repository.validationStatus, "VALID");
  assert.equal(job.payload.manual, true);
  assert.equal(settings.agentConcurrency, 1);
  assert.equal("planeState" in planningCase, false);
  assert.equal("planeLabel" in planningCase, false);
});
