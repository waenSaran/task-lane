import type { PlanningCaseStatus, PlanningRunStatus } from "./state-machine.js";

export type IsoDateTime = string;
export type AgentKind = "CODEX" | "GROK";
export type PlanningRunType = "INITIAL" | "REVISION" | "REPLAN" | "RETRY";
export type ReviewSection = "AS_IS" | "TO_BE" | "TASK_TREE" | "VERIFICATION" | "OTHER";
export type RepositoryValidationStatus = "PENDING" | "VALID" | "INVALID";
export type JobStatus = "QUEUED" | "LEASED" | "COMPLETED" | "FAILED";
export type EligibilityStatus = "ELIGIBLE" | "INELIGIBLE";

export interface RepoRevision {
  repositoryId: string;
  sha: string;
}

export interface FailureDetails {
  code: string;
  message: string;
}

export interface PlanningCase {
  id: string;
  planeIssueId: string;
  planeIdentifier: string;
  title: string;
  currentStatus: PlanningCaseStatus;
  previousStatus: PlanningCaseStatus | null;
  eligibility: EligibilityStatus;
  primaryRepoId: string | null;
  preferredAgent: AgentKind | null;
  lastPublishedRunId: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface PlanningRun {
  id: string;
  planningCaseId: string;
  runType: PlanningRunType;
  agent: AgentKind;
  agentVersion: string | null;
  sessionId: string | null;
  repoRevisions: readonly RepoRevision[];
  requirementFingerprint: string | null;
  status: PlanningRunStatus;
  startedAt: IsoDateTime | null;
  finishedAt: IsoDateTime | null;
  failure: FailureDetails | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface PlanRevision {
  id: string;
  planningRunId: string;
  version: number;
  draftPath: string;
  sha256: string;
  createdAt: IsoDateTime;
  approvedAt: IsoDateTime | null;
}

export interface ReviewFeedback {
  id: string;
  revisionId: string;
  sections: readonly ReviewSection[];
  comment: string;
  createdAt: IsoDateTime;
}

export interface RepositoryValidationReport {
  checkedAt: IsoDateTime;
  errors: readonly string[];
  warnings: readonly string[];
}

export interface Repository {
  id: string;
  name: string;
  sshUrl: string;
  localPath: string;
  validationStatus: RepositoryValidationStatus;
  lastSyncedSha: string | null;
  lastUsedAgent: AgentKind | null;
  lastUsedRelatedRepoIds: readonly string[];
  validationReport: RepositoryValidationReport | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface Job<TType extends string = string, TPayload = unknown> {
  id: string;
  type: TType;
  payload: TPayload;
  status: JobStatus;
  priority: number;
  availableAt: IsoDateTime;
  leaseOwner: string | null;
  leaseExpiresAt: IsoDateTime | null;
  attempts: number;
  error: FailureDetails | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface Settings {
  defaultAgent: AgentKind;
  agentConcurrency: number;
  logRetentionDays: number;
  fetchTimes: readonly string[];
  timezone: string;
  updatedAt: IsoDateTime;
}
