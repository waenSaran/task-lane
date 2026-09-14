import assert from "node:assert/strict";
import test from "node:test";
import { executePlaneFetchJob } from "../src/plane-fetch-execution.ts";

const now = new Date("2026-09-14T08:15:00.000Z");

test("scheduled Plane fetch success marks only its slot and completes the job", async () => {
  const calls: string[] = [];
  const result = await executePlaneFetchJob(
    {
      id: "job_1",
      payload: { manual: false, slotKey: "2026-09-14|14:00|Asia/Bangkok" },
    },
    {
      sync: async () => { calls.push("sync"); },
      complete: async (jobId, slotKey, completedAt) => {
        calls.push(`complete:${jobId}:${slotKey}:${completedAt.toISOString()}`);
      },
      fail: async () => { calls.push("fail"); },
      now: () => now,
    },
  );

  assert.equal(result, "COMPLETED");
  assert.deepEqual(calls, [
    "sync",
    "complete:job_1:2026-09-14|14:00|Asia/Bangkok:2026-09-14T08:15:00.000Z",
  ]);
});

test("manual Plane fetch success completes without any schedule slot", async () => {
  const completions: Array<{ jobId: string; slotKey: string | null }> = [];
  const result = await executePlaneFetchJob(
    { id: "manual_1", payload: { manual: true } },
    {
      sync: async () => undefined,
      complete: async (jobId, slotKey) => { completions.push({ jobId, slotKey }); },
      fail: async () => undefined,
      now: () => now,
    },
  );

  assert.equal(result, "COMPLETED");
  assert.deepEqual(completions, [{ jobId: "manual_1", slotKey: null }]);
});

test("scheduled Plane fetch failure fails both job and its slot without leaking thrown details", async () => {
  const failures: Array<{ jobId: string; slotKey: string | null; code: string; message: string }> = [];
  const result = await executePlaneFetchJob(
    {
      id: "job_failed",
      payload: { manual: false, slotKey: "2026-09-14|14:00|Asia/Bangkok" },
    },
    {
      sync: async () => { throw new Error("secret upstream detail"); },
      complete: async () => undefined,
      fail: async (jobId, slotKey, _failedAt, error) => {
        failures.push({ jobId, slotKey, code: error.code, message: error.message });
      },
      now: () => now,
    },
  );

  assert.equal(result, "FAILED");
  assert.deepEqual(failures, [{
    jobId: "job_failed",
    slotKey: "2026-09-14|14:00|Asia/Bangkok",
    code: "PLANE_FETCH_FAILED",
    message: "Plane fetch failed",
  }]);
});

test("malformed scheduled payload fails before sync", async () => {
  let synced = false;
  let failed = false;
  const result = await executePlaneFetchJob(
    { id: "job_bad", payload: { manual: false } },
    {
      sync: async () => { synced = true; },
      complete: async () => undefined,
      fail: async () => { failed = true; },
      now: () => now,
    },
  );

  assert.equal(result, "FAILED");
  assert.equal(synced, false);
  assert.equal(failed, true);
});
