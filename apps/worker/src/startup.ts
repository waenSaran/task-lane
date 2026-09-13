export function assertWorkerReady(health: { status: "ok" | "error"; database: "up" | "down" }): void {
  if (health.status !== "ok" || health.database !== "up") throw new Error("Task Lane worker cannot start: database unavailable");
}
