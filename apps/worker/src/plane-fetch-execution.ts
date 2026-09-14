export interface PlaneFetchJobInput {
  id: string;
  payload: unknown;
}

export interface PlaneFetchFailure {
  code: string;
  message: string;
}

export interface PlaneFetchExecutionDeps {
  sync(): Promise<void>;
  complete(jobId: string, slotKey: string | null, completedAt: Date): Promise<void>;
  fail(
    jobId: string,
    slotKey: string | null,
    failedAt: Date,
    error: PlaneFetchFailure,
  ): Promise<void>;
  now(): Date;
}

export type PlaneFetchExecutionResult = "COMPLETED" | "FAILED";

const GENERIC_FAILURE: PlaneFetchFailure = {
  code: "PLANE_FETCH_FAILED",
  message: "Plane fetch failed",
};

function scheduleSlotKey(payload: unknown): { valid: boolean; slotKey: string | null } {
  if (typeof payload !== "object" || payload === null) {
    return { valid: false, slotKey: null };
  }

  const record = payload as Record<string, unknown>;
  if (record.manual === true) {
    return { valid: true, slotKey: null };
  }
  if (record.manual === false) {
    const slotKey = typeof record.slotKey === "string" ? record.slotKey.trim() : "";
    return slotKey.length > 0
      ? { valid: true, slotKey }
      : { valid: false, slotKey: null };
  }
  return { valid: false, slotKey: null };
}

export async function executePlaneFetchJob(
  job: PlaneFetchJobInput,
  deps: PlaneFetchExecutionDeps,
): Promise<PlaneFetchExecutionResult> {
  const parsed = scheduleSlotKey(job.payload);
  if (!parsed.valid) {
    await deps.fail(job.id, parsed.slotKey, deps.now(), GENERIC_FAILURE);
    return "FAILED";
  }

  try {
    await deps.sync();
    await deps.complete(job.id, parsed.slotKey, deps.now());
    return "COMPLETED";
  } catch {
    await deps.fail(job.id, parsed.slotKey, deps.now(), GENERIC_FAILURE);
    return "FAILED";
  }
}
