import {
  findPlanningCaseByPlaneIssueId,
  savePlanningCase,
  withTransaction,
} from "@task-lane/db";
import {
  canTransitionPlanningCase,
  type PlanningCase,
  type PlanningCaseStatus,
} from "@task-lane/domain";
import type { Pool } from "pg";
import { evaluatePlaneEligibility } from "./eligibility.js";
import type { PlaneReader, PlaneWorkItem } from "./types.js";

export interface PlaneSyncInput {
  reader: PlaneReader;
  pool: Pool;
  now: Date;
  createId: () => string;
  targetAssignee: string;
}

export interface PlaneSyncSummary {
  fetched: number;
  created: number;
  updated: number;
  ignoredNonUc: number;
}

function updatedCaseBase(existing: PlanningCase, item: PlaneWorkItem, now: string): PlanningCase {
  return {
    ...existing,
    planeIdentifier: item.identifier,
    title: item.name,
    updatedAt: now,
  };
}

function restoreStatus(existing: PlanningCase): PlanningCaseStatus | null {
  const candidate = existing.previousStatus ?? "WAITING_REPO";
  if (canTransitionPlanningCase("NO_LONGER_ELIGIBLE", candidate)) return candidate;
  if (canTransitionPlanningCase("NO_LONGER_ELIGIBLE", "WAITING_REPO")) return "WAITING_REPO";
  return null;
}

export async function syncPlaneEligibility(input: PlaneSyncInput): Promise<PlaneSyncSummary> {
  const items = await input.reader.listProjectWorkItems();
  const now = input.now.toISOString();
  const summary: PlaneSyncSummary = {
    fetched: items.length,
    created: 0,
    updated: 0,
    ignoredNonUc: 0,
  };

  await withTransaction(input.pool, async (tx) => {
    for (const item of items) {
      const eligibility = evaluatePlaneEligibility(item, input.targetAssignee);
      const existing = await findPlanningCaseByPlaneIssueId(tx, item.id);

      if (!existing) {
        if (!eligibility.isUc) {
          summary.ignoredNonUc += 1;
          continue;
        }
        if (!eligibility.eligible) continue;

        await savePlanningCase(tx, {
          id: input.createId(),
          planeIssueId: item.id,
          planeIdentifier: item.identifier,
          title: item.name,
          currentStatus: "WAITING_REPO",
          previousStatus: null,
          eligibility: "ELIGIBLE",
          primaryRepoId: null,
          preferredAgent: null,
          lastPublishedRunId: null,
          createdAt: now,
          updatedAt: now,
        });
        summary.created += 1;
        continue;
      }

      let next = updatedCaseBase(existing, item, now);

      if (eligibility.eligible) {
        next = { ...next, eligibility: "ELIGIBLE" };
        if (existing.currentStatus === "NO_LONGER_ELIGIBLE") {
          const restored = restoreStatus(existing);
          if (restored) {
            next = {
              ...next,
              currentStatus: restored,
              previousStatus: "NO_LONGER_ELIGIBLE",
            };
          }
        }
      } else {
        next = { ...next, eligibility: "INELIGIBLE" };
        if (
          existing.currentStatus !== "NO_LONGER_ELIGIBLE" &&
          canTransitionPlanningCase(existing.currentStatus, "NO_LONGER_ELIGIBLE")
        ) {
          next = {
            ...next,
            currentStatus: "NO_LONGER_ELIGIBLE",
            previousStatus: existing.currentStatus,
          };
        }
      }

      await savePlanningCase(tx, next);
      summary.updated += 1;
    }
  });

  return summary;
}
