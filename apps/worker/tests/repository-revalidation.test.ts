import assert from "node:assert/strict";
import test from "node:test";
import { executeRepositoryRevalidationJob } from "../src/repository-revalidation.ts";

test("repository revalidation executes in the worker and completes the queued job", async () => {
  const calls: string[] = [];
  const result = await executeRepositoryRevalidationJob(
    { id: "job_1", payload: { repositoryId: "repo_1" } },
    {
      revalidate: async (id) => { calls.push(`revalidate:${id}`); },
      complete: async (id) => { calls.push(`complete:${id}`); },
      fail: async () => { calls.push("fail"); },
    },
  );
  assert.equal(result, "COMPLETED");
  assert.deepEqual(calls, ["revalidate:repo_1", "complete:job_1"]);
});

test("malformed repository revalidation payload fails without invoking Git work", async () => {
  const calls: string[] = [];
  const result = await executeRepositoryRevalidationJob(
    { id: "job_bad", payload: {} },
    {
      revalidate: async () => { calls.push("revalidate"); },
      complete: async () => { calls.push("complete"); },
      fail: async (id, message) => { calls.push(`fail:${id}:${message}`); },
    },
  );
  assert.equal(result, "FAILED");
  assert.deepEqual(calls, ["fail:job_bad:Repository revalidation job payload is invalid"]);
});
