import { createServiceHealth } from "@task-lane/db";
import { createPool } from "./postgres.js";
const pool = createPool();
const health = await createServiceHealth("worker", pool);
await pool.end();
if (health.status !== "ok") process.exitCode = 1;
