import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const request = (root: string, runId: string, handoffPath?: string) => ({
  runId,
  cwd: process.cwd(),
  instruction: '/plan-feature FAKE-1',
  artifactRoot: root,
  handoffPath,
});

test('FakeAgentAdapter exposes deterministic doctor and resume capability', async () => {
  const mod = await import('../dist/index.js');
  assert.equal(typeof mod.FakeAgentAdapter, 'function', 'FakeAgentAdapter export must exist');
  const adapter = new mod.FakeAgentAdapter({ version: 'fake/9.9.9', canResume: true });
  assert.equal(await adapter.canResume(), true);
  assert.deepEqual(await adapter.doctor(), {
    ok: true,
    version: 'fake/9.9.9',
    authenticated: true,
    capabilities: { resume: true, cancellation: true },
    failure: null,
  });
});

test('FakeAgentAdapter emits READY, BA-review, and PUBLISHED handoff scenarios in order', async () => {
  const mod = await import('../dist/index.js');
  assert.equal(typeof mod.FakeAgentAdapter, 'function', 'FakeAgentAdapter export must exist');
  const root = await mkdtemp(path.join(os.tmpdir(), 'task-lane-agent-'));
  try {
    const adapter = new mod.FakeAgentAdapter({
      scenarios: [
        { status: 'READY_FOR_REVIEW' },
        { status: 'BA_REVIEW_REQUIRED' },
        { status: 'PUBLISHED' },
      ],
    });
    for (const [index, status] of ['READY_FOR_REVIEW', 'BA_REVIEW_REQUIRED', 'PUBLISHED'].entries()) {
      const handoffPath = path.join(root, `handoff-${index}.json`);
      const result = await adapter.start(request(root, `run-${index}`, handoffPath));
      assert.equal(result.failure, null);
      const handoff = JSON.parse(await readFile(handoffPath, 'utf8'));
      assert.equal(handoff.status, status);
      assert.equal(handoff.runId, `run-${index}`);
    }
    assert.equal(adapter.calls.length, 3);
    assert.deepEqual(adapter.calls.map((call: { method: string }) => call.method), ['start', 'start', 'start']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('FakeAgentAdapter emits deterministic technical failure without a handoff', async () => {
  const mod = await import('../dist/index.js');
  assert.equal(typeof mod.FakeAgentAdapter, 'function', 'FakeAgentAdapter export must exist');
  const root = await mkdtemp(path.join(os.tmpdir(), 'task-lane-agent-'));
  try {
    const handoffPath = path.join(root, 'failed-handoff.json');
    const adapter = new mod.FakeAgentAdapter({ scenarios: [{ status: 'FAILED' }] });
    const result = await adapter.start(request(root, 'run-failed', handoffPath));
    assert.equal(result.exitCode, 1);
    assert.equal(result.failure?.code, 'FAKE_AGENT_FAILURE');
    await assert.rejects(readFile(handoffPath, 'utf8'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('FakeAgentAdapter resume returns RESUME_UNSUPPORTED when capability is disabled', async () => {
  const mod = await import('../dist/index.js');
  assert.equal(typeof mod.FakeAgentAdapter, 'function', 'FakeAgentAdapter export must exist');
  const root = await mkdtemp(path.join(os.tmpdir(), 'task-lane-agent-'));
  try {
    const adapter = new mod.FakeAgentAdapter({ canResume: false });
    const result = await adapter.resume({ ...request(root, 'run-resume'), sessionId: 'session-1' });
    assert.equal(result.failure?.code, 'RESUME_UNSUPPORTED');
    assert.equal(adapter.calls[0]?.method, 'resume');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('FakeAgentAdapter resume preserves the requested session when resume is supported', async () => {
  const mod = await import('../dist/index.js');
  const root = await mkdtemp(path.join(os.tmpdir(), 'task-lane-agent-'));
  try {
    const adapter = new mod.FakeAgentAdapter({ canResume: true, scenarios: [{ status: 'PUBLISHED' }] });
    const result = await adapter.resume({ ...request(root, 'run-resume-ok'), sessionId: 'session-existing' });
    assert.equal(result.sessionId, 'session-existing');
    assert.equal(result.failure, null);
    assert.equal(adapter.calls[0]?.method, 'resume');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('FakeAgentAdapter never persists the instruction text to stdout or stderr artifacts', async () => {
  const mod = await import('../dist/index.js');
  const root = await mkdtemp(path.join(os.tmpdir(), 'task-lane-agent-'));
  try {
    const adapter = new mod.FakeAgentAdapter({ scenarios: [{ status: 'READY_FOR_REVIEW' }] });
    const result = await adapter.start({
      ...request(root, 'run-secret'),
      instruction: '/plan-feature FAKE-1 --token super-secret-instruction',
    });
    const stdout = await readFile(result.stdoutPath, 'utf8');
    const stderr = await readFile(result.stderrPath, 'utf8');
    assert.equal(stdout.includes('super-secret-instruction'), false);
    assert.equal(stderr.includes('super-secret-instruction'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
