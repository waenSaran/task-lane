import assert from "node:assert/strict";
import test from "node:test";
import { startPlaneAutomationRuntime } from "../src/plane-automation-runtime.ts";

test("runs the scheduler at startup and owns independent timers", async () => {
  const callbacks: Array<() => void> = [];
  const cleared: unknown[] = [];
  const calls: string[] = [];

  const runtime = await startPlaneAutomationRuntime({
    schedulerTick: async () => { calls.push("schedule"); },
    processJob: async () => { calls.push("job"); },
    setInterval: (callback) => {
      callbacks.push(callback);
      return callback;
    },
    clearInterval: (timer) => { cleared.push(timer); },
  });

  assert.deepEqual(calls, ["schedule"]);
  assert.equal(callbacks.length, 2);

  callbacks[0]!();
  callbacks[1]!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["schedule", "schedule", "job"]);

  await runtime.stop();
  assert.deepEqual(cleared, callbacks);
});

test("does not overlap a slow scheduler tick", async () => {
  const callbacks: Array<() => void> = [];
  let resolveSlowTick: (() => void) | undefined;
  let calls = 0;

  const runtime = await startPlaneAutomationRuntime({
    schedulerTick: async () => {
      calls += 1;
      if (calls === 1) return;
      await new Promise<void>((resolve) => { resolveSlowTick = resolve; });
    },
    processJob: async () => undefined,
    setInterval: (callback) => {
      callbacks.push(callback);
      return callback;
    },
    clearInterval: () => undefined,
  });

  callbacks[0]!();
  callbacks[0]!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);

  resolveSlowTick?.();
  await runtime.stop();
});
