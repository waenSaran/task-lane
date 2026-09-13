import assert from "node:assert/strict";
import test from "node:test";
import type {
  PlanRevision,
  PlanningCase,
  PlanningRun,
  Repository,
  ReviewFeedback,
  Settings,
} from "@task-lane/domain";
import {
  findPlanRevision,
  findPlanningCase,
  findPlanningRun,
  findRepository,
  findReviewFeedback,
  findSettings,
  migrate,
  savePlanRevision,
  savePlanningCase,
  savePlanningRun,
  saveRepository,
  saveReviewFeedback,
  saveSettings,
  withTransaction,
} from "../../src/index.ts";
import { createTestPool, resetDatabase } from "./test-db.ts";

const now = "2026-09-13T16:10:00.000Z";

function fixtures() {
  const repository: Repository = {
    id: "repo_1",
    name: "doae-hrcs",
    sshUrl: "git@github.com:example/doae-hrcs.git",
    localPath: "/data/repos/doae-hrcs",
    validationStatus: "VALID",
    lastSyncedSha: "abc123",
    lastUsedAgent: "CODEX",
    lastUsedRelatedRepoIds: [],
    validationReport: { checkedAt: now, errors: [], warnings: [] },
    createdAt: now,
    updatedAt: now,
  };

  const planningCase: PlanningCase = {
    id: "case_1",
    planeIssueId: "plane-uuid-1",
    planeIdentifier: "DOAE-1841",
    title: "Example UC",
    currentStatus: "WAITING_REPO",
    previousStatus: null,
    eligibility: "ELIGIBLE",
    primaryRepoId: repository.id,
    preferredAgent: "CODEX",
    lastPublishedRunId: null,
    createdAt: now,
    updatedAt: now,
  };

  const planningRun: PlanningRun = {
    id: "run_1",
    planningCaseId: planningCase.id,
    runType: "INITIAL",
    agent: "CODEX",
    agentVersion: "1.0.0",
    sessionId: "session_1",
    repoRevisions: [{ repositoryId: repository.id, sha: "abc123" }],
    requirementFingerprint: "requirements-sha",
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
    sha256: "draft-sha",
    createdAt: now,
    approvedAt: null,
  };

  const feedback: ReviewFeedback = {
    id: "feedback_1",
    revisionId: revision.id,
    sections: ["TO_BE", "VERIFICATION"],
    comment: "Please clarify verification.",
    createdAt: now,
  };

  const settings: Settings = {
    defaultAgent: "CODEX",
    agentConcurrency: 1,
    logRetentionDays: 30,
    fetchTimes: ["09:00", "14:00"],
    timezone: "Asia/Bangkok",
    updatedAt: now,
  };

  return { repository, planningCase, planningRun, revision, feedback, settings };
}

test("migrations initialize a clean database and are idempotent", async () => {
  const pool = createTestPool();
  try {
    await resetDatabase(pool);
    await migrate(pool);
    await migrate(pool);

    const result = await pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    );
    const tables = result.rows.map((row) => row.table_name);
    for (const expected of [
      "jobs",
      "plan_revisions",
      "planning_cases",
      "planning_runs",
      "repositories",
      "review_feedback",
      "schedule_slots",
      "schema_migrations",
      "settings",
    ]) {
      assert.ok(tables.includes(expected), `missing table ${expected}`);
    }
  } finally {
    await pool.end();
  }
});

test("core domain records can be created, read, updated, and rolled back transactionally", async () => {
  const pool = createTestPool();
  try {
    await resetDatabase(pool);
    await migrate(pool);
    const { repository, planningCase, planningRun, revision, feedback, settings } = fixtures();

    await withTransaction(pool, async (tx) => {
      await saveRepository(tx, repository);
      await savePlanningCase(tx, planningCase);
      await savePlanningRun(tx, planningRun);
      await savePlanRevision(tx, revision);
      await saveReviewFeedback(tx, feedback);
      await saveSettings(tx, settings);
    });

    assert.deepEqual(await findRepository(pool, repository.id), repository);
    assert.deepEqual(await findPlanningCase(pool, planningCase.id), planningCase);
    assert.deepEqual(await findPlanningRun(pool, planningRun.id), planningRun);
    assert.deepEqual(await findPlanRevision(pool, revision.id), revision);
    assert.deepEqual(await findReviewFeedback(pool, feedback.id), feedback);
    assert.deepEqual(await findSettings(pool), settings);

    const updatedCase: PlanningCase = {
      ...planningCase,
      title: "Updated UC",
      currentStatus: "PLANNING",
      previousStatus: "WAITING_REPO",
      updatedAt: "2026-09-13T16:11:00.000Z",
    };
    await withTransaction(pool, (tx) => savePlanningCase(tx, updatedCase));
    assert.deepEqual(await findPlanningCase(pool, planningCase.id), updatedCase);

    await assert.rejects(
      withTransaction(pool, async (tx) => {
        await saveRepository(tx, { ...repository, id: "repo_rollback", name: "rollback" });
        throw new Error("rollback");
      }),
      /rollback/,
    );
    assert.equal(await findRepository(pool, "repo_rollback"), null);
  } finally {
    await pool.end();
  }
});

test("records persist across pool restart", async () => {
  let pool = createTestPool();
  await resetDatabase(pool);
  await migrate(pool);
  const { repository } = fixtures();
  await saveRepository(pool, repository);
  await pool.end();

  pool = createTestPool();
  try {
    assert.deepEqual(await findRepository(pool, repository.id), repository);
  } finally {
    await pool.end();
  }
});
