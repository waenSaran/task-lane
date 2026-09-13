import type { PlaneReadClientConfig } from "./client.js";

export interface PlaneRuntimeConfig extends PlaneReadClientConfig {
  eligibleAssignee: string;
}

type Env = Record<string, string | undefined>;

function requireEnv(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function readPlaneConfig(env: Env = process.env): PlaneRuntimeConfig {
  const apiKey = env.PLANE_API_KEY?.trim() || env.PLANE_API_TOKEN?.trim();
  if (!apiKey) throw new Error("PLANE_API_KEY or PLANE_API_TOKEN is required");

  return {
    baseUrl: requireEnv(env, "PLANE_BASE_URL"),
    apiKey,
    workspaceSlug: requireEnv(env, "PLANE_WORKSPACE_SLUG"),
    projectId: requireEnv(env, "PLANE_PROJECT_ID"),
    eligibleAssignee: env.PLANE_ELIGIBLE_ASSIGNEE?.trim() || "saranya.h",
  };
}
