import assert from "node:assert/strict";
import test from "node:test";
import { readPlaneConfig } from "../src/config.ts";

test("reads Plane config without persisting or echoing secrets", () => {
  const config = readPlaneConfig({
    PLANE_BASE_URL: "https://plane.example.com",
    PLANE_API_KEY: "secret-key",
    PLANE_WORKSPACE_SLUG: "doae",
    PLANE_PROJECT_ID: "project-1",
  });

  assert.deepEqual(config, {
    baseUrl: "https://plane.example.com",
    apiKey: "secret-key",
    workspaceSlug: "doae",
    projectId: "project-1",
    eligibleAssignee: "saranya.h",
  });
});

test("accepts PLANE_API_TOKEN alias and custom eligible assignee", () => {
  const config = readPlaneConfig({
    PLANE_BASE_URL: "https://plane.example.com",
    PLANE_API_TOKEN: "token-secret",
    PLANE_WORKSPACE_SLUG: "doae",
    PLANE_PROJECT_ID: "project-1",
    PLANE_ELIGIBLE_ASSIGNEE: "developer.one",
  });

  assert.equal(config.apiKey, "token-secret");
  assert.equal(config.eligibleAssignee, "developer.one");
});

test("missing required Plane config fails without including secret values", () => {
  assert.throws(
    () =>
      readPlaneConfig({
        PLANE_API_KEY: "super-secret-key",
        PLANE_WORKSPACE_SLUG: "doae",
        PLANE_PROJECT_ID: "project-1",
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes("PLANE_BASE_URL") &&
      !error.message.includes("super-secret-key"),
  );
});
