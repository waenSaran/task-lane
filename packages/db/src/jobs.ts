import type { FailureDetails, Job } from "@task-lane/domain";
import type { Pool, PoolClient } from "pg";

type DbQueryable = Pool | PoolClient;

export interface EnqueueJobInput<TPayload = unknown> {
  id: string;
  type: string;
  payload: TPayload;
  priority: number;
  availableAt: Date;
}

export interface ClaimJobInput {
  workerId: string;
  now: Date;
  leaseDurationMs: number;
}

interface JobRow {
  id: string;
  type: string;
  payload: unknown;
  status: Job["status"];
  priority: number;
  available_at: Date;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  attempts: number;
  error: FailureDetails | null;
  created_at: Date;
  updated_at: Date;
}

function mapJob(row: JobRow): Job {
  return {
    id: row.id,
    type: row.type,
    payload: row.payload,
    status: row.status,
    priority: row.priority,
    availableAt: row.available_at.toISOString(),
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at?.toISOString() ?? null,
    attempts: row.attempts,
    error: row.error,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function enqueueJob<TPayload>(db: DbQueryable, input: EnqueueJobInput<TPayload>): Promise<Job> {
  const result = await db.query<JobRow>(
    `insert into jobs (id, type, payload, status, priority, available_at)
     values ($1,$2,$3::jsonb,'QUEUED',$4,$5)
     returning *`,
    [input.id, input.type, JSON.stringify(input.payload), input.priority, input.availableAt],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Job insert returned no row");
  }
  return mapJob(row);
}

export async function findJob(db: DbQueryable, id: string): Promise<Job | null> {
  const result = await db.query<JobRow>("select * from jobs where id = $1", [id]);
  const row = result.rows[0];
  return row ? mapJob(row) : null;
}

export async function claimJob(db: DbQueryable, input: ClaimJobInput): Promise<Job | null> {
  const result = await db.query<JobRow>(
    `with candidate as (
       select id
       from jobs
       where status = 'QUEUED' and available_at <= $1
       order by priority desc, available_at asc, created_at asc
       for update skip locked
       limit 1
     )
     update jobs as job
     set status = 'LEASED',
         lease_owner = $2,
         lease_expires_at = $1::timestamptz + ($3::bigint * interval '1 millisecond'),
         attempts = job.attempts + 1,
         error = null,
         updated_at = $1
     from candidate
     where job.id = candidate.id
     returning job.*`,
    [input.now, input.workerId, input.leaseDurationMs],
  );
  const row = result.rows[0];
  return row ? mapJob(row) : null;
}

export async function completeJob(db: DbQueryable, id: string): Promise<void> {
  await db.query(
    `update jobs
     set status = 'COMPLETED', lease_owner = null, lease_expires_at = null, updated_at = now()
     where id = $1 and status = 'LEASED'`,
    [id],
  );
}

export async function failJob(db: DbQueryable, id: string, error: FailureDetails): Promise<void> {
  await db.query(
    `update jobs
     set status = 'FAILED', error = $2::jsonb, lease_owner = null, lease_expires_at = null, updated_at = now()
     where id = $1 and status = 'LEASED'`,
    [id, JSON.stringify(error)],
  );
}

export async function failExpiredJobs(db: DbQueryable, now: Date): Promise<number> {
  const result = await db.query(
    `update jobs
     set status = 'FAILED',
         error = $2::jsonb,
         lease_owner = null,
         lease_expires_at = null,
         updated_at = $1
     where status = 'LEASED' and lease_expires_at <= $1`,
    [now, JSON.stringify({ code: "LEASE_EXPIRED", message: "Worker lease expired" })],
  );
  return result.rowCount ?? 0;
}
