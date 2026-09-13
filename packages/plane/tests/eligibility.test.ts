import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePlaneEligibility } from "../src/eligibility.ts";
import type { PlaneWorkItem } from "../src/types.ts";

function item(overrides: Partial<PlaneWorkItem> = {}): PlaneWorkItem {
  return {
    id: "plane-1",
    identifier: "DOAE-1841",
    name: "Example UC",
    typeName: "UC",
    stateName: "Todo",
    labels: ["DEV-review"],
    assignees: [],
    updatedAt: "2026-09-13T16:20:00.000Z",
    ...overrides,
  };
}

test("eligible UC with no assignee", () => {
  assert.deepEqual(evaluatePlaneEligibility(item(), "saranya.h"), {
    isUc: true,
    eligible: true,
    reason: "ELIGIBLE",
  });
});

test("eligible UC when target assignee is among multiple assignees", () => {
  assert.equal(
    evaluatePlaneEligibility(
      item({
        assignees: [
          { id: "u1", displayName: "someone.else", email: "someone@example.com" },
          { id: "u2", displayName: "saranya.h", email: "saranya.h@example.com" },
        ],
      }),
      "saranya.h",
    ).eligible,
    true,
  );
});

test("eligible UC when target matches email local part", () => {
  assert.equal(
    evaluatePlaneEligibility(
      item({ assignees: [{ id: "u2", displayName: "Saranya", email: "saranya.h@example.com" }] }),
      "saranya.h",
    ).eligible,
    true,
  );
});

test("other assignee is ineligible", () => {
  assert.equal(
    evaluatePlaneEligibility(
      item({ assignees: [{ id: "u1", displayName: "someone.else", email: "someone@example.com" }] }),
      "saranya.h",
    ).reason,
    "ASSIGNEE_MISMATCH",
  );
});

test("wrong state is ineligible", () => {
  assert.equal(evaluatePlaneEligibility(item({ stateName: "In Progress" }), "saranya.h").reason, "WRONG_STATE");
});

test("missing DEV-review label is ineligible", () => {
  assert.equal(evaluatePlaneEligibility(item({ labels: ["other"] }), "saranya.h").reason, "MISSING_DEV_REVIEW");
});

test("non-UC is classified separately and is never eligible", () => {
  assert.deepEqual(evaluatePlaneEligibility(item({ typeName: "US" }), "saranya.h"), {
    isUc: false,
    eligible: false,
    reason: "NOT_UC",
  });
});
