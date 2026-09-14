import {
  claimJob,
  completeJob,
  failJob,
} from "@task-lane/db";
import { RepositoryRegistry, createRepositoryStore, sanitizedGitMessage } from "@task-lane/repos";
import type { Pool } from "pg";

interface RepositoryRevalidationPayload {
  repositoryId?: unknown;
}

export interface RepositoryRevalidationDependencies {
  pool: Pool;
  workerId: string;
  now: () => Date;
  checkoutRoot: string;
}

export interface RepositoryRevalidationJob {
  id: string;
  payload: unknown;
}

export interface RepositoryRevalidationExecutorDependencies {
  revalidate: (repositoryId: string) => Promise<unknown>;
  complete: (jobId: string) => Promise<void>;
  fail: (jobId: string, message: string) => Promise<void>;
}

export async function executeRepositoryRevalidationJob(
  job: RepositoryRevalidationJob,
  dependencies: RepositoryRevalidationExecutorDependencies,
): Promise<"COMPLETED" | "FAILED"> {
  const payload = job.payload as RepositoryRevalidationPayload;
  if (typeof payload.repositoryId !== "string") {
    await dependencies.fail(job.id, "Repository revalidation job payload is invalid");
    return "FAILED";
  }
  try {
    await dependencies.revalidate(payload.repositoryId);
    await dependencies.complete(job.id);
    return "COMPLETED";
  } catch (error) {
    await dependencies.fail(job.id, sanitizedGitMessage(error));
    return "FAILED";
  }
}

export async function runRepositoryRevalidationOnce(dependencies: RepositoryRevalidationDependencies): Promise<boolean> {
  const job = await claimJob(dependencies.pool, {
    workerId: dependencies.workerId,
    now: dependencies.now(),
    leaseDurationMs: 60_000,
    types: ["REPOSITORY_REVALIDATE"],
  });
  if (!job) return false;

  const registry = new RepositoryRegistry({
    store: createRepositoryStore(dependencies.pool),
    checkoutRoot: dependencies.checkoutRoot,
    now: dependencies.now,
  });
  await executeRepositoryRevalidationJob(job, {
    revalidate: (repositoryId) => registry.revalidate(repositoryId),
    complete: async (jobId) => { await completeJob(dependencies.pool, jobId); },
    fail: async (jobId, message) => { await failJob(dependencies.pool, jobId, { code: "REPOSITORY_REVALIDATION_FAILED", message }); },
  });
  return true;
}
