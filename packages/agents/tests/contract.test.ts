import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  AgentAdapter,
  AgentDoctorResult,
  AgentExecutionRequest,
  AgentExecutionResult,
  AgentResumeRequest,
} from '../src/types.ts';

const capabilities = { resume: true, cancellation: true } as const;
const doctor: AgentDoctorResult = {
  ok: true,
  version: 'test/1.0.0',
  authenticated: true,
  capabilities,
  failure: null,
};
const result: AgentExecutionResult = {
  exitCode: 0,
  sessionId: 'session-1',
  version: 'test/1.0.0',
  stdoutPath: '/tmp/stdout.log',
  stderrPath: '/tmp/stderr.log',
  metadataPath: '/tmp/metadata.json',
  capabilities,
  failure: null,
};
const adapter: AgentAdapter = {
  async doctor() { return doctor; },
  async canResume() { return true; },
  async start(_request: AgentExecutionRequest) { return result; },
  async resume(_request: AgentResumeRequest) { return result; },
};

test('AgentAdapter contract exposes doctor, resume capability, start, and resume', async () => {
  assert.equal((await adapter.doctor()).version, 'test/1.0.0');
  assert.equal(await adapter.canResume(), true);
  assert.equal(typeof adapter.start, 'function');
  assert.equal(typeof adapter.resume, 'function');
});
