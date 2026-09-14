import type { RequestHandler } from "@sveltejs/kit";
import { RepositoryNotFoundError } from "@task-lane/repos";
import { getPool } from "../../../../postgres.js";
import { createRepositoryWorkflow, createWebRepositoryRegistry, queueRepositoryRevalidation } from "../../../../repository-actions.js";

function workflow() {
  const pool = getPool();
  return createRepositoryWorkflow({
    registry: createWebRepositoryRegistry(pool),
    queueRevalidation: (repositoryId) => queueRepositoryRevalidation(pool, repositoryId),
  });
}

export const PATCH: RequestHandler = async ({ params, request }) => {
  const id = params.id;
  if (!id) return Response.json({ error: "Repository id is required" }, { status: 400 });
  try {
    return Response.json(await workflow().update(id, await request.json()));
  } catch (error) {
    const status = error instanceof RepositoryNotFoundError ? 404 : 400;
    const message = error instanceof Error ? error.message : "Unable to update repository";
    return Response.json({ error: message }, { status });
  }
};

export const DELETE: RequestHandler = async ({ params }) => {
  const id = params.id;
  if (!id) return Response.json({ error: "Repository id is required" }, { status: 400 });
  try {
    await workflow().remove(id);
    return new Response(null, { status: 204 });
  } catch (error) {
    const status = error instanceof RepositoryNotFoundError ? 404 : 400;
    const message = error instanceof Error ? error.message : "Unable to remove repository";
    return Response.json({ error: message }, { status });
  }
};
