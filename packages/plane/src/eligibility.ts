import type { PlaneEligibilityResult, PlaneWorkItem } from "./types.js";

function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase();
}

function matchesAssignee(item: PlaneWorkItem, targetAssignee: string): boolean {
  if (item.assignees.length === 0) return true;
  const target = normalizeIdentity(targetAssignee);

  return item.assignees.some((assignee) => {
    if (normalizeIdentity(assignee.displayName) === target) return true;
    if (!assignee.email) return false;
    const localPart = assignee.email.split("@", 1)[0] ?? "";
    return normalizeIdentity(localPart) === target;
  });
}

export function evaluatePlaneEligibility(
  item: PlaneWorkItem,
  targetAssignee: string,
): PlaneEligibilityResult {
  if (item.typeName !== "UC") {
    return { isUc: false, eligible: false, reason: "NOT_UC" };
  }
  if (item.stateName !== "Todo") {
    return { isUc: true, eligible: false, reason: "WRONG_STATE" };
  }
  if (!item.labels.includes("DEV-review")) {
    return { isUc: true, eligible: false, reason: "MISSING_DEV_REVIEW" };
  }
  if (!matchesAssignee(item, targetAssignee)) {
    return { isUc: true, eligible: false, reason: "ASSIGNEE_MISMATCH" };
  }
  return { isUc: true, eligible: true, reason: "ELIGIBLE" };
}
