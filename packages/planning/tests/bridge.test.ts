import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FakeAgentAdapter, type AgentExecutionRequest, type AgentExecutionResult } from '@task-lane/agents';
import {
  PlanFeatureHandoffError,
  TaskLanePlanFeatureRunner,
  hashRequirementSources,
  readPlanFeatureHandoff,
  writePlanFeatureHandoff,
} from '../dist/index.js';

const runId = 'run_bridge_123';
const planeId = 'DOAE-1841';
const draftBytes = '# bridge draft\n';
const draftSha256 = createHash('sha256').update(draftBytes).digest('hex');
const sources = [{ planeId, hash: 'a'.repeat(64) }];
const requirements = { aggregateHash: hashRequirementSources(sources), sources };

function successfulResult(root: string): AgentExecutionResult {
  return {
    exitCode: 0,
    sessionId: 'successful-session',
    version: 'test-agent/1.0.0',
    stdoutPath: path.join(root, 'stdout.log'),
    stderrPath: path.join(root, 'stderr.log'),
    metadataPath: path.join(root, 'metadata.json'),
    capabilities: { resume: true, cancellation: true },
    failure: null,
  };
}

function successfulAdapter(write?: (request: AgentExecutionRequest) => Promise<void>) {
  return {
    start: async (request: AgentExecutionRequest) => {
      await write?.(request);
      return successfulResult(request.artifactRoot);
    },
    resume: async (request: AgentExecutionRequest) => {
      await write?.(request);
      return successfulResult(request.artifactRoot);
    },
  };
}

async function fixture<T>(callback: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'task-lane-bridge-'));
  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('writer atomically writes a strict READY handoff using exact draft bytes', async () => {
  await fixture(async (root) => {
    const draftPath = path.join(root, 'draft.md');
    const handoffPath = path.join(root, 'handoff.json');
    await writeFile(draftPath, draftBytes, 'utf8');

    const result = await writePlanFeatureHandoff({
      destinationPath: handoffPath,
      runId,
      planeId,
      status: 'READY_FOR_REVIEW',
      draftPath,
      requirements,
    });

    assert.equal(result.status, 'READY_FOR_REVIEW');
    assert.equal(result.draft.sha256, draftSha256);
    assert.deepEqual(await readPlanFeatureHandoff(handoffPath, runId), result);
    assert.deepEqual((await readdir(root)).sort(), ['draft.md', 'handoff.json']);
  });
});

test('writer emits every supported terminal status and rejects invalid evidence', async () => {
  await fixture(async (root) => {
    const handoffPath = path.join(root, 'handoff.json');
    const statuses = [
      { status: 'BA_REVIEW_REQUIRED' as const, requirements },
      { status: 'PUBLISHED' as const, draftSha256 },
      { status: 'STALE_DRAFT' as const, expectedSha256: 'a'.repeat(64), actualSha256: 'b'.repeat(64) },
    ];

    for (const input of statuses) {
      const result = await writePlanFeatureHandoff({ destinationPath: handoffPath, runId, planeId, ...input });
      assert.equal(result.status, input.status);
      assert.deepEqual(await readPlanFeatureHandoff(handoffPath, runId), result);
    }

    await assert.rejects(
      writePlanFeatureHandoff({
        destinationPath: handoffPath,
        runId,
        planeId,
        status: 'PUBLISHED',
        draftSha256: 'not-a-sha',
      }),
      (error: unknown) => error instanceof PlanFeatureHandoffError && error.code === 'INVALID_FIELD',
    );
  });
});

test('bridge wraps AgentAdapter with the unchanged skill command and runtime context', async () => {
  await fixture(async (root) => {
    const adapter = new FakeAgentAdapter({ scenarios: [{ status: 'PUBLISHED', handoff: { draft: { sha256: draftSha256 } } }] });
    const handoffPath = path.join(root, 'handoff.json');
    const runner = new TaskLanePlanFeatureRunner(adapter, {
      runId,
      planeId: 'FAKE-1',
      handoffPath,
      handoffWriterPath: '/task-lane/dist/handoff-writer.js',
    });

    const result = await runner.start({
      runId,
      cwd: root,
      instruction: 'ignored by the bridge',
      artifactRoot: root,
    });

    assert.equal(result.failure, null);
    assert.equal(adapter.calls[0]?.request.instruction.split('\n')[0], '/plan-feature FAKE-1');
    assert.match(adapter.calls[0]?.request.instruction ?? '', /do not modify.*skill/i);
    assert.match(adapter.calls[0]?.request.instruction ?? '', /exactly one.*terminal handoff/i);
    assert.equal(adapter.calls[0]?.request.env?.TASK_LANE_RUN_ID, runId);
    assert.equal(adapter.calls[0]?.request.env?.TASK_LANE_PLANE_ID, 'FAKE-1');
    assert.equal(adapter.calls[0]?.request.env?.TASK_LANE_HANDOFF_PATH, handoffPath);
    assert.equal((await readPlanFeatureHandoff(handoffPath, runId)).status, 'PUBLISHED');
    await access(handoffPath);
    assert.equal((await readFile(adapter.calls[0]!.request.handoffPath!, 'utf8')).includes('stdout'), false);
  });
});

test('provider-compatible AgentAdapter fixtures receive the native slash invocation unchanged', async () => {
  await fixture(async (root) => {
    let receivedInstruction = '';
    const adapter = successfulAdapter(async (request) => {
      receivedInstruction = request.instruction;
      await writePlanFeatureHandoff({
        destinationPath: request.handoffPath!,
        runId,
        planeId,
        status: 'PUBLISHED',
        draftSha256,
      });
    });
    const runner = new TaskLanePlanFeatureRunner(adapter, {
      runId,
      planeId,
      handoffPath: path.join(root, 'provider-handoff.json'),
      handoffWriterPath: '/task-lane/dist/handoff-writer.js',
    });

    const result = await runner.start({ runId, cwd: root, instruction: 'provider context', artifactRoot: root });

    assert.equal(result.failure, null);
    assert.equal(receivedInstruction.split('\n')[0], `/plan-feature ${planeId}`);
    assert.equal(receivedInstruction.startsWith('Run the existing'), false);
  });
});

test('bridge fails technically when a successful run has no fresh valid handoff', async () => {
  await fixture(async (root) => {
    const handoffPath = path.join(root, 'handoff.json');
    await writeFile(handoffPath, JSON.stringify({ status: 'PUBLISHED' }), 'utf8');
    const runner = new TaskLanePlanFeatureRunner(successfulAdapter(), {
      runId,
      planeId,
      handoffPath,
      handoffWriterPath: '/task-lane/dist/handoff-writer.js',
    });

    const missing = await runner.start({ runId, cwd: root, instruction: '', artifactRoot: root });
    assert.equal(missing.failure?.code, 'PLAN_FEATURE_HANDOFF_INVALID');
    await assert.rejects(readFile(handoffPath));

    const corrupt = new TaskLanePlanFeatureRunner(successfulAdapter(async (request) => {
      await writeFile(request.handoffPath!, 'not-json', 'utf8');
    }), {
      runId,
      planeId,
      handoffPath,
      handoffWriterPath: '/task-lane/dist/handoff-writer.js',
    });
    const corruptResult = await corrupt.start({ runId, cwd: root, instruction: '', artifactRoot: root });
    assert.equal(corruptResult.failure?.code, 'PLAN_FEATURE_HANDOFF_INVALID');
  });
});
