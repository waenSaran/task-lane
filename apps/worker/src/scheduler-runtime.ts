export interface SchedulerSlot {
  slotKey: string;
  scheduledAt: Date;
}

export interface SchedulerTickInput {
  now: Date;
  timezone: string;
  fetchTimes: readonly string[];
  createJobId(): string;
  calculateLatestDue(input: {
    now: Date;
    timezone: string;
    fetchTimes: readonly string[];
  }): SchedulerSlot;
  enqueue(input: { slot: SchedulerSlot; jobId: string }): Promise<boolean>;
}

export async function runSchedulerTick(input: SchedulerTickInput): Promise<boolean> {
  const slot = input.calculateLatestDue({
    now: input.now,
    timezone: input.timezone,
    fetchTimes: input.fetchTimes,
  });
  return input.enqueue({ slot, jobId: input.createJobId() });
}

export interface PlaneFetchClaimInput {
  workerId: string;
  now: Date;
  leaseDurationMs: number;
  types: readonly string[];
}

export interface PlaneFetchClaimedJob {
  id: string;
  payload: unknown;
}

export interface PlaneFetchWorkerOnceInput {
  workerId: string;
  now: Date;
  leaseDurationMs: number;
  claim(input: PlaneFetchClaimInput): Promise<PlaneFetchClaimedJob | null>;
  execute(job: PlaneFetchClaimedJob): Promise<void>;
}

export async function runPlaneFetchJobOnce(input: PlaneFetchWorkerOnceInput): Promise<boolean> {
  const job = await input.claim({
    workerId: input.workerId,
    now: input.now,
    leaseDurationMs: input.leaseDurationMs,
    types: ["PLANE_FETCH"],
  });
  if (!job) return false;
  await input.execute(job);
  return true;
}
