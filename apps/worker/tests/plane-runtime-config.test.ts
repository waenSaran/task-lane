import assert from "node:assert/strict";
import test from "node:test";
import { isPlaneAutomationConfigured } from "../src/plane-runtime-config.ts";

test("Plane automation enables when all required config and API key are present", () => {
  assert.equal(isPlaneAutomationConfigured({
    PLANE_BASE_URL: "https://plane.example.com",
    PLANE_API_KEY: "secret",
    PLANE_WORKSPACE_SLUG: "doae",
    PLANE_PROJECT_ID: "project-1",
  }), true);
});

test("Plane automation accepts API token alias", () => {
  assert.equal(isPlaneAutomationConfigured({
    PLANE_BASE_URL: "https://plane.example.com",
    PLANE_API_TOKEN: "secret",
    PLANE_WORKSPACE_SLUG: "doae",
    PLANE_PROJECT_ID: "project-1",
  }), true);
});

test("missing or empty Plane config disables automation without throwing", () => {
  assert.equal(isPlaneAutomationConfigured({}), false);
  assert.equal(isPlaneAutomationConfigured({
    PLANE_BASE_URL: "https://plane.example.com",
    PLANE_API_KEY: "",
    PLANE_WORKSPACE_SLUG: "doae",
    PLANE_PROJECT_ID: "project-1",
  }), false);
  assert.equal(isPlaneAutomationConfigured({
    PLANE_BASE_URL: "https://plane.example.com",
    PLANE_API_KEY: "secret",
  }), false);
});
