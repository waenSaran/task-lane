import type { FailureDetails } from "@task-lane/domain";
import type { Pool, PoolClient } from "pg";
import { enqueueJob } from "./jobs.js";
import { withTransaction } from "./transaction.js";

type DbQueryable = Pool | PoolClient;

export interface ScheduleSlotRecord {
  slotKey: string;
  scheduledAt: string;
  status: "PENDING" | "SUCCESS" | "FAILED";
  completedAt: string | null;
  error: FailureDetails | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleSlotDefinition {
  slotKey: string;
  scheduledAt: Date;
}

interface ScheduleSlotRow {
  slot_key: string;
  scheduled_at: Date;
  status: ScheduleSlotRecord["status"];
  completed_at: Date | null;
  error: FailureDetails | null;
  created_at: Date;
  updated_at: Date;
}

function mapScheduleSlot(row: ScheduleSlotRow): ScheduleSlotRecord {
  return {
    slotKey: row.slot_key,
    scheduledAt: row.scheduled_at.toISOString(),
    status: row.status,
    completedAt: row.completed_at?.toISOString() ?? null,
    error: row.error,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function findScheduleSlot(db: DbQueryable, slotKey: string): Promise<ScheduleSlotRecord | null> {
  const result = await db.query<ScheduleSlotRow>("select * from schedule_slots where slot_key = $1", [slotKey]);
  const row = result.rows[0];
  return row ? mapScheduleSlot(row) : null;
}

export async function findLatestSuccessfulScheduleSlot(db: DbQueryable): Promise<ScheduleSlotRecord | null> {
  const result = await db.query<ScheduleSlotRow>(
    "select * from schedule_slots where status = 'SUCCESS' order by scheduled_at desc limit 1",
  );
  const row = result.rows[0];
  return row ? mapScheduleSlot(row) : null;
}

export async function enqueueScheduledPlaneFetch(
  pool: Pool,
  input: { slot: ScheduleSlotDefinition; jobId: string },
): Promise<boolean> {
  return withTransaction(pool, async (tx) => {
    const inserted = await tx.query<{ slot_key: string }>(
      `insert into schedule_slots (slot_key, scheduled_at, status)
       values ($1, $2, 'PENDING')
       on conflict (slot_key) do nothing
       returning slot_key`,
      [input.slot.slotKey, input.slot.scheduledAt],
    );
    if (!inserted.rows[0]) return false;

    await enqueueJob(tx, {
      id: input.jobId,
      type: "PLANE_FETCH",
      payload: { manual: false, slotKey: input.slot.slotKey },
      priority: 0,
      availableAt: input.slot.scheduledAt,
    });
    return true;
  });
}

export async function markScheduleSlotSuccess(
  db: DbQueryable,
  slotKey: string,
  completedAt: Date,
): Promise<void> {
  await db.query(
    `update schedule_slots
     set status = 'SUCCESS', completed_at = $2, error = null, updated_at = $2
     where slot_key = $1`,
    [slotKey, completedAt],
  );
}

export async function markScheduleSlotFailed(
  db: DbQueryable,
  slotKey: string,
  completedAt: Date,
  error: FailureDetails,
): Promise<void> {
  await db.query(
    `update schedule_slots
     set status = 'FAILED', completed_at = $2, error = $3::jsonb, updated_at = $2
     where slot_key = $1`,
    [slotKey, completedAt, JSON.stringify(error)],
  );
}
