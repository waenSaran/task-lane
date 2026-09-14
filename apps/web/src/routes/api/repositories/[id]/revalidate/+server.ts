import type { RequestHandler } from "@sveltejs/kit";
import { RepositoryNotFoundError } from "@task-lane/repos";
import { getPool } from "../../../../../postgres.js";
import { createRepositoryWorkflow, createWebRepositoryRegistry, queueRepositoryRevalidation } from "../../../../../repository-actions.js";

export const POST: RequestHandler = async ({ params }) => {
  const id = params.id;
  if (!id) return Response.json({ error: "Repository id is required" }, { status: 400 });
  try {
    const pool = getPool();
    const result = await createRepositoryWorkflow({
      registry: createWebRepositoryRegistry(pool),
      queueRevalidation: (repositoryId) => queueRepositoryRevalidation(pool, repositoryId),
    }).revalidate(id);
    return Response.json({ ...result, status: "QUEUED" }, { status: 202 });
  } catch (error) {
    const status = error instanceof RepositoryNotFoundError ? 404 : 503;
    const message = error instanceof Error ? error.message : "Unable to queue repository revalidation";
    return Response.json({ error: message }, { status });
  }
};
