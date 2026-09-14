import type { DbQueryable } from "@task-lane/db";
import {
  assignPrimaryRepository,
  clearPrimaryRepositoryAssignments,
  deleteRepository,
  findRepository,
  findRepositoryBySshUrl,
  listRepositories,
  saveRepository,
} from "@task-lane/db";
import type { Repository } from "@task-lane/domain";
import path from "node:path";
import { parseGithubSshUrl, type GithubSshRepository } from "./github-ssh-url.js";
import { sanitizedGitMessage, syncRepository, type SyncedRepository } from "./git.js";
import { validatePlanFeatureRepository, type PlanFeatureValidationResult } from "./plan-feature-validation.js";

export interface RepositoryStore {
  save(value: Repository): Promise<void>;
  find(id: string): Promise<Repository | null>;
  findBySshUrl(sshUrl: string): Promise<Repository | null>;
  list(): Promise<Repository[]>;
  delete(id: string): Promise<boolean>;
  assignPrimaryRepository(planningCaseId: string, repositoryId: string, updatedAt: string): Promise<boolean>;
  clearPrimaryRepositoryAssignments(repositoryId: string): Promise<void>;
}

export function createRepositoryStore(db: DbQueryable): RepositoryStore {
  return {
    save: (value) => saveRepository(db, value),
    find: (id) => findRepository(db, id),
    findBySshUrl: (sshUrl) => findRepositoryBySshUrl(db, sshUrl),
    list: () => listRepositories(db),
    delete: (id) => deleteRepository(db, id),
    assignPrimaryRepository: (planningCaseId, repositoryId, updatedAt) => assignPrimaryRepository(db, planningCaseId, repositoryId, updatedAt),
    clearPrimaryRepositoryAssignments: (repositoryId) => clearPrimaryRepositoryAssignments(db, repositoryId),
  };
}

export class RepositoryNotFoundError extends Error {
  constructor() {
    super("Repository was not found");
    this.name = "RepositoryNotFoundError";
  }
}

export class DuplicateRepositoryError extends Error {
  constructor() {
    super("A repository with this SSH URL is already registered");
    this.name = "DuplicateRepositoryError";
  }
}

export class InvalidPrimaryRepositoryError extends Error {
  constructor() {
    super("Only a VALID repository can be selected as the planning primary repository");
    this.name = "InvalidPrimaryRepositoryError";
  }
}

export interface RepositoryRegistryDependencies {
  store: RepositoryStore;
  checkoutRoot: string;
  now?: () => Date;
  sync?: (repository: GithubSshRepository) => Promise<SyncedRepository>;
  validate?: (repositoryRoot: string, now: () => string) => Promise<PlanFeatureValidationResult>;
}

export interface RegisterRepositoryInput {
  sshUrl: string;
  presetRelatedRepoIds?: readonly string[];
}

export interface UpdateRepositoryInput {
  sshUrl?: string;
  presetRelatedRepoIds?: readonly string[];
  lastUsedRelatedRepoIds?: readonly string[];
}

function uniqueIds(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).filter((value) => value.length > 0))];
}

function iso(now: () => Date): string {
  return now().toISOString();
}

function errorReport(error: unknown, checkedAt: string): Repository["validationReport"] {
  return { checkedAt, errors: [sanitizedGitMessage(error)], warnings: [] };
}

export class RepositoryRegistry {
  private readonly now: () => Date;
  private readonly sync: (repository: GithubSshRepository) => Promise<SyncedRepository>;
  private readonly validate: (repositoryRoot: string, now: () => string) => Promise<PlanFeatureValidationResult>;
  private readonly dependencies: RepositoryRegistryDependencies;

  constructor(dependencies: RepositoryRegistryDependencies) {
    this.dependencies = dependencies;
    this.now = dependencies.now ?? (() => new Date());
    this.sync = dependencies.sync ?? syncRepository;
    this.validate = dependencies.validate ?? validatePlanFeatureRepository;
  }

  async list(): Promise<Repository[]> {
    return this.dependencies.store.list();
  }

  async get(id: string): Promise<Repository> {
    const repository = await this.dependencies.store.find(id);
    if (!repository) throw new RepositoryNotFoundError();
    return repository;
  }

  async register(input: RegisterRepositoryInput): Promise<Repository> {
    const repository = await this.registerPending(input);
    return this.revalidate(repository.id);
  }

