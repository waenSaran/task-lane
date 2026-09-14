import { randomUUID } from "node:crypto";
import { enqueueJob } from "@task-lane/db";
import { createRepositoryStore, RepositoryRegistry } from "@task-lane/repos";
import type { Pool } from "pg";

export const repositoryCheckoutRoot = process.env.TASK_LANE_REPOS_DIR ?? "/data/repos";

type RepositoryRegistryApi = Pick<RepositoryRegistry, "list" | "registerPending" | "updatePending" | "remove" | "get">;

export interface RepositoryWorkflowDependencies {
  registry: RepositoryRegistryApi;
  queueRevalidation: (repositoryId: string) => Promise<string>;
}

export function createWebRepositoryRegistry(pool: Pool): RepositoryRegistry {
  return new RepositoryRegistry({
    store: createRepositoryStore(pool),
    checkoutRoot: repositoryCheckoutRoot,
  });
}

export function parseRepositoryInput(body: unknown, requireSshUrl: boolean): {
  sshUrl?: string;
  presetRelatedRepoIds?: string[];
  lastUsedRelatedRepoIds?: string[];
} {
  if (!body || typeof body !== "object") throw new Error("Request body must be an object");
  const input = body as Record<string, unknown>;
  if (input.sshUrl !== undefined && typeof input.sshUrl !== "string") throw new Error("sshUrl must be a string");
  if (requireSshUrl && typeof input.sshUrl !== "string") throw new Error("sshUrl is required");
  for (const key of ["presetRelatedRepoIds", "lastUsedRelatedRepoIds"] as const) {
    const value = input[key];
    if (value !== undefined && (!Array.isArray(value) || !value.every((item) => typeof item === "string"))) {
      throw new Error(`${key} must be an array of strings`);
    }
  }
  const result: { sshUrl?: string; presetRelatedRepoIds?: string[]; lastUsedRelatedRepoIds?: string[] } = {};
  if (input.sshUrl !== undefined) result.sshUrl = input.sshUrl as string;
  if (input.presetRelatedRepoIds !== undefined) result.presetRelatedRepoIds = input.presetRelatedRepoIds as string[];
  if (input.lastUsedRelatedRepoIds !== undefined) result.lastUsedRelatedRepoIds = input.lastUsedRelatedRepoIds as string[];
  return result;
}

export function createRepositoryWorkflow(dependencies: RepositoryWorkflowDependencies) {
  return {
    list: () => dependencies.registry.list(),
    add: async (body: unknown) => {
      const input = parseRepositoryInput(body, true);
      const repository = await dependencies.registry.registerPending({
        sshUrl: input.sshUrl as string,
        presetRelatedRepoIds: input.presetRelatedRepoIds,
      });
      const jobId = await dependencies.queueRevalidation(repository.id);
      return { repository, jobId };
    },
    update: async (id: string, body: unknown) => {
      const input = parseRepositoryInput(body, false);
      const current = await dependencies.registry.get(id);
      const sshUrlChanged = input.sshUrl !== undefined && input.sshUrl !== current.sshUrl;
      const updateInput = sshUrlChanged
        ? input
        : {
            presetRelatedRepoIds: input.presetRelatedRepoIds,
            lastUsedRelatedRepoIds: input.lastUsedRelatedRepoIds,
          };
      const repository = await dependencies.registry.updatePending(id, updateInput);
      const jobId = sshUrlChanged ? await dependencies.queueRevalidation(repository.id) : null;
      return { repository, jobId };
    },
    remove: (id: string) => dependencies.registry.remove(id),
    revalidate: async (id: string) => {
      const repository = await dependencies.registry.get(id);
      const jobId = await dependencies.queueRevalidation(repository.id);
      return { repository, jobId };
    },
  };
}

export async function queueRepositoryRevalidation(pool: Pool, repositoryId: string): Promise<string> {
  const jobId = randomUUID();
  await enqueueJob(pool, {
    id: jobId,
    type: "REPOSITORY_REVALIDATE",
    payload: { repositoryId },
    priority: 0,
    availableAt: new Date(),
  });
  return jobId;
}
