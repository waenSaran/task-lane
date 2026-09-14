import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Repository } from "@task-lane/domain";
import type { PlanFeatureValidationResult } from "../dist/plan-feature-validation.js";
import {
  DuplicateRepositoryError,
  InvalidPrimaryRepositoryError,
  RepositoryRegistry,
  type RepositoryStore,
} from "../dist/registry.js";
import { parseGithubSshUrl } from "../dist/github-ssh-url.js";
import { GitCommandError, runGit, syncRepositoryAtPath } from "../dist/git.js";
import {
  PLAN_FEATURE_SKILL_PATH,
  validatePlanFeatureRepository,
} from "../dist/plan-feature-validation.js";

const now = "2026-09-14T00:00:00.000Z";

class MemoryRepositoryStore implements RepositoryStore {
  readonly repositories = new Map<string, Repository>();
  readonly assigned = new Map<string, string>();

  async save(value: Repository): Promise<void> {
    this.repositories.set(value.id, structuredClone(value));
  }

  async find(id: string): Promise<Repository | null> {
    const value = this.repositories.get(id);
    return value ? structuredClone(value) : null;
  }

  async findBySshUrl(sshUrl: string): Promise<Repository | null> {
    const value = [...this.repositories.values()].find((repository) => repository.sshUrl.toLowerCase() === sshUrl.toLowerCase());
    return value ? structuredClone(value) : null;
  }

  async list(): Promise<Repository[]> {
    return [...this.repositories.values()].map((value) => structuredClone(value));
  }

  async delete(id: string): Promise<boolean> {
    return this.repositories.delete(id);
  }

  async assignPrimaryRepository(planningCaseId: string, repositoryId: string): Promise<boolean> {
    const repository = this.repositories.get(repositoryId);
    if (!repository || repository.validationStatus !== "VALID" || planningCaseId !== "case_1") return false;
    this.assigned.set(planningCaseId, repositoryId);
    return true;
  }

  async clearPrimaryRepositoryAssignments(repositoryId: string): Promise<void> {
    for (const [caseId, assignedRepositoryId] of this.assigned) {
      if (assignedRepositoryId === repositoryId) this.assigned.delete(caseId);
    }
  }
}

async function validFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "task-lane-plan-feature-"));
  await mkdir(path.join(root, ".claude/skills/plan-feature/references"), { recursive: true });
  await mkdir(path.join(root, ".claude/skills/plan-feature/templates"), { recursive: true });
  await mkdir(path.join(root, "docs"), { recursive: true });
  await mkdir(path.join(root, "packages/plane/src"), { recursive: true });
  await writeFile(
    path.join(root, PLAN_FEATURE_SKILL_PATH),
    [
      "# plan-feature",
      "Read [the reference](references/contract.md) and `templates/plan.md`.",
      "Use `docs/readiness.md` and `packages/plane/src/index.ts`.",
    ].join("\n"),
  );
  await writeFile(path.join(root, ".claude/skills/plan-feature/references/contract.md"), "contract");
  await writeFile(path.join(root, ".claude/skills/plan-feature/templates/plan.md"), "template");
  await writeFile(path.join(root, "docs/readiness.md"), "readiness");
  await writeFile(path.join(root, "packages/plane/src/index.ts"), "export {};");
  return root;
}

function makeRegistry(
  store: MemoryRepositoryStore,
  checkoutRoot: string,
  validate: (repositoryRoot: string, now: () => string) => Promise<PlanFeatureValidationResult>,
): RepositoryRegistry {
  return new RepositoryRegistry({
    store,
    checkoutRoot,
    now: () => new Date(now),
    sync: async () => ({ mainSha: "main-sha", cloned: false }),
    validate,
  });
}

test("GitHub SSH URLs normalize deterministically and reject non-SSH input", () => {
  const first = parseGithubSshUrl("ssh://git@github.com/Owner/Repo", "/data/repos");
  const second = parseGithubSshUrl("git@github.com:owner/repo.git", "/data/repos");
  assert.deepEqual(first, second);
  assert.equal(first.localPath, "/data/repos/owner/repo");
  assert.throws(() => parseGithubSshUrl("https://github.com/owner/repo.git", "/data/repos"));
});

test("temporary Git fixture clones main and rejects a remote without main", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "task-lane-git-"));
  const remote = path.join(root, "main.git");
  const source = path.join(root, "source");
  await runGit(["init", "--bare", remote], root);
  await runGit(["init", source], root);
  await runGit(["config", "user.email", "fixture@example.test"], source);
  await runGit(["config", "user.name", "Fixture"], source);
  await writeFile(path.join(source, "README.md"), "main");
  await runGit(["add", "README.md"], source);
  await runGit(["commit", "-m", "fixture"], source);
  await runGit(["branch", "-M", "main"], source);
  await runGit(["remote", "add", "origin", remote], source);
  await runGit(["push", "-u", "origin", "main"], source);
  const checkout = path.join(root, "checkout");
  const synced = await syncRepositoryAtPath(checkout, remote);
  assert.equal(synced.mainSha.length > 0, true);

  const masterRemote = path.join(root, "master.git");
  const masterSource = path.join(root, "master-source");
  await runGit(["init", "--bare", masterRemote], root);
  await runGit(["init", masterSource], root);
  await runGit(["config", "user.email", "fixture@example.test"], masterSource);
  await runGit(["config", "user.name", "Fixture"], masterSource);
  await writeFile(path.join(masterSource, "README.md"), "master");
  await runGit(["add", "README.md"], masterSource);
  await runGit(["commit", "-m", "fixture"], masterSource);
  await runGit(["branch", "-M", "master"], masterSource);
  await runGit(["remote", "add", "origin", masterRemote], masterSource);
  await runGit(["push", "-u", "origin", "master"], masterSource);
  await assert.rejects(
    syncRepositoryAtPath(path.join(root, "master-checkout"), masterRemote),
    (error: unknown) => error instanceof GitCommandError && error.message.includes("main is missing"),
  );
});

