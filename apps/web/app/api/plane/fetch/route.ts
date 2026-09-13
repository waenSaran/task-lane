import { randomUUID } from "node:crypto";
import { enqueuePlaneFetchJob } from "@task-lane/plane";
import { createManualPlaneFetch } from "../../../../src/manual-plane-fetch";
import { getPool } from "../../../../src/postgres";

export const dynamic = "force-dynamic";

const queueManualPlaneFetch = createManualPlaneFetch({
  createId: randomUUID,
  now: () => new Date(),
  enqueue: async (input) => {
    await enqueuePlaneFetchJob(getPool(), input);
  },
});

export async function POST(): Promise<Response> {
  try {
    const result = await queueManualPlaneFetch();
    return Response.json(result, { status: 202 });
  } catch {
    return Response.json({ error: "Unable to queue Plane fetch" }, { status: 503 });
  }
}
