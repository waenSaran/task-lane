import type { PlaneReader, PlaneWorkItem } from "./types.js";

export interface PlaneReadClientConfig {
  baseUrl: string;
  apiKey: string;
  workspaceSlug: string;
  projectId: string;
}

interface PlaneExpandedName {
  id?: string;
  name?: string;
  identifier?: string;
}

interface PlaneExpandedAssignee {
  id?: string;
  display_name?: string;
  email?: string | null;
}

interface PlaneApiWorkItem {
  id?: string;
  sequence_id?: number;
  name?: string;
  updated_at?: string;
  type?: PlaneExpandedName | null;
  state?: PlaneExpandedName | null;
  labels?: PlaneExpandedName[] | null;
  assignees?: PlaneExpandedAssignee[] | null;
  project?: PlaneExpandedName | null;
}

interface PlaneCursorPage {
  next_page_results?: boolean;
  next_cursor?: string | null;
  results?: PlaneApiWorkItem[];
}

export class PlaneHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Plane request failed with status ${status}`);
    this.name = "PlaneHttpError";
    this.status = status;
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Plane response missing ${field}`);
  }
  return value;
}

function normalizeWorkItem(raw: PlaneApiWorkItem): PlaneWorkItem {
  const projectIdentifier = requiredString(raw.project?.identifier, "project.identifier");
  if (typeof raw.sequence_id !== "number") {
    throw new Error("Plane response missing sequence_id");
  }

  return {
    id: requiredString(raw.id, "id"),
    identifier: `${projectIdentifier}-${raw.sequence_id}`,
    name: requiredString(raw.name, "name"),
    typeName: raw.type?.name ?? "",
    stateName: raw.state?.name ?? "",
    labels: (raw.labels ?? []).flatMap((label) => (label.name ? [label.name] : [])),
    assignees: (raw.assignees ?? []).map((assignee) => ({
      id: requiredString(assignee.id, "assignee.id"),
      displayName: assignee.display_name ?? "",
      email: assignee.email ?? null,
    })),
    updatedAt: requiredString(raw.updated_at, "updated_at"),
  };
}

function endpoint(config: PlaneReadClientConfig): URL {
  const base = config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`;
  return new URL(
    `api/v1/workspaces/${encodeURIComponent(config.workspaceSlug)}/projects/${encodeURIComponent(config.projectId)}/work-items/`,
    base,
  );
}

export function createPlaneReadClient(
  config: PlaneReadClientConfig,
  fetchImpl: typeof fetch = fetch,
): PlaneReader {
  return {
    async listProjectWorkItems(): Promise<PlaneWorkItem[]> {
      const items: PlaneWorkItem[] = [];
      let cursor: string | null = null;

      do {
        const url = endpoint(config);
        url.searchParams.set("per_page", "100");
        url.searchParams.set("expand", "type,labels,assignees,state,project");
        if (cursor) url.searchParams.set("cursor", cursor);

        const response = await fetchImpl(url, {
          method: "GET",
          headers: { "X-API-Key": config.apiKey },
        });
        if (!response.ok) throw new PlaneHttpError(response.status);

        const page = (await response.json()) as PlaneCursorPage;
        for (const raw of page.results ?? []) items.push(normalizeWorkItem(raw));
        cursor = page.next_page_results ? (page.next_cursor ?? null) : null;
      } while (cursor);

      return items;
    },
  };
}
