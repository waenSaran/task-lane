import assert from "node:assert/strict";
import test from "node:test";
import { createServiceHealth } from "../src/health.ts";

test("reports ok when the database query succeeds", async () => {
  const queryable = { async query(sql: string) { assert.equal(sql, "select 1"); return { rows: [{ one: 1 }] }; } };
  const result = await createServiceHealth("web", queryable, () => new Date("2026-09-13T12:00:00.000Z"));
  assert.deepEqual(result, { status: "ok", service: "web", database: "up", timestamp: "2026-09-13T12:00:00.000Z" });
});

test("reports error without leaking database failure details", async () => {
  const queryable = { async query() { throw new Error("postgres://secret-user:secret-pass@db.internal/task_lane"); } };
  const result = await createServiceHealth("worker", queryable, () => new Date("2026-09-13T12:00:00.000Z"));
  assert.deepEqual(result, { status: "error", service: "worker", database: "down", timestamp: "2026-09-13T12:00:00.000Z" });
  assert.equal(JSON.stringify(result).includes("secret-pass"), false);
});
