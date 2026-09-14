import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('agent metadata is persisted under deterministic run-scoped paths', async () => {
  const mod = await import('../dist/index.js');
  assert.equal(typeof mod.writeAgentMetadata, 'function', 'writeAgentMetadata export must exist');
  const root = await mkdtemp(path.join(os.tmpdir(), 'task-lane-agent-'));
  try {
    const metadataPath = await mod.writeAgentMetadata(root, 'run-meta', {
      sessionId: 'session-1',
      version: 'fake/1.0.0',
      capabilities: { resume: true, cancellation: true },
    });
    assert.equal(metadataPath, path.join(root, 'run-meta', 'metadata.json'));
    const saved = JSON.parse(await readFile(metadataPath, 'utf8'));
    assert.deepEqual(saved, {
      sessionId: 'session-1',
      version: 'fake/1.0.0',
      capabilities: { resume: true, cancellation: true },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
