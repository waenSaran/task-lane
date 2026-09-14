import { randomUUID } from "node:crypto";
import {
  claimJob,
  completePlaneFetchJob,
  createServiceHealth,
  enqueueScheduledPlaneFetch,
  failPlaneFetchJob,
  migrate,
} from "@task-lane/db";
import { createPlaneReadClient, readPlaneConfig, syncPlaneEligibility } from "@task-lane/plane";
import { startPlaneAutomationRuntime, type PlaneAutomationRuntime } from "./plane-automation-runtime.js";
import { executePlaneFetchJob } from "./plane-fetch-execution.js";
import { isPlaneAutomationConfigured } from "./plane-runtime-config.js";
import { createPool } from "./postgres.js";
import { runPlaneFetchJobOnce, runSchedulerTick } from "./scheduler-runtime.js";
import { latestDueScheduleSlot } from "./scheduler-slots.js";
import { assertWorkerReady } from "./startup.js";
import { runRepositoryRevalidationOnce } from "./repository-revalidation.js";

const pool = createPool();
await migrate(pool);
const health = await createServiceHealth("worker", pool);
assertWorkerReady(health);

let automation: PlaneAutomationRuntime | undefined;
const repositoryJobTimer = setInterval(() => {
  void runRepositoryRevalidationOnce({
    pool,
    workerId: `repository-worker-${process.pid}`,
    now: () => new Date(),
    checkoutRoot: process.env.TASK_LANE_REPOS_DIR ?? "/data/repos",
  }).catch(() => console.error(JSON.stringify({ event: "worker.repository_revalidation_failed" })));
}, 1_000);
if (isPlaneAutomationConfigured()) {
  const config = readPlaneConfig();
  const reader = createPlaneReadClient(config);
  const sync = async () => {
    await syncPlaneEligibility({
      reader,
      pool,
      now: new Date(),
      createId: randomUUID,
      targetAssignee: config.eligibleAssignee,
    });
  };

  automation = await startPlaneAutomationRuntime({
    schedulerTick: async () => {
      await runSchedulerTick({
        now: new Date(),
        timezone: "Asia/Bangkok",
        fetchTimes: ["09:00", "14:00"],
        createJobId: randomUUID,
        calculateLatestDue: latestDueScheduleSlot,
        enqueue: (input) => enqueueScheduledPlaneFetch(pool, input),
      });
    },
    processJob: async () => {
      await runPlaneFetchJobOnce({
        workerId: `plane-worker-${process.pid}`,
        now: new Date(),
        leaseDurationMs: 60_000,
        claim: (input) => claimJob(pool, input),
        execute: async (job) => {
          await executePlaneFetchJob(job, {
            sync,
            complete: (jobId, slotKey, completedAt) =>
              completePlaneFetchJob(pool, { jobId, slotKey, completedAt }),
            fail: (jobId, slotKey, completedAt, error) =>
              failPlaneFetchJob(pool, { jobId, slotKey, completedAt, error }),
            now: () => new Date(),
          });
        },
      });
    },
    onError: (loop) => console.error(JSON.stringify({ event: `worker.plane_${loop}_failed` })),
  });
  console.log(JSON.stringify({ event: "worker.plane_automation_enabled" }));
} else {
  console.log(JSON.stringify({ event: "worker.plane_automation_disabled" }));
}

console.log(JSON.stringify({ event: "worker.ready", ...health }));
const keepAlive = setInterval(() => undefined, 60 * 60 * 1000);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(keepAlive);
  clearInterval(repositoryJobTimer);
  console.log(JSON.stringify({ event: "worker.shutdown", signal }));
  await automation?.stop();
  await pool.end();
  process.exit(0);
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
