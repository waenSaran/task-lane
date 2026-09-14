import type { RequestHandler } from "@sveltejs/kit";
import { DuplicateRepositoryError } from "@task-lane/repos";
import { getPool } from "../../../postgres.js";
import {
  createRepositoryWorkflow,
  createWebRepositoryRegistry,
  queueRepositoryRevalidation,
} from "../../../repository-actions.js";

function workflow() {
  const pool = getPool();
  return createRepositoryWorkflow({
    registry: createWebRepositoryRegistry(pool),
    queueRevalidation: (repositoryId) => queueRepositoryRevalidation(pool, repositoryId),
  });
}

export const GET: RequestHandler = async () => {
  return Response.json({ repositories: await workflow().list() });
};

export const POST: RequestHandler = async ({ request }) => {
  try {
    return Response.json(await workflow().add(await request.json()), { status: 202 });
  } catch (error) {
    const status = error instanceof DuplicateRepositoryError ? 409 : 400;
    const message = error instanceof Error ? error.message : "Unable to register repository";
    return Response.json({ error: message }, { status });
  }
};
