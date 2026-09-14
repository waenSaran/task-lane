import type {
  PlanRevision,
  PlanningCase,
  PlanningRun,
  Repository,
  ReviewFeedback,
  Settings,
} from "@task-lane/domain";
import type { Pool, PoolClient } from "pg";

export type DbQueryable = Pool | PoolClient;

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function isoNullable(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

interface RepositoryRow {
  id: string;
  name: string;
  ssh_url: string;
  local_path: string;
  validation_status: Repository["validationStatus"];
  last_synced_sha: string | null;
  last_used_agent: Repository["lastUsedAgent"];
  preset_related_repo_ids: string[];
  last_used_related_repo_ids: string[];
  validation_report: Repository["validationReport"];
  created_at: Date | string;
  updated_at: Date | string;
}

function mapRepository(row: RepositoryRow): Repository {
  return {
    id: row.id,
    name: row.name,
    sshUrl: row.ssh_url,
    localPath: row.local_path,
    validationStatus: row.validation_status,
    lastSyncedSha: row.last_synced_sha,
    lastUsedAgent: row.last_used_agent,
    presetRelatedRepoIds: row.preset_related_repo_ids,
    lastUsedRelatedRepoIds: row.last_used_related_repo_ids,
    validationReport: row.validation_report,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export async function saveRepository(db: DbQueryable, value: Repository): Promise<void> {
  await db.query(
    `insert into repositories (
      id, name, ssh_url, local_path, validation_status, last_synced_sha, last_used_agent,
      preset_related_repo_ids, last_used_related_repo_ids, validation_report, created_at, updated_at
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
    on conflict (id) do update set
      name = excluded.name,
      ssh_url = excluded.ssh_url,
      local_path = excluded.local_path,
      validation_status = excluded.validation_status,
      last_synced_sha = excluded.last_synced_sha,
      last_used_agent = excluded.last_used_agent,
      preset_related_repo_ids = excluded.preset_related_repo_ids,
      last_used_related_repo_ids = excluded.last_used_related_repo_ids,
      validation_report = excluded.validation_report,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at`,
    [
      value.id,
      value.name,
      value.sshUrl,
      value.localPath,
      value.validationStatus,
      value.lastSyncedSha,
      value.lastUsedAgent,
      [...value.presetRelatedRepoIds],
      [...value.lastUsedRelatedRepoIds],
      JSON.stringify(value.validationReport),
      value.createdAt,
      value.updatedAt,
    ],
  );
}

export async function findRepository(db: DbQueryable, id: string): Promise<Repository | null> {
  const result = await db.query<RepositoryRow>("select * from repositories where id = $1", [id]);
  return result.rows[0] ? mapRepository(result.rows[0]) : null;
}

export async function findRepositoryBySshUrl(db: DbQueryable, sshUrl: string): Promise<Repository | null> {
  const result = await db.query<RepositoryRow>("select * from repositories where lower(ssh_url) = lower($1)", [sshUrl]);
  return result.rows[0] ? mapRepository(result.rows[0]) : null;
}

export async function listRepositories(db: DbQueryable): Promise<Repository[]> {
  const result = await db.query<RepositoryRow>("select * from repositories order by name asc, id asc");
  return result.rows.map(mapRepository);
}

export async function deleteRepository(db: DbQueryable, id: string): Promise<boolean> {
  const result = await db.query("delete from repositories where id = $1", [id]);
  return result.rowCount === 1;
}

export async function assignPrimaryRepository(
  db: DbQueryable,
  planningCaseId: string,
  repositoryId: string,
  updatedAt: string,
): Promise<boolean> {
  const result = await db.query(
    `update planning_cases as planning_case
     set primary_repo_id = $2, updated_at = $3
     from repositories as repository
     where planning_case.id = $1
       and repository.id = $2
       and repository.validation_status = 'VALID'`,
    [planningCaseId, repositoryId, updatedAt],
  );
  return result.rowCount === 1;
}

export async function clearPrimaryRepositoryAssignments(db: DbQueryable, repositoryId: string): Promise<void> {
  await db.query(
    `update planning_cases
     set primary_repo_id = null, updated_at = now()
     where primary_repo_id = $1`,
    [repositoryId],
  );
}

interface PlanningCaseRow {
  id: string;
  plane_issue_id: string;
  plane_identifier: string;
  title: string;
  current_status: PlanningCase["currentStatus"];
  previous_status: PlanningCase["previousStatus"];
  eligibility: PlanningCase["eligibility"];
  primary_repo_id: string | null;
  preferred_agent: PlanningCase["preferredAgent"];
  last_published_run_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function mapPlanningCase(row: PlanningCaseRow): PlanningCase {
  return {
    id: row.id,
    planeIssueId: row.plane_issue_id,
    planeIdentifier: row.plane_identifier,
    title: row.title,
    currentStatus: row.current_status,
    previousStatus: row.previous_status,
    eligibility: row.eligibility,
    primaryRepoId: row.primary_repo_id,
    preferredAgent: row.preferred_agent,
    lastPublishedRunId: row.last_published_run_id,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export async function savePlanningCase(db: DbQueryable, value: PlanningCase): Promise<void> {
  if (value.primaryRepoId) {
    const repository = await db.query<{ validation_status: Repository["validationStatus"] }>(
      "select validation_status from repositories where id = $1",
      [value.primaryRepoId],
    );
    if (repository.rows[0]?.validation_status !== "VALID") {
      throw new Error("Primary repository must be VALID");
    }
  }
  await db.query(
    `insert into planning_cases (
      id, plane_issue_id, plane_identifier, title, current_status, previous_status, eligibility,
      primary_repo_id, preferred_agent, last_published_run_id, created_at, updated_at
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    on conflict (id) do update set
      plane_issue_id = excluded.plane_issue_id,
      plane_identifier = excluded.plane_identifier,
      title = excluded.title,
      current_status = excluded.current_status,
      previous_status = excluded.previous_status,
      eligibility = excluded.eligibility,
      primary_repo_id = excluded.primary_repo_id,
      preferred_agent = excluded.preferred_agent,
      last_published_run_id = excluded.last_published_run_id,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at`,
    [
      value.id,
      value.planeIssueId,
      value.planeIdentifier,
      value.title,
      value.currentStatus,
      value.previousStatus,
      value.eligibility,
      value.primaryRepoId,
      value.preferredAgent,
      value.lastPublishedRunId,
      value.createdAt,
      value.updatedAt,
    ],
  );
}

export async function findPlanningCase(db: DbQueryable, id: string): Promise<PlanningCase | null> {
  const result = await db.query<PlanningCaseRow>("select * from planning_cases where id = $1", [id]);
  return result.rows[0] ? mapPlanningCase(result.rows[0]) : null;
}

interface PlanningRunRow {
  id: string;
  planning_case_id: string;
  run_type: PlanningRun["runType"];
  agent: PlanningRun["agent"];
  agent_version: string | null;
  session_id: string | null;
  repo_revisions: PlanningRun["repoRevisions"];
  requirement_fingerprint: string | null;
  status: PlanningRun["status"];
  started_at: Date | string | null;
  finished_at: Date | string | null;
  failure: PlanningRun["failure"];
  created_at: Date | string;
  updated_at: Date | string;
}

function mapPlanningRun(row: PlanningRunRow): PlanningRun {
  return {
    id: row.id,
    planningCaseId: row.planning_case_id,
    runType: row.run_type,
    agent: row.agent,
    agentVersion: row.agent_version,
    sessionId: row.session_id,
    repoRevisions: row.repo_revisions,
    requirementFingerprint: row.requirement_fingerprint,
    status: row.status,
    startedAt: isoNullable(row.started_at),
    finishedAt: isoNullable(row.finished_at),
    failure: row.failure,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export async function savePlanningRun(db: DbQueryable, value: PlanningRun): Promise<void> {
  await db.query(
    `insert into planning_runs (
      id, planning_case_id, run_type, agent, agent_version, session_id, repo_revisions,
      requirement_fingerprint, status, started_at, finished_at, failure, created_at, updated_at
    ) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12::jsonb,$13,$14)
    on conflict (id) do update set
      planning_case_id = excluded.planning_case_id,
      run_type = excluded.run_type,
      agent = excluded.agent,
      agent_version = excluded.agent_version,
      session_id = excluded.session_id,
      repo_revisions = excluded.repo_revisions,
      requirement_fingerprint = excluded.requirement_fingerprint,
      status = excluded.status,
      started_at = excluded.started_at,
      finished_at = excluded.finished_at,
      failure = excluded.failure,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at`,
    [
      value.id,
      value.planningCaseId,
      value.runType,
      value.agent,
      value.agentVersion,
      value.sessionId,
      JSON.stringify(value.repoRevisions),
      value.requirementFingerprint,
      value.status,
      value.startedAt,
      value.finishedAt,
      JSON.stringify(value.failure),
      value.createdAt,
      value.updatedAt,
    ],
  );
}

export async function findPlanningRun(db: DbQueryable, id: string): Promise<PlanningRun | null> {
  const result = await db.query<PlanningRunRow>("select * from planning_runs where id = $1", [id]);
  return result.rows[0] ? mapPlanningRun(result.rows[0]) : null;
}

interface PlanRevisionRow {
  id: string;
  planning_run_id: string;
  version: number;
  draft_path: string;
  sha256: string;
  created_at: Date | string;
  approved_at: Date | string | null;
}

function mapPlanRevision(row: PlanRevisionRow): PlanRevision {
  return {
    id: row.id,
    planningRunId: row.planning_run_id,
    version: row.version,
    draftPath: row.draft_path,
    sha256: row.sha256,
    createdAt: iso(row.created_at),
    approvedAt: isoNullable(row.approved_at),
  };
}

export async function savePlanRevision(db: DbQueryable, value: PlanRevision): Promise<void> {
  await db.query(
    `insert into plan_revisions (id, planning_run_id, version, draft_path, sha256, created_at, approved_at)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (id) do update set
       planning_run_id = excluded.planning_run_id,
       version = excluded.version,
       draft_path = excluded.draft_path,
       sha256 = excluded.sha256,
       created_at = excluded.created_at,
       approved_at = excluded.approved_at`,
    [value.id, value.planningRunId, value.version, value.draftPath, value.sha256, value.createdAt, value.approvedAt],
  );
}

export async function findPlanRevision(db: DbQueryable, id: string): Promise<PlanRevision | null> {
  const result = await db.query<PlanRevisionRow>("select * from plan_revisions where id = $1", [id]);
  return result.rows[0] ? mapPlanRevision(result.rows[0]) : null;
}

interface ReviewFeedbackRow {
  id: string;
  revision_id: string;
  sections: ReviewFeedback["sections"];
  comment: string;
  created_at: Date | string;
}

function mapReviewFeedback(row: ReviewFeedbackRow): ReviewFeedback {
  return {
    id: row.id,
    revisionId: row.revision_id,
    sections: row.sections,
    comment: row.comment,
    createdAt: iso(row.created_at),
  };
}

export async function saveReviewFeedback(db: DbQueryable, value: ReviewFeedback): Promise<void> {
  await db.query(
    `insert into review_feedback (id, revision_id, sections, comment, created_at)
     values ($1,$2,$3,$4,$5)
     on conflict (id) do update set
       revision_id = excluded.revision_id,
       sections = excluded.sections,
       comment = excluded.comment,
       created_at = excluded.created_at`,
    [value.id, value.revisionId, [...value.sections], value.comment, value.createdAt],
  );
}

export async function findReviewFeedback(db: DbQueryable, id: string): Promise<ReviewFeedback | null> {
  const result = await db.query<ReviewFeedbackRow>("select * from review_feedback where id = $1", [id]);
  return result.rows[0] ? mapReviewFeedback(result.rows[0]) : null;
}

interface SettingsRow {
  default_agent: Settings["defaultAgent"];
  agent_concurrency: number;
  log_retention_days: number;
  fetch_times: string[];
  timezone: string;
  updated_at: Date | string;
}

function mapSettings(row: SettingsRow): Settings {
  return {
    defaultAgent: row.default_agent,
    agentConcurrency: row.agent_concurrency,
    logRetentionDays: row.log_retention_days,
    fetchTimes: row.fetch_times,
    timezone: row.timezone,
    updatedAt: iso(row.updated_at),
  };
}

export async function saveSettings(db: DbQueryable, value: Settings): Promise<void> {
  await db.query(
    `insert into settings (id, default_agent, agent_concurrency, log_retention_days, fetch_times, timezone, updated_at)
     values ('global',$1,$2,$3,$4,$5,$6)
     on conflict (id) do update set
       default_agent = excluded.default_agent,
       agent_concurrency = excluded.agent_concurrency,
       log_retention_days = excluded.log_retention_days,
       fetch_times = excluded.fetch_times,
       timezone = excluded.timezone,
       updated_at = excluded.updated_at`,
    [
      value.defaultAgent,
      value.agentConcurrency,
      value.logRetentionDays,
      [...value.fetchTimes],
      value.timezone,
      value.updatedAt,
    ],
  );
}

export async function findSettings(db: DbQueryable): Promise<Settings | null> {
  const result = await db.query<SettingsRow>("select * from settings where id = 'global'");
  return result.rows[0] ? mapSettings(result.rows[0]) : null;
}
