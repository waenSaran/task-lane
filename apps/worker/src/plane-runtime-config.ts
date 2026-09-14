type Env = Record<string, string | undefined>;

function hasValue(env: Env, name: string): boolean {
  return Boolean(env[name]?.trim());
}

export function isPlaneAutomationConfigured(env: Env = process.env): boolean {
  return (
    hasValue(env, "PLANE_BASE_URL") &&
    hasValue(env, "PLANE_WORKSPACE_SLUG") &&
    hasValue(env, "PLANE_PROJECT_ID") &&
    (hasValue(env, "PLANE_API_KEY") || hasValue(env, "PLANE_API_TOKEN"))
  );
}
