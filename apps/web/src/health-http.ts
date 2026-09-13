export function statusCodeForHealth(health: { status: "ok" | "error" }): 200 | 503 {
  return health.status === "ok" ? 200 : 503;
}
