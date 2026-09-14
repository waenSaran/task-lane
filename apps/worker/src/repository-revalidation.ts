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

export async function runRepositoryRevalidationOnce(dependencies: RepositoryRevalidationDependencies): Promise<boolean> {
  const job = await claimJob(dependencies.pool, {
    workerId: dependencies.workerId,
    now: dependencies.now(),
    leaseDurationMs: 60_000,
    types: ["REPOSITORY_REVALIDATE"],
  });
  if (!job) return false;

  const payload = job.payload as RepositoryRevalidationPayload;
  if (typeof payload.repositoryId !== "string") {
    await failJob(dependencies.pool, job.id, { code: "INVALID_REPOSITORY_JOB", message: "Repository revalidation job payload is invalid" });
    return true;
  }

  try {
    const registry = new RepositoryRegistry({
      store: createRepositoryStore(dependencies.pool),
      checkoutRoot: dependencies.checkoutRoot,
      now: dependencies.now,
    });
    await registry.revalidate(payload.repositoryId);
    await completeJob(dependencies.pool, job.id);
  } catch (error) {
    await failJob(dependencies.pool, job.id, {
      code: "REPOSITORY_REVALIDATION_FAILED",
      message: sanitizedGitMessage(error),
    });
  }
  return true;
}
