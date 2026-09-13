export interface ManualPlaneFetchInput {
  id: string;
  now: Date;
  manual: boolean;
}

export interface ManualPlaneFetchDeps {
  createId: () => string;
  now: () => Date;
  enqueue: (input: ManualPlaneFetchInput) => Promise<void>;
}

export interface ManualPlaneFetchResult {
  jobId: string;
  status: "QUEUED";
}

export function createManualPlaneFetch(deps: ManualPlaneFetchDeps) {
  return async function queueManualPlaneFetch(): Promise<ManualPlaneFetchResult> {
    const jobId = deps.createId();
    await deps.enqueue({ id: jobId, now: deps.now(), manual: true });
    return { jobId, status: "QUEUED" };
  };
}
