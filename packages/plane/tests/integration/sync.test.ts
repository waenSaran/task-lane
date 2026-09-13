import assert from "node:assert/strict";
import test from "node:test";
import { findJob, findPlanningCaseByPlaneIssueId, migrate, savePlanningCase } from "@task-lane/db";
import type { PlanningCase } from "@task-lane/domain";
import {
  enqueuePlaneFetchJob,
  syncPlaneEligibility,
  type PlaneReader,
  type PlaneWorkItem,
} from "@task-lane/plane";
import { Pool } from "pg";

const now = new Date("2026-09-13T16:30:00.000Z");

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for Plane integration tests");
  return new Pool({ connectionString, max: 8 });
}

async function reset(pool: Pool): Promise<void> {
  await pool.query("drop schema public cascade; create schema public;");
  await migrate(pool);
}

function workItem(overrides: Partial<PlaneWorkItem> = {}): PlaneWorkItem {
  return {
    id: "plane-1",
    identifier: "DOAE-1841",
    name: "Example UC",
    typeName: "UC",
    stateName: "Todo",
    labels: ["DEV-review"],
    assignees: [],
    updatedAt: now.toISOString(),
    ...overrides,
  };
}

function reader(items: PlaneWorkItem[]): PlaneReader {
  return { listProjectWorkItems: async () => items };
}

test("eligible UC creates one WAITING_REPO case and repeated fetch deduplicates by Plane UUID", async () => {
  const pool = createPool();
  try {
    await reset(pool);
    let idCounter = 0;
    const createId = () => `case_${++idCounter}`;

    const first = await syncPlaneEligibility({
      reader: reader([workItem()]),
      pool,
      now,
      createId,
      targetAssignee: "saranya.h",
    });
    const second = await syncPlaneEligibility({
      reader: reader([workItem()]),
      pool,
      now: new Date(now.getTime() + 1_000),
      createId,
      targetAssignee: "saranya.h",
    });

    const planningCase = await findPlanningCaseByPlaneIssueId(pool, "plane-1");
    const count = await pool.query<{ count: string }>("select count(*)::text as count from planning_cases");

    assert.equal(first.created, 1);
    assert.equal(second.created, 0);
    assert.equal(idCounter, 1);
    assert.equal(count.rows[0]?.count, "1");
    assert.equal(planningCase?.currentStatus, "WAITING_REPO");
    assert.equal(planningCase?.eligibility, "ELIGIBLE");
    assert.equal(planningCase?.planeIdentifier, "DOAE-1841");
  } finally {
    await pool.end();
  }
});

test("known case becomes NO_LONGER_ELIGIBLE then restores previous state when eligible again", async () => {
  const pool = createPool();
  try {
    await reset(pool);
    const createId = () => "case_1";
    await syncPlaneEligibility({ reader: reader([workItem()]), pool, now, createId, targetAssignee: "saranya.h" });

    await syncPlaneEligibility({
      reader: reader([workItem({ stateName: "In Progress" })]),
      pool,
      now: new Date(now.getTime() + 1_000),
      createId,
      targetAssignee: "saranya.h",
    });
    const ineligible = await findPlanningCaseByPlaneIssueId(pool, "plane-1");
    assert.equal(ineligible?.currentStatus, "NO_LONGER_ELIGIBLE");
    assert.equal(ineligible?.previousStatus, "WAITING_REPO");
    assert.equal(ineligible?.eligibility, "INELIGIBLE");

    await syncPlaneEligibility({
      reader: reader([workItem()]),
      pool,
      now: new Date(now.getTime() + 2_000),
      createId,
      targetAssignee: "saranya.h",
    });
    const restored = await findPlanningCaseByPlaneIssueId(pool, "plane-1");
    assert.equal(restored?.currentStatus, "WAITING_REPO");
    assert.equal(restored?.previousStatus, "NO_LONGER_ELIGIBLE");
    assert.equal(restored?.eligibility, "ELIGIBLE");
  } finally {
    await pool.end();
  }
});

test("non-UC never creates a planning case", async () => {
  const pool = createPool();
  try {
    await reset(pool);
    const summary = await syncPlaneEligibility({
      reader: reader([workItem({ typeName: "US" })]),
      pool,
      now,
      createId: () => "case_1",
      targetAssignee: "saranya.h",
    });
    assert.equal(summary.created, 0);
    assert.equal(await findPlanningCaseByPlaneIssueId(pool, "plane-1"), null);
  } finally {
    await pool.end();
  }
});

test("BA_REVIEW case keeps workflow state when Plane no longer matches DEV-review eligibility", async () => {
  const pool = createPool();
  try {
    await reset(pool);
    const existing: PlanningCase = {
      id: "case_ba",
      planeIssueId: "plane-ba",
      planeIdentifier: "DOAE-2000",
      title: "BA blocked UC",
      currentStatus: "BA_REVIEW",
      previousStatus: "PLANNING",
      eligibility: "ELIGIBLE",
      primaryRepoId: null,
      preferredAgent: "CODEX",
      lastPublishedRunId: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await savePlanningCase(pool, existing);

    await syncPlaneEligibility({
      reader: reader([
        workItem({
          id: "plane-ba",
          identifier: "DOAE-2000",
          name: "BA blocked UC",
          labels: ["BA-review"],
        }),
      ]),
      pool,
      now: new Date(now.getTime() + 1_000),
      createId: () => "unused",
      targetAssignee: "saranya.h",
    });

    const after = await findPlanningCaseByPlaneIssueId(pool, "plane-ba");
    assert.equal(after?.currentStatus, "BA_REVIEW");
    assert.equal(after?.eligibility, "INELIGIBLE");
  } finally {
    await pool.end();
  }
});

test("manual fetch helper enqueues an auditable PLANE_FETCH job", async () => {
  const pool = createPool();
  try {
    await reset(pool);
    await enqueuePlaneFetchJob(pool, { id: "fetch_1", now, manual: true });
    const job = await findJob(pool, "fetch_1");
    assert.equal(job?.type, "PLANE_FETCH");
    assert.deepEqual(job?.payload, { manual: true });
    assert.equal(job?.status, "QUEUED");
  } finally {
    await pool.end();
  }
});