  async registerPending(input: RegisterRepositoryInput): Promise<Repository> {
    const parsed = parseGithubSshUrl(input.sshUrl, this.dependencies.checkoutRoot);
    const existing = await this.dependencies.store.findBySshUrl(parsed.normalizedSshUrl);
    const now = iso(this.now);
    const repository: Repository = {
      id: existing?.id ?? parsed.id,
      name: parsed.name,
      sshUrl: parsed.normalizedSshUrl,
      localPath: existing?.localPath ?? parsed.localPath,
      validationStatus: "PENDING",
      lastSyncedSha: existing?.lastSyncedSha ?? null,
      lastUsedAgent: existing?.lastUsedAgent ?? null,
      presetRelatedRepoIds: input.presetRelatedRepoIds ? uniqueIds(input.presetRelatedRepoIds) : existing?.presetRelatedRepoIds ?? [],
      lastUsedRelatedRepoIds: existing?.lastUsedRelatedRepoIds ?? [],
      validationReport: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.dependencies.store.save(repository);
    return repository;
  }

  async update(id: string, input: UpdateRepositoryInput): Promise<Repository> {
    const existing = await this.get(id);
    let repository = existing;
    let shouldRevalidate = false;
    if (input.sshUrl !== undefined) {
      const parsed = parseGithubSshUrl(input.sshUrl, this.dependencies.checkoutRoot);
      const duplicate = await this.dependencies.store.findBySshUrl(parsed.normalizedSshUrl);
      if (duplicate && duplicate.id !== id) throw new DuplicateRepositoryError();
      repository = {
        ...repository,
        name: parsed.name,
        sshUrl: parsed.normalizedSshUrl,
        localPath: path.resolve(this.dependencies.checkoutRoot, parsed.relativePath),
        validationStatus: "PENDING",
        lastSyncedSha: null,
        validationReport: null,
      };
      shouldRevalidate = true;
    }
    repository = {
      ...repository,
      presetRelatedRepoIds: input.presetRelatedRepoIds === undefined ? repository.presetRelatedRepoIds : uniqueIds(input.presetRelatedRepoIds),
      lastUsedRelatedRepoIds: input.lastUsedRelatedRepoIds === undefined ? repository.lastUsedRelatedRepoIds : uniqueIds(input.lastUsedRelatedRepoIds),
      updatedAt: iso(this.now),
    };
    await this.dependencies.store.save(repository);
    return shouldRevalidate ? this.revalidate(id) : repository;
  }

  async updatePending(id: string, input: UpdateRepositoryInput): Promise<Repository> {
    const existing = await this.get(id);
    let repository = existing;
    if (input.sshUrl !== undefined) {
      const parsed = parseGithubSshUrl(input.sshUrl, this.dependencies.checkoutRoot);
      const duplicate = await this.dependencies.store.findBySshUrl(parsed.normalizedSshUrl);
      if (duplicate && duplicate.id !== id) throw new DuplicateRepositoryError();
      repository = {
        ...repository,
        name: parsed.name,
        sshUrl: parsed.normalizedSshUrl,
        localPath: path.resolve(this.dependencies.checkoutRoot, parsed.relativePath),
        validationStatus: "PENDING",
        lastSyncedSha: null,
        validationReport: null,
      };
    }
    repository = {
      ...repository,
      presetRelatedRepoIds: input.presetRelatedRepoIds === undefined ? repository.presetRelatedRepoIds : uniqueIds(input.presetRelatedRepoIds),
      lastUsedRelatedRepoIds: input.lastUsedRelatedRepoIds === undefined ? repository.lastUsedRelatedRepoIds : uniqueIds(input.lastUsedRelatedRepoIds),
      updatedAt: iso(this.now),
    };
    await this.dependencies.store.save(repository);
    return repository;
  }

  async updateRelatedRepositories(
    id: string,
    input: { presetRelatedRepoIds?: readonly string[]; lastUsedRelatedRepoIds?: readonly string[] },
  ): Promise<Repository> {
    return this.update(id, input);
  }

  async remove(id: string): Promise<void> {
    const removed = await this.dependencies.store.delete(id);
    if (!removed) throw new RepositoryNotFoundError();
  }

  async revalidate(id: string): Promise<Repository> {
    const current = await this.get(id);
    const pending: Repository = {
      ...current,
      validationStatus: "PENDING",
      validationReport: null,
      updatedAt: iso(this.now),
    };
    await this.dependencies.store.save(pending);
    const checkedAt = iso(this.now);
    try {
      const parsed = parseGithubSshUrl(current.sshUrl, this.dependencies.checkoutRoot);
      const synced = await this.sync({ ...parsed, localPath: current.localPath });
      const validation = await this.validate(current.localPath, () => checkedAt);
      const result: Repository = {
        ...pending,
        validationStatus: validation.status,
        lastSyncedSha: validation.status === "VALID" ? synced.mainSha : null,
        validationReport: validation.report,
        updatedAt: iso(this.now),
      };
      await this.dependencies.store.save(result);
      if (result.validationStatus === "INVALID") await this.dependencies.store.clearPrimaryRepositoryAssignments(id);
      return result;
    } catch (error) {
      const result: Repository = {
        ...pending,
        validationStatus: "INVALID",
        lastSyncedSha: null,
        validationReport: errorReport(error, checkedAt),
        updatedAt: iso(this.now),
      };
      await this.dependencies.store.save(result);
      await this.dependencies.store.clearPrimaryRepositoryAssignments(id);
      return result;
    }
  }

  async selectPrimaryRepository(planningCaseId: string, repositoryId: string): Promise<void> {
    const repository = await this.get(repositoryId);
    if (repository.validationStatus !== "VALID") throw new InvalidPrimaryRepositoryError();
    const assigned = await this.dependencies.store.assignPrimaryRepository(planningCaseId, repositoryId, iso(this.now));
    if (!assigned) throw new InvalidPrimaryRepositoryError();
  }
}
