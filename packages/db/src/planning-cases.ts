import type { PlanningCase } from "@task-lane/domain";
import type { Pool, PoolClient } from "pg";
import { findPlanningCase } from "./records.js";

type DbQueryable = Pool | PoolClient;

export async function findPlanningCaseByPlaneIssueId(
  db: DbQueryable,
  planeIssueId: string,
): Promise<PlanningCase | null> {
  const result = await db.query<{ id: string }>(
    "select id from planning_cases where plane_issue_id = $1",
    [planeIssueId],
  );
  const id = result.rows[0]?.id;
  return id ? findPlanningCase(db, id) : null;
}
