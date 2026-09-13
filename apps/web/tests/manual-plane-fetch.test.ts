import assert from "node:assert/strict";
import test from "node:test";
import { createManualPlaneFetch } from "../src/manual-plane-fetch.ts";

test("manual fetch queues one manual PLANE_FETCH job and returns 202 payload data", async () => {
  const calls: Array<{ id: string; now: Date; manual: boolean }> = [];
  const queue = createManualPlaneFetch({
    createId: () => "fetch_1",
    now: () => new Date("2026-09-14T00:00:00.000Z"),
    enqueue: async (input) => {
      calls.push(input);
    },
  });

  const result = await queue();

  assert.deepEqual(calls, [
    {
      id: "fetch_1",
      now: new Date("2026-09-14T00:00:00.000Z"),
      manual: true,
    },
  ]);
  assert.deepEqual(result, { jobId: "fetch_1", status: "QUEUED" });
});
