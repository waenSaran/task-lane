import assert from "node:assert/strict";
import test from "node:test";
import {
  claimJob,
  completeJob,
  enqueueJob,
  failExpiredJobs,
  failJob,
  findJob,
  migrate,
} from "../../src/index.ts";
import { createTestPool, resetDatabase } from "./test-db.ts";

const now = new Date("2026-09-13T16:20:00.000Z");

async function prepare() {
  const pool = createTestPool();
  await resetDatabase(pool);
  await migrate(pool);
  return pool;
}

test("two workers cannot claim the same queued job", async () => {
  const pool = await prepare();
  try {
    await enqueueJob(pool, {
      id: "job_concurrent",
      type: "PLAN_CASE",
      payload: { planningCaseId: "case_1" },
      priority: 10,
      availableAt: now,
    });

    const [a, b] = await Promise.all([
      claimJob(pool, { workerId: "worker-a", now, leaseDurationMs: 60_000 }),
      claimJob(pool, { workerId: "worker-b", now, leaseDurationMs: 60_000 }),
    ]);

    assert.equal([a, b].filter(Boolean).length, 1);
    const claimed = a ?? b;
    assert.equal(claimed?.id, "job_concurrent");
    assert.equal(claimed?.status, "LEASED");
    assert.equal(claimed?.attempts, 1);
    assert.ok(["worker-a", "worker-b"].includes(claimed?.leaseOwner ?? ""));
  } finally {
    await pool.end();
  }
});

test("expired leases become FAILED and are never silently requeued", async () => {
  const pool = await prepare();
  try {
    await enqueueJob(pool, {
      id: "job_expired",
      type: "PLAN_CASE",
      payload: {},
      priority: 0,
      availableAt: now,
    });
    const claimed = await claimJob(pool, {
      workerId: "worker-a",
      now,
      leaseDurationMs: 1_000,
    });
    assert.equal(claimed?.attempts, 1);

    const failedCount = await failExpiredJobs(pool, new Date(now.getTime() + 2_000));
    assert.equal(failedCount, 1);

    const failed = await findJob(pool, "job_expired");
    assert.equal(failed?.status, "FAILED");
    assert.equal(failed?.attempts, 1);
    assert.equal(failed?.leaseOwner, null);
    assert.equal(failed?.leaseExpiresAt, null);
    assert.equal(failed?.error?.code, "LEASE_EXPIRED");

    const secondClaim = await claimJob(pool, {
      workerId: "worker-b",
      now: new Date(now.getTime() + 3_000),
      leaseDurationMs: 1_000,
    });
    assert.equal(secondClaim, null);
  } finally {
    await pool.end();
  }
});

test("failed jobs keep attempt audit and have no automatic retry", async () => {
  const pool = await prepare();
  try {
    await enqueueJob(pool, {
      id: "job_failed",
      type: "PLAN_CASE",
      payload: {},
      priority: 0,
      availableAt: now,
    });
    await claimJob(pool, { workerId: "worker-a", now, leaseDurationMs: 60_000 });
    await failJob(pool, "job_failed", { code: "AGENT_FAILED", message: "agent exited" });

    const failed = await findJob(pool, "job_failed");
    assert.equal(failed?.status, "FAILED");
    assert.equal(failed?.attempts, 1);

    const retry = await claimJob(pool, {
      workerId: "worker-b",
      now: new Date(now.getTime() + 120_000),
      leaseDurationMs: 60_000,
    });
    assert.equal(retry, null);
  } finally {
    await pool.end();
  }
});

test("completed jobs remain terminal and auditable", async () => {
  const pool = await prepare();
  try {
    await enqueueJob(pool, {
      id: "job_done",
      type: "PLANE_FETCH",
      payload: { manual: true },
      priority: 1,
      availableAt: now,
    });
    await claimJob(pool, { workerId: "worker-a", now, leaseDurationMs: 60_000 });
    await completeJob(pool, "job_done");

    const job = await findJob(pool, "job_done");
    assert.equal(job?.status, "COMPLETED");
    assert.equal(job?.attempts, 1);
    assert.equal(job?.leaseOwner, null);
  } finally {
    await pool.end();
  }
});
