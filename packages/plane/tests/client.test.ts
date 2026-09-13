import assert from "node:assert/strict";
import test from "node:test";
import { PlaneHttpError, createPlaneReadClient } from "../src/client.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("read client paginates current work-items API using GET and normalizes expanded fields", async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const pages = [
    {
      next_page_results: true,
      next_cursor: "100:2:0",
      results: [
        {
          id: "plane-1",
          sequence_id: 1841,
          name: "Example UC",
          updated_at: "2026-09-13T16:20:00.000Z",
          type: { id: "type-uc", name: "UC" },
          state: { id: "state-todo", name: "Todo" },
          labels: [{ id: "label-dev", name: "DEV-review" }],
          assignees: [{ id: "u1", display_name: "saranya.h", email: "saranya.h@example.com" }],
          project: { id: "project-1", identifier: "DOAE" },
        },
      ],
    },
    {
      next_page_results: false,
      next_cursor: null,
      results: [
        {
          id: "plane-2",
          sequence_id: 1842,
          name: "Second UC",
          updated_at: "2026-09-13T16:21:00.000Z",
          type: { id: "type-uc", name: "UC" },
          state: { id: "state-todo", name: "Todo" },
          labels: [],
          assignees: [],
          project: { id: "project-1", identifier: "DOAE" },
        },
      ],
    },
  ];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    const page = pages.shift();
    if (!page) throw new Error("unexpected fetch");
    return jsonResponse(page);
  };

  const client = createPlaneReadClient(
    {
      baseUrl: "https://plane.example.com/",
      apiKey: "secret-key",
      workspaceSlug: "doae",
      projectId: "project-1",
    },
    fetchImpl,
  );

  const result = await client.listProjectWorkItems();

  assert.equal(result.length, 2);
  assert.equal(result[0]?.identifier, "DOAE-1841");
  assert.equal(result[0]?.typeName, "UC");
  assert.deepEqual(result[0]?.labels, ["DEV-review"]);
  assert.equal(result[0]?.assignees[0]?.displayName, "saranya.h");
  assert.equal(calls.length, 2);
  for (const call of calls) {
    const url = new URL(call.url);
    assert.equal(call.init?.method, "GET");
    assert.equal(url.pathname, "/api/v1/workspaces/doae/projects/project-1/work-items/");
    assert.equal(url.searchParams.get("per_page"), "100");
    assert.equal(url.searchParams.get("expand"), "type,labels,assignees,state,project");
    assert.equal(new Headers(call.init?.headers).get("X-API-Key"), "secret-key");
  }
  assert.equal(new URL(calls[1]!.url).searchParams.get("cursor"), "100:2:0");
  assert.equal("createWorkItem" in client, false);
  assert.equal("updateWorkItem" in client, false);
  assert.equal("deleteWorkItem" in client, false);
});

test("Plane HTTP errors never expose API key", async () => {
  const client = createPlaneReadClient(
    {
      baseUrl: "https://plane.example.com",
      apiKey: "super-secret-key",
      workspaceSlug: "doae",
      projectId: "project-1",
    },
    async () => jsonResponse({ detail: "nope" }, 401),
  );

  await assert.rejects(
    client.listProjectWorkItems(),
    (error: unknown) =>
      error instanceof PlaneHttpError &&
      error.status === 401 &&
      !error.message.includes("super-secret-key"),
  );
});
