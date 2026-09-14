import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (relativePath: string) =>
  JSON.parse(await readFile(new URL(relativePath, import.meta.url), "utf8"));

test("web runtime is SvelteKit with the Node adapter", async () => {
  const pkg = await readJson("../package.json");

  assert.equal(pkg.devDependencies["@sveltejs/kit"], "2.70.3");
  assert.equal(pkg.devDependencies["@sveltejs/adapter-node"], "5.5.7");
  assert.equal(pkg.devDependencies.svelte, "5.57.0");
  assert.equal(pkg.devDependencies.vite, "8.2.2");
  assert.equal(pkg.dependencies.next, undefined);
  assert.equal(pkg.scripts.build, "vite build");
  assert.equal(pkg.scripts.start, "node build");
});

test("SvelteKit server routes own the existing HTTP endpoints", async () => {
  const healthRoute = await readFile(
    new URL("../src/routes/api/health/+server.ts", import.meta.url),
    "utf8",
  );
  const fetchRoute = await readFile(
    new URL("../src/routes/api/plane/fetch/+server.ts", import.meta.url),
    "utf8",
  );

  assert.match(healthRoute, /export async function GET/);
  assert.match(fetchRoute, /export async function POST/);
  assert.match(fetchRoute, /status: 202/);
  assert.match(fetchRoute, /status: 503/);
});

test("repository management routes expose CRUD and worker revalidation", async () => {
  const listRoute = await readFile(new URL("../src/routes/api/repositories/+server.ts", import.meta.url), "utf8");
  const itemRoute = await readFile(new URL("../src/routes/api/repositories/[id]/+server.ts", import.meta.url), "utf8");
  const revalidateRoute = await readFile(new URL("../src/routes/api/repositories/[id]/revalidate/+server.ts", import.meta.url), "utf8");

  assert.match(listRoute, /export const GET/);
  assert.match(listRoute, /export const POST/);
  assert.match(itemRoute, /export const PATCH/);
  assert.match(itemRoute, /export const DELETE/);
  assert.match(revalidateRoute, /export const POST/);
  assert.match(listRoute, /queueRepositoryRevalidation/);
  assert.doesNotMatch(listRoute, /runGit|execFile|spawn/);
  assert.doesNotMatch(revalidateRoute, /runGit|execFile|spawn/);
});
