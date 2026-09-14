import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const request = (artifactRoot: string, runId: string, cwd = process.cwd()) => ({
  runId,
  cwd,
  instruction: '/plan-feature DOAE-1234',
  artifactRoot,
});

async function fixture(root: string, body: string): Promise<{ command: string; calls: string[] }> {
  const command = path.join(root, 'fake-agent');
  const calls = path.join(root, 'calls.jsonl');
  await writeFile(command, `#!/usr/bin/env node\n${body}`, 'utf8');
  await chmod(command, 0o755);
  return { command, calls: [calls] };
}

const capture = `
const fs = require('node:fs');
const path = require('node:path');
fs.appendFileSync(process.env.CAPTURE_PATH, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + '\\n');
if (process.env.REQUIRE_CANONICAL_SKILL) {
  const skillLink = path.join(process.env.HOME, '.agents', 'skills', 'plan-feature');
  if (!fs.lstatSync(skillLink).isSymbolicLink() || fs.readFileSync(path.join(skillLink, 'SKILL.md'), 'utf8') !== process.env.CANONICAL_SKILL_CONTENT) process.exit(42);
}
`;

test('CodexAdapter builds safe start and native resume commands and captures thread ids', async () => {
  const mod = await import('../dist/index.js');
  const root = await mkdtemp(path.join(os.tmpdir(), 'task-lane-codex-'));
  try {
    const repo = path.join(root, 'repo');
    await mkdir(path.join(repo, '.claude', 'skills', 'plan-feature'), { recursive: true });
    await writeFile(path.join(repo, '.claude', 'skills', 'plan-feature', 'SKILL.md'), 'canonical-plan-feature-skill', 'utf8');
    const fake = await fixture(root, `${capture}
if (process.argv.includes('--version')) console.log('codex-cli 0.154.0');
else if (process.argv.includes('doctor')) console.log(JSON.stringify({ checks: { 'auth.credentials': { status: 'ok' } } }));
else { console.log(process.env.CODEX_ACCESS_TOKEN ?? ''); console.log(JSON.stringify({ type: 'thread.started', thread_id: process.argv.includes('resume') ? 'resumed' : 'started' })); }
`);
    const adapter = new mod.CodexAdapter({ command: fake.command, environment: { CAPTURE_PATH: fake.calls[0], REQUIRE_CANONICAL_SKILL: '1', CANONICAL_SKILL_CONTENT: 'canonical-plan-feature-skill' } });
    const env = { CODEX_ACCESS_TOKEN: 'super-secret' };
    const start = await adapter.start({ ...request(root, 'start', repo), env });
    const resumed = await adapter.resume({ ...request(root, 'resume', repo), sessionId: 'started', env });
    const calls = (await readFile(fake.calls[0]!, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));

    assert.equal(start.version, '0.154.0');
    assert.equal(start.sessionId, 'started');
    assert.equal(resumed.sessionId, 'resumed');
    assert.deepEqual(calls[1].args, ['exec', '--json', '--cd', repo, '--sandbox', 'workspace-write', '$plan-feature DOAE-1234']);
    assert.deepEqual(calls[3].args, ['exec', 'resume', '--json', '--cd', repo, '--sandbox', 'workspace-write', 'started', '$plan-feature DOAE-1234']);
    await assert.rejects(lstat(path.join(repo, '.agents')));
    assert.equal((await readFile(start.stdoutPath, 'utf8')).includes('super-secret'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('adapter maps authenticated CLI failures without exposing stderr secrets', async () => {
  const mod = await import('../dist/index.js');
  const root = await mkdtemp(path.join(os.tmpdir(), 'task-lane-failure-'));
  try {
    const fake = await fixture(root, `${capture}
if (process.argv.includes('--version')) console.log('grok 1.0.30');
else { console.error('authentication failed XAI_API_KEY=' + process.env.XAI_API_KEY); process.exit(1); }
`);
    const result = await new mod.GrokAdapter({ command: fake.command, environment: { CAPTURE_PATH: fake.calls[0] } }).start({
      ...request(root, 'failed'),
      env: { XAI_API_KEY: 'xai-secret' },
    });
    assert.equal(result.failure?.code, 'AUTHENTICATION_UNAVAILABLE');
    assert.equal((await readFile(result.stderrPath, 'utf8')).includes('xai-secret'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CodexAdapter refuses canonical plan-feature execution when the repository skill is absent', async () => {
  const mod = await import('../dist/index.js');
  const root = await mkdtemp(path.join(os.tmpdir(), 'task-lane-codex-missing-skill-'));
  try {
    const fake = await fixture(root, `${capture} process.exit(0);`);
    const result = await new mod.CodexAdapter({ command: fake.command }).start(request(root, 'missing-skill'));
    assert.equal(result.failure?.code, 'CANONICAL_SKILL_MISSING');
    await assert.rejects(readFile(fake.calls[0]!, 'utf8'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('adapters translate managed repository paths to the read-only agent view', async () => {
  const mod = await import('../dist/index.js');
  const root = await mkdtemp(path.join(os.tmpdir(), 'task-lane-agent-view-'));
  try {
    const managedRoot = path.join(root, 'managed-repos');
    const agentRoot = path.join(root, 'agent-repos');
    const managedRepo = path.join(managedRoot, 'repo');
    const agentRepo = path.join(agentRoot, 'repo');
    await mkdir(managedRepo, { recursive: true });
    await mkdir(path.join(agentRepo, '.claude', 'skills', 'plan-feature'), { recursive: true });
    await writeFile(path.join(agentRepo, '.claude', 'skills', 'plan-feature', 'SKILL.md'), 'canonical-plan-feature-skill', 'utf8');
    const fake = await fixture(root, `${capture}
if (process.argv.includes('--version')) console.log('codex-cli 0.154.0');
else console.log(JSON.stringify({ type: 'thread.started', thread_id: 'started' }));
`);
    const adapter = new mod.CodexAdapter({
      command: fake.command,
      repositoryRoot: managedRoot,
      agentSourceRoot: agentRoot,
      environment: { CAPTURE_PATH: fake.calls[0], REQUIRE_CANONICAL_SKILL: '1', CANONICAL_SKILL_CONTENT: 'canonical-plan-feature-skill' },
    });
    const result = await adapter.start(request(root, 'mapped', managedRepo));
    const calls = (await readFile(fake.calls[0]!, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));

    assert.equal(result.sessionId, 'started');
    assert.equal(calls[1].cwd, await realpath(agentRepo));
    assert.deepEqual(calls[1].args, ['exec', '--json', '--cd', agentRepo, '--sandbox', 'workspace-write', '$plan-feature DOAE-1234']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('GrokAdapter builds headless commands, captures JSON session ids, and reports auth', async () => {
  const mod = await import('../dist/index.js');
  const root = await mkdtemp(path.join(os.tmpdir(), 'task-lane-grok-'));
  try {
    const fake = await fixture(root, `${capture}
if (process.argv.includes('--version')) console.log('grok 1.0.30');
else if (process.argv.includes('inspect')) console.log(JSON.stringify({ grokVersion: '1.0.30' }));
else console.log(JSON.stringify({ text: 'ok', sessionId: process.argv.includes('--resume') ? 'resumed' : 'started' }));
`);
    const home = path.join(root, 'home');
    await mkdir(path.join(home, '.grok'), { recursive: true });
    await writeFile(path.join(home, '.grok', 'auth.json'), '{"https://auth.x.ai":{"key":"secret"}}');
    const adapter = new mod.GrokAdapter({ command: fake.command, homeDir: home, environment: { CAPTURE_PATH: fake.calls[0] } });
    const env = {};
    const start = await adapter.start({ ...request(root, 'start'), env });
    const resumed = await adapter.resume({ ...request(root, 'resume'), sessionId: 'started', env });
    const doctor = await adapter.doctor();
    const calls = (await readFile(fake.calls[0]!, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));

    assert.equal(start.version, '1.0.30');
    assert.equal(start.sessionId, 'started');
    assert.equal(resumed.sessionId, 'resumed');
    assert.equal(doctor.authenticated, true);
    assert.deepEqual(calls[1].args, ['--no-auto-update', '--single', '/plan-feature DOAE-1234', '--cwd', process.cwd(), '--output-format', 'json', '--sandbox', 'workspace-write', '--always-approve']);
    assert.deepEqual(calls[3].args, ['--no-auto-update', '--single', '/plan-feature DOAE-1234', '--resume', 'started', '--cwd', process.cwd(), '--output-format', 'json', '--sandbox', 'workspace-write', '--always-approve']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('doctor reports missing, unsupported, and unauthenticated installations', async () => {
  const mod = await import('../dist/index.js');
  const root = await mkdtemp(path.join(os.tmpdir(), 'task-lane-doctor-'));
  try {
    const missing = new mod.CodexAdapter({ command: path.join(root, 'missing') });
    assert.equal((await missing.doctor()).failure?.code, 'BINARY_MISSING');

    const unsupported = await fixture(root, `${capture}
if (process.argv.includes('--version')) console.log('codex-cli 0.153.0');
else console.log(JSON.stringify({ checks: { 'auth.credentials': { status: 'ok' } } }));
`);
    assert.equal((await new mod.CodexAdapter({ command: unsupported.command, environment: { CAPTURE_PATH: unsupported.calls[0] } }).doctor()).failure?.code, 'UNSUPPORTED_VERSION');

    const unauthenticated = await fixture(root, `${capture}
if (process.argv.includes('--version')) console.log('codex-cli 0.154.0');
else console.log(JSON.stringify({ checks: { 'auth.credentials': { status: 'missing' } } }));
`);
    const doctor = await new mod.CodexAdapter({ command: unauthenticated.command, environment: { CAPTURE_PATH: unauthenticated.calls[0] } }).doctor();
    assert.equal(doctor.authenticated, false);
    assert.equal(doctor.failure?.code, 'AUTHENTICATION_UNAVAILABLE');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('resume capability can be disabled without falling back to a fresh session', async () => {
  const mod = await import('../dist/index.js');
  const adapter = new mod.GrokAdapter({ resumeSupported: false });
  assert.equal(await adapter.canResume(), false);
  const result = await adapter.resume({ ...request(os.tmpdir(), 'unsupported-resume'), sessionId: 'old-session' });
  assert.equal(result.failure?.code, 'RESUME_UNSUPPORTED');
});

test('adapters reject resume without a session instead of starting a fresh run', async () => {
  const mod = await import('../dist/index.js');
  const adapter = new mod.GrokAdapter({ command: '__missing_grok_for_resume_test__' });
  const result = await adapter.resume({ ...request(os.tmpdir(), 'invalid-resume'), sessionId: '  ' });
  assert.equal(result.failure?.code, 'SESSION_MISSING');
});

test('agent selection follows task override, repository choice, then global default', async () => {
  const mod = await import('../dist/index.js');
  assert.equal(mod.selectAgent({ taskOverride: 'GROK', repoLastUsed: 'CODEX', globalDefault: 'CODEX' }), 'GROK');
  assert.equal(mod.selectAgent({ repoLastUsed: 'GROK', globalDefault: 'CODEX' }), 'GROK');
  assert.equal(mod.selectAgent({ globalDefault: 'GROK' }), 'GROK');
});
