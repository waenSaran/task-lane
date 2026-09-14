import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Repository } from "@task-lane/domain";
import { DuplicateRepositoryError, RepositoryNotFoundError } from "@task-lane/repos";
import { createRepositoryWorkflow, parseRepositoryInput } from "../src/repository-actions.ts";

const invalidRepository: Repository = {
  id: "repo_invalid",
  name: "owner/invalid",
  sshUrl: "git@github.com:owner/invalid.git",
  localPath: "/data/repos/owner/invalid",
  lastUsedAgent: null,
  validationStatus: "INVALID" as const,
  lastSyncedSha: null,
  presetRelatedRepoIds: ["repo_related"],
  lastUsedRelatedRepoIds: ["repo_last"],
  validationReport: {
    checkedAt: "2026-09-14T00:00:00.000Z",
    errors: ["Missing plan-feature prerequisite: .agent/knowledge/plan-readiness-rubric.md"],
    warnings: [],
  },
  createdAt: "2026-09-14T00:00:00.000Z",
  updatedAt: "2026-09-14T00:00:00.000Z",
};

test("repository workflow lists status and validation report without Git access", async () => {
  const calls: string[] = [];
  const workflow = createRepositoryWorkflow({
    registry: {
      list: async () => [invalidRepository],
      registerPending: async () => invalidRepository,
      updatePending: async () => invalidRepository,
      remove: async () => undefined,
      get: async () => invalidRepository,
    },
    queueRevalidation: async (id) => {
      calls.push(id);
      return "job_1";
    },
  });

  const repositories = await workflow.list();
  assert.equal(repositories[0]?.validationStatus, "INVALID");
  assert.match(repositories[0]?.validationReport?.errors[0] ?? "", /Missing plan-feature prerequisite/);
  assert.deepEqual(parseRepositoryInput({ presetRelatedRepoIds: ["repo_related"] }, false), {
    presetRelatedRepoIds: ["repo_related"],
  });
  assert.deepEqual(calls, []);
});

test("repository workflow adds, edits suggestions, removes, and queues revalidation", async () => {
  const calls: string[] = [];
  let stored: Repository = invalidRepository;
  const workflow = createRepositoryWorkflow({
    registry: {
      list: async () => [stored],
      registerPending: async (input) => {
        stored = { ...stored, sshUrl: input.sshUrl, presetRelatedRepoIds: [...(input.presetRelatedRepoIds ?? [])], validationStatus: "PENDING", validationReport: null };
        return stored;
      },
      updatePending: async (_id, input) => {
        if (input.presetRelatedRepoIds?.includes("repo_b")) {
          assert.equal(input.sshUrl, undefined, "suggestion-only save must not rewrite the SSH URL or trigger validation");
        }
        stored = {
          ...stored,
          sshUrl: input.sshUrl ?? stored.sshUrl,
          presetRelatedRepoIds: [...(input.presetRelatedRepoIds ?? stored.presetRelatedRepoIds)],
          lastUsedRelatedRepoIds: [...(input.lastUsedRelatedRepoIds ?? stored.lastUsedRelatedRepoIds)],
        };
        return stored;
      },
      remove: async (id) => {
        if (id !== stored.id) throw new RepositoryNotFoundError();
        calls.push(`remove:${id}`);
      },
      get: async () => stored,
    },
    queueRevalidation: async (id) => {
      calls.push(`queue:${id}`);
      return "job_1";
    },
  });

  const added = await workflow.add({ sshUrl: "git@github.com:owner/repo.git", presetRelatedRepoIds: ["repo_a"] });
  assert.equal(added.repository.validationStatus, "PENDING");
  const updated = await workflow.update(stored.id, {
    sshUrl: stored.sshUrl,
    presetRelatedRepoIds: ["repo_b"],
    lastUsedRelatedRepoIds: ["repo_c"],
  });
  assert.deepEqual(updated.repository.presetRelatedRepoIds, ["repo_b"]);
  assert.deepEqual(updated.repository.lastUsedRelatedRepoIds, ["repo_c"]);
  assert.equal(updated.jobId, null);
  await workflow.revalidate(stored.id);
  await workflow.remove(stored.id);
  assert.deepEqual(calls, ["queue:repo_invalid", "queue:repo_invalid", "remove:repo_invalid"]);
});

test("repository workflow queues revalidation when the SSH URL actually changes", async () => {
  const calls: string[] = [];
  let stored: Repository = invalidRepository;
  const workflow = createRepositoryWorkflow({
    registry: {
      list: async () => [stored],
      registerPending: async () => stored,
      updatePending: async (_id, input) => {
        stored = { ...stored, sshUrl: input.sshUrl ?? stored.sshUrl, validationStatus: input.sshUrl ? "PENDING" : stored.validationStatus };
        return stored;
      },
      remove: async () => undefined,
      get: async () => stored,
    },
    queueRevalidation: async (id) => {
      calls.push(`queue:${id}`);
      return "job_2";
    },
  });

  const updated = await workflow.update(stored.id, { sshUrl: "git@github.com:owner/new-repo.git" });
  assert.equal(updated.jobId, "job_2");
  assert.deepEqual(calls, ["queue:repo_invalid"]);
});

test("invalid input and duplicate registration remain explicit API errors", async () => {
  assert.throws(() => parseRepositoryInput({ sshUrl: 123 }, true), /sshUrl must be a string/);
  const workflow = createRepositoryWorkflow({
    registry: {
      list: async () => [],
      registerPending: async () => { throw new DuplicateRepositoryError(); },
      updatePending: async () => invalidRepository,
      remove: async () => undefined,
      get: async () => invalidRepository,
    },
    queueRevalidation: async () => "job_1",
  });
  await assert.rejects(workflow.add({ sshUrl: "ssh://git@github.com/owner/repo" }), DuplicateRepositoryError);
});

test("web repository workflow contains no Git or SSH execution", async () => {
  const source = await readFile(new URL("../src/repository-actions.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /runGit|execFile|spawn\(/);
});
