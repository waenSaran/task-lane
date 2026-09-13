export interface PlaneAssignee {
  id: string;
  displayName: string;
  email: string | null;
}

export interface PlaneWorkItem {
  id: string;
  identifier: string;
  name: string;
  typeName: string;
  stateName: string;
  labels: readonly string[];
  assignees: readonly PlaneAssignee[];
  updatedAt: string;
}

export interface PlaneReader {
  listProjectWorkItems(): Promise<PlaneWorkItem[]>;
}

export type PlaneEligibilityReason =
  | "ELIGIBLE"
  | "NOT_UC"
  | "WRONG_STATE"
  | "MISSING_DEV_REVIEW"
  | "ASSIGNEE_MISMATCH";

export interface PlaneEligibilityResult {
  isUc: boolean;
  eligible: boolean;
  reason: PlaneEligibilityReason;
}
