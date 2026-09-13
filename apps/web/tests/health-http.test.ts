import assert from "node:assert/strict";
import test from "node:test";
import { statusCodeForHealth } from "../src/health-http.ts";
test("returns 200 for a healthy service", () => assert.equal(statusCodeForHealth({ status: "ok" }), 200));
test("returns 503 for an unhealthy service", () => assert.equal(statusCodeForHealth({ status: "error" }), 503));
