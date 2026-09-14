import assert from "node:assert/strict";
import test from "node:test";
import {
  claimJob,
  enqueueJob,
  enqueueScheduledPlaneFetch,
  findJob,
  findLatestSuccessfulScheduleSlot,
  findScheduleSlot,
  markScheduleSlotFailed,
  markScheduleSlotSuccess,
  migrate,
} from "@task-lane/db";
import { Pool } from "pg";

const now = new Date("2026-09-14T08:00:00.000Z");

function createPool(): Pool {
  const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required");
  return new Pool({ connectionString, max: 8 });
}

async function reset(pool: Pool): Promise<void> {
  await pool.query("drop schema public cascade; create schema public;");
  await migrate(pool);
}

test("scheduled slot and PLANE_FETCH job are inserted atomically once across repeated ticks", async () => {
  const pool = createPool();
  try {
    await reset(pool);
    const slot = {
      slotKey: "2026-09-14|14:00|Asia/Bangkok",
      scheduledAt: new Date("2026-09-14T07:00:00.000Z"),
    };

    const first = await enqueueScheduledPlaneFetch(pool, { slot, jobId: "scheduled_1" });
    const second = await enqueueScheduledPlaneFetch(pool, { slot, jobId: "scheduled_2" });

    assert.equal(first, true);
    assert.equal(second, false);
    assert.equal((await findJob(pool, "scheduled_1"))?.type, "PLANE_FETCH");
    assert.deepEqual((await findJob(pool, "scheduled_1"))?.payload, {
      manual: false,
      slotKey: slot.slotKey,
    });
    assert.equal(await findJob(pool, "scheduled_2"), null);
    assert.equal((await findScheduleSlot(pool, slot.slotKey))?.status, "PENDING");
  } finally {
    await pool.end();
  }
});

test("successful and failed scheduled slots persist terminal audit state", async () => {
  const pool = createPool();
  try {
    await reset(pool);
    await enqueueScheduledPlaneFetch(pool, {
      slot: {
        slotKey: "2026-09-14|09:00|Asia/Bangkok",
        scheduledAt: new Date("2026-09-14T02:00:00.000Z"),
      },
      jobId: "scheduled_9",
    });
    await markScheduleSlotSuccess(pool, "2026-09-14|09:00|Asia/Bangkok", now);

    await enqueueScheduledPlaneFetch(pool, {
      slot: {
        slotKey: "2026-09-14|14:00|Asia/Bangkok",
        scheduledAt: new Date("2026-09-14T07:00:00.000Z"),
      },
      jobId: "scheduled_14",
    });
    await markScheduleSlotFailed(pool, "2026-09-14|14:00|Asia/Bangkok", now, {
      code: "PLANE_FETCH_FAILED",
      message: "Plane fetch failed",
    });

    assert.equal((await findScheduleSlot(pool, "2026-09-14|09:00|Asia/Bangkok"))?.status, "SUCCESS");
    assert.equal((await findScheduleSlot(pool, "2026-09-14|14:00|Asia/Bangkok"))?.status, "FAILED");
    assert.equal((await findLatestSuccessfulScheduleSlot(pool))?.slotKey, "2026-09-14|09:00|Asia/Bangkok");
  } finally {
    await pool.end();
  }
});

test("job claim type filter cannot take future planning jobs", async () => {
  const pool = createPool();
  try {
    await reset(pool);
    await enqueueJob(pool, {
      id: "planning_job",
      type: "PLAN_CASE",
      payload: {},
      priority: 100,
      availableAt: now,
    });
    await enqueueJob(pool, {
      id: "plane_job",
      type: "PLANE_FETCH",
      payload: { manual: true },
      priority: 1,
      availableAt: now,
    });

    const claimed = await claimJob(pool, {
      workerId: "plane-worker",
      now,
      leaseDurationMs: 60_000,
      types: ["PLANE_FETCH"],
    });

    assert.equal(claimed?.id, "plane_job");
    assert.equal((await findJob(pool, "planning_job"))?.status, "QUEUED");
  } finally {
    await pool.end();
  }
});
