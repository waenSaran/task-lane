import { createServiceHealth } from "@task-lane/db";
import { statusCodeForHealth } from "../../../src/health-http";
import { getPool } from "../../../src/postgres";
export const dynamic = "force-dynamic";
export async function GET(): Promise<Response> {
  let health;
  try { health = await createServiceHealth("web", getPool()); }
  catch { health = { status: "error" as const, service: "web", database: "down" as const, timestamp: new Date().toISOString() }; }
  return Response.json(health, { status: statusCodeForHealth(health) });
}
