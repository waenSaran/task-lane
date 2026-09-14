import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('process runner persists timestamped redacted stdout and stderr', async () => {
  const mod = await import('../dist/index.js');
  assert.equal(typeof mod.runAgentProcess, 'function', 'runAgentProcess export must exist');
  const root = await mkdtemp(path.join(os.tmpdir(), 'task-lane-agent-'));
  try {
    const result = await mod.runAgentProcess({
      command: process.execPath,
      args: ['-e', "console.log('hello TOKEN=top-secret'); console.error('oops Authorization: Bearer bearer-secret')"],
      cwd: process.cwd(),
      artifactRoot: root,
      runId: 'run-1',
      now: () => new Date('2026-09-14T01:00:00.000Z'),
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.failure, null);
    const stdout = await readFile(result.stdoutPath, 'utf8');
    const stderr = await readFile(result.stderrPath, 'utf8');
    assert.match(stdout, /^\[2026-09-14T01:00:00\.000Z\] hello TOKEN=\[REDACTED\]/m);
    assert.match(stderr, /^\[2026-09-14T01:00:00\.000Z\] oops Authorization: \[REDACTED\]/m);
    assert.equal(stdout.includes('top-secret'), false);
    assert.equal(stderr.includes('bearer-secret'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('process runner maps spawn failure without creating an unhandled rejection', async () => {
  const mod = await import('../dist/index.js');
  assert.equal(typeof mod.runAgentProcess, 'function', 'runAgentProcess export must exist');
  const root = await mkdtemp(path.join(os.tmpdir(), 'task-lane-agent-'));
  try {
    const result = await mod.runAgentProcess({
      command: '__task_lane_missing_binary__',
      cwd: process.cwd(),
      artifactRoot: root,
      runId: 'run-spawn-fail',
    });
    assert.equal(result.exitCode, null);
    assert.equal(result.failure?.code, 'SPAWN_FAILED');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('process runner maps AbortSignal cancellation distinctly', async () => {
  const mod = await import('../dist/index.js');
  assert.equal(typeof mod.runAgentProcess, 'function', 'runAgentProcess export must exist');
  const root = await mkdtemp(path.join(os.tmpdir(), 'task-lane-agent-'));
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 30);
  try {
    const result = await mod.runAgentProcess({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: process.cwd(),
      artifactRoot: root,
      runId: 'run-cancel',
      signal: controller.signal,
    });
    assert.equal(result.failure?.code, 'CANCELLED');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('process runner streams redacted output before the process exits', async () => {
  const mod = await import('../dist/index.js');
  const root = await mkdtemp(path.join(os.tmpdir(), 'task-lane-agent-'));
  try {
    const runId = 'run-stream';
    const stdoutPath = path.join(root, runId, 'stdout.log');
    const running = mod.runAgentProcess({
      command: process.execPath,
      args: ['-e', "console.log('first TOKEN=stream-secret'); setTimeout(() => process.exit(0), 250)"],
      cwd: process.cwd(),
      artifactRoot: root,
      runId,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const whileRunning = await readFile(stdoutPath, 'utf8');
    assert.match(whileRunning, /first TOKEN=\[REDACTED\]/);
    assert.equal(whileRunning.includes('stream-secret'), false);
    await running;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('process runner preserves machine-readable lines split across output chunks', async () => {
  const mod = await import('../dist/index.js');
  const root = await mkdtemp(path.join(os.tmpdir(), 'task-lane-agent-'));
  try {
    const result = await mod.runAgentProcess({
      command: process.execPath,
      args: ['-e', "process.stdout.write('{\\\"type\\\":\\\"thread.'); setTimeout(() => process.stdout.write('started\\\",\\\"thread_id\\\":\\\"session-1\\\"}\\n'), 20)"],
      cwd: process.cwd(),
      artifactRoot: root,
      runId: 'run-split-json',
    });
    const stdout = await readFile(result.stdoutPath, 'utf8');
    assert.match(stdout, /\{"type":"thread\.started","thread_id":"session-1"\}/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('process runner treats provided environment as additions and redacts sensitive values automatically', async () => {
  const mod = await import('../dist/index.js');
  const root = await mkdtemp(path.join(os.tmpdir(), 'task-lane-agent-'));
  const previous = process.env.TASK_LANE_PARENT_VALUE;
  process.env.TASK_LANE_PARENT_VALUE = 'parent-visible';
  try {
    const result = await mod.runAgentProcess({
      command: process.execPath,
      args: ['-e', "console.log(process.env.TASK_LANE_PARENT_VALUE); console.log(process.env.AGENT_TOKEN)"],
      cwd: process.cwd(),
      artifactRoot: root,
      runId: 'run-env',
      env: { AGENT_TOKEN: 'env-secret' },
    });
    const stdout = await readFile(result.stdoutPath, 'utf8');
    assert.match(stdout, /parent-visible/);
    assert.equal(stdout.includes('env-secret'), false);
    assert.match(stdout, /\[REDACTED\]/);
  } finally {
    if (previous === undefined) delete process.env.TASK_LANE_PARENT_VALUE;
    else process.env.TASK_LANE_PARENT_VALUE = previous;
    await rm(root, { recursive: true, force: true });
  }
});
