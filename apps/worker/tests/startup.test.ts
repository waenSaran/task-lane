import assert from "node:assert/strict";
import test from "node:test";
import { assertWorkerReady } from "../src/startup.ts";
test("allows worker startup when database is up", () => assert.doesNotThrow(() => assertWorkerReady({ status: "ok", database: "up" })));
test("blocks worker startup with a generic error when database is down", () => assert.throws(() => assertWorkerReady({ status: "error", database: "down" }), { message: "Task Lane worker cannot start: database unavailable" }));
