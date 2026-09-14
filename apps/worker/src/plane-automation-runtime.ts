type Timer = unknown;

export interface PlaneAutomationRuntimeInput {
  schedulerTick(): Promise<void>;
  processJob(): Promise<void>;
  setInterval?(callback: () => void, delayMs: number): Timer;
  clearInterval?(timer: Timer): void;
  onError?(loop: "scheduler" | "worker"): void;
}

export interface PlaneAutomationRuntime {
  stop(): Promise<void>;
}

function singleFlight(task: () => Promise<void>, onError: () => void): {
  run(): Promise<void>;
  wait(): Promise<void>;
} {
  let inFlight: Promise<void> | null = null;

  return {
    async run(): Promise<void> {
      if (inFlight) return inFlight;
      inFlight = task().catch(onError).finally(() => { inFlight = null; });
      return inFlight;
    },
    async wait(): Promise<void> {
      await inFlight;
    },
  };
}

export async function startPlaneAutomationRuntime(
  input: PlaneAutomationRuntimeInput,
): Promise<PlaneAutomationRuntime> {
  const setTimer = input.setInterval ?? ((callback, delayMs) => setInterval(callback, delayMs));
  const clearTimer = input.clearInterval ?? ((timer) => clearInterval(timer as NodeJS.Timeout));
  const onSchedulerError = () => input.onError?.("scheduler");
  const onWorkerError = () => input.onError?.("worker");
  const scheduler = singleFlight(input.schedulerTick, onSchedulerError);
  const worker = singleFlight(input.processJob, onWorkerError);

  await scheduler.run();
  const schedulerTimer = setTimer(() => { void scheduler.run(); }, 60_000);
  const workerTimer = setTimer(() => { void worker.run(); }, 1_000);
  let stopped = false;

  return {
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      clearTimer(schedulerTimer);
      clearTimer(workerTimer);
      await Promise.all([scheduler.wait(), worker.wait()]);
    },
  };
}
