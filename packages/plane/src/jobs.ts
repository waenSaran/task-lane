import { enqueueJob } from "@task-lane/db";
import type { Job } from "@task-lane/domain";
import type { Pool, PoolClient } from "pg";

type DbQueryable = Pool | PoolClient;

export interface EnqueuePlaneFetchJobInput {
  id: string;
  now: Date;
  manual: boolean;
}

export function enqueuePlaneFetchJob(
  db: DbQueryable,
  input: EnqueuePlaneFetchJobInput,
): Promise<Job<"PLANE_FETCH", { manual: boolean }>> {
  return enqueueJob(db, {
    id: input.id,
    type: "PLANE_FETCH",
    payload: { manual: input.manual },
    priority: input.manual ? 10 : 0,
    availableAt: input.now,
  }) as Promise<Job<"PLANE_FETCH", { manual: boolean }>>;
}
