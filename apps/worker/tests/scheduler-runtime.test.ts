import assert from "node:assert/strict";
import test from "node:test";
import { runPlaneFetchJobOnce, runSchedulerTick } from "../src/scheduler-runtime.ts";

const slot = {
  slotKey: "2026-09-14|14:00|Asia/Bangkok",
  scheduledAt: new Date("2026-09-14T07:00:00.000Z"),
};

test("scheduler tick enqueues exactly the latest due slot with a new job id", async () => {
  const calls: unknown[] = [];
  const created = await runSchedulerTick({
    now: new Date("2026-09-14T08:00:00.000Z"),
    timezone: "Asia/Bangkok",
    fetchTimes: ["09:00", "14:00"],
    createJobId: () => "scheduled_job_1",
    calculateLatestDue: () => slot,
    enqueue: async (input) => {
      calls.push(input);
      return true;
    },
  });

  assert.equal(created, true);
  assert.deepEqual(calls, [{ slot, jobId: "scheduled_job_1" }]);
});

test("scheduler tick reports false when the latest slot already exists", async () => {
  const created = await runSchedulerTick({
    now: new Date("2026-09-14T08:00:00.000Z"),
    timezone: "Asia/Bangkok",
    fetchTimes: ["09:00", "14:00"],
    createJobId: () => "scheduled_job_2",
    calculateLatestDue: () => slot,
    enqueue: async () => false,
  });
  assert.equal(created, false);
});

test("Plane fetch worker claims only PLANE_FETCH jobs and executes one claimed job", async () => {
  const claimInputs: unknown[] = [];
  const executed: unknown[] = [];
  const processed = await runPlaneFetchJobOnce({
    workerId: "plane-worker",
    now: new Date("2026-09-14T08:00:00.000Z"),
    leaseDurationMs: 60_000,
    claim: async (input) => {
      claimInputs.push(input);
      return { id: "plane_job", payload: { manual: true } };
    },
    execute: async (job) => {
      executed.push(job);
    },
  });

  assert.equal(processed, true);
  assert.deepEqual(claimInputs, [{
    workerId: "plane-worker",
    now: new Date("2026-09-14T08:00:00.000Z"),
    leaseDurationMs: 60_000,
    types: ["PLANE_FETCH"],
  }]);
  assert.deepEqual(executed, [{ id: "plane_job", payload: { manual: true } }]);
});

test("Plane fetch worker returns false when no PLANE_FETCH job is available", async () => {
  let executed = false;
  const processed = await runPlaneFetchJobOnce({
    workerId: "plane-worker",
    now: new Date("2026-09-14T08:00:00.000Z"),
    leaseDurationMs: 60_000,
    claim: async () => null,
    execute: async () => { executed = true; },
  });

  assert.equal(processed, false);
  assert.equal(executed, false);
});