test("plan-feature validation checks the skill and every declared prerequisite", async () => {
  const root = await validFixture();
  const valid = await validatePlanFeatureRepository(root, () => now);
  assert.equal(valid.status, "VALID");
  assert.deepEqual(valid.report.errors, []);
  assert.ok(valid.prerequisites.includes(".claude/skills/plan-feature/references/contract.md"));

  await writeFile(path.join(root, PLAN_FEATURE_SKILL_PATH), "Read `references/missing.md`.");
  const missing = await validatePlanFeatureRepository(root, () => now);
  assert.equal(missing.status, "INVALID");
  assert.ok(missing.report.errors.some((error) => error.includes(".claude/skills/plan-feature/references/missing.md")));

  const skillless = await mkdtemp(path.join(os.tmpdir(), "task-lane-skillless-"));
  const noSkill = await validatePlanFeatureRepository(skillless, () => now);
  assert.equal(noSkill.status, "INVALID");
  assert.ok(noSkill.report.errors.some((error) => error.includes(PLAN_FEATURE_SKILL_PATH)));
});

test("registry revalidation moves INVALID to VALID and persists a fresh report", async () => {
  const root = await validFixture();
  const store = new MemoryRepositoryStore();
  let valid = false;
  let checks = 0;
  const registry = makeRegistry(store, root, async (_path, clock) => ({
    status: valid ? "VALID" : "INVALID",
    report: { checkedAt: checks++ === 0 ? clock() : "2026-09-14T00:01:00.000Z", errors: valid ? [] : ["missing prerequisite"], warnings: [] },
    prerequisites: [],
  }));
  const first = await registry.register({ sshUrl: "git@github.com:Owner/Repo.git" });
  assert.equal(first.validationStatus, "INVALID");
  valid = true;
  const second = await registry.revalidate(first.id);
  assert.equal(second.validationStatus, "VALID");
  assert.equal(second.lastSyncedSha, "main-sha");
  assert.notEqual(second.validationReport?.checkedAt, first.validationReport?.checkedAt);
});

test("registry CRUD, normalized duplicates, explicit related preferences, and primary selection are guarded", async () => {
  const store = new MemoryRepositoryStore();
  const root = await mkdtemp(path.join(os.tmpdir(), "task-lane-registry-"));
  const registry = makeRegistry(store, root, async (_path, clock) => ({
    status: "VALID",
    report: { checkedAt: clock(), errors: [], warnings: [] },
    prerequisites: [],
  }));
  const first = await registry.register({ sshUrl: "git@github.com:owner/repo.git" });
  const duplicate = await registry.register({ sshUrl: "ssh://git@github.com/OWNER/REPO" });
  assert.equal(duplicate.id, first.id);
  assert.equal((await registry.list()).length, 1);
  const updated = await registry.updateRelatedRepositories(first.id, {
    presetRelatedRepoIds: ["related_1"],
    lastUsedRelatedRepoIds: ["related_2"],
  });
  assert.deepEqual(updated.presetRelatedRepoIds, ["related_1"]);
  assert.deepEqual(updated.lastUsedRelatedRepoIds, ["related_2"]);
  await registry.selectPrimaryRepository("case_1", first.id);
  assert.equal(store.assigned.get("case_1"), first.id);

  const invalid = await registry.register({ sshUrl: "git@github.com:owner/invalid.git" });
  store.repositories.set(invalid.id, { ...invalid, validationStatus: "INVALID" });
  await assert.rejects(registry.selectPrimaryRepository("case_1", invalid.id), InvalidPrimaryRepositoryError);
  await registry.remove(first.id);
  assert.equal(await registry.get(invalid.id).then((repository) => repository.name), "owner/invalid");
});

test("registry sanitizes Git failures", async () => {
  const store = new MemoryRepositoryStore();
  const registry = new RepositoryRegistry({
    store,
    checkoutRoot: "/data/repos",
    now: () => new Date(now),
    sync: async () => {
      throw new Error("git@github.com:owner/private.git password=super-secret");
    },
  });
  const repository = await registry.register({ sshUrl: "git@github.com:owner/private.git" });
  assert.equal(repository.validationStatus, "INVALID");
  assert.equal(repository.validationReport?.errors.some((error) => error.includes("private.git") || error.includes("super-secret")), false);
});
