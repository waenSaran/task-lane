import { createServiceHealth } from "@task-lane/db";
import { statusCodeForHealth } from "../../../health-http.js";
import { getPool } from "../../../postgres.js";

export async function GET(): Promise<Response> {
  let health;
  try {
    health = await createServiceHealth("web", getPool());
  } catch {
    health = {
      status: "error" as const,
      service: "web",
      database: "down" as const,
      timestamp: new Date().toISOString(),
    };
  }

  return Response.json(health, { status: statusCodeForHealth(health) });
}
