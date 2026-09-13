import { createServiceHealth } from "@task-lane/db";
import { createPool } from "./postgres.js";
import { assertWorkerReady } from "./startup.js";
const pool = createPool();
const health = await createServiceHealth("worker", pool);
assertWorkerReady(health);
console.log(JSON.stringify({ event: "worker.ready", ...health }));
const keepAlive = setInterval(() => undefined, 60 * 60 * 1000);
async function shutdown(signal: string) {
  clearInterval(keepAlive);
  console.log(JSON.stringify({ event: "worker.shutdown", signal }));
  await pool.end();
  process.exit(0);
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
