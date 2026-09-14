import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  PlanFeatureHandoffError,
  hashRequirementSources,
  parsePlanFeatureHandoff,
  readPlanFeatureHandoff,
} from '../dist/index.js';

const runId = 'run_123';
const planeId = 'DOAE-1841';
const draftBytes = '# canonical plan\n';
const draftSha256 = createHash('sha256').update(draftBytes).digest('hex');
const sources = [
  { planeId: 'DOAE-1842', hash: 'b'.repeat(64) },
  { planeId, hash: 'a'.repeat(64) },
] as const;
const requirements = {
  aggregateHash: '4ddbd86794e03cfa1c641d517dc732ef88ff30de8fd65c1db2d6d8b6916db364',
  sources,
};

function ready(pathname: string): Record<string, unknown> {
  return {
    contractVersion: '1.0',
    runId,
    status: 'READY_FOR_REVIEW',
    planeId,
    draft: { path: pathname, sha256: draftSha256 },
    requirements,
    taskTreeReady: true,
  };
}

async function withFixture<T>(callback: (root: string, draftPath: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'task-lane-handoff-'));
  const draftPath = path.join(root, 'draft.md');
  await writeFile(draftPath, draftBytes, 'utf8');
  try {
    return await callback(root, draftPath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('accepts a complete READY_FOR_REVIEW handoff and verifies the exact draft bytes', async () => {
  await withFixture(async (root, draftPath) => {
    const handoffPath = path.join(root, 'handoff.json');
    await writeFile(handoffPath, JSON.stringify(ready(draftPath)), 'utf8');
    const result = await readPlanFeatureHandoff(
      handoffPath,
      runId,
    );

    assert.equal(result.status, 'READY_FOR_REVIEW');
    assert.equal(result.draft.sha256, draftSha256);
    assert.deepEqual(result.requirements.sources, sources);
  });
});

test('accepts BA_REVIEW_REQUIRED with its requirement fingerprint', () => {
  const result = parsePlanFeatureHandoff({
    contractVersion: '1.0',
    runId,
    status: 'BA_REVIEW_REQUIRED',
    planeId,
    requirements,
  }, runId);

  assert.equal(result.status, 'BA_REVIEW_REQUIRED');
});

test('canonicalizes requirement fingerprints independently of source input order', () => {
  assert.equal(hashRequirementSources(sources), requirements.aggregateHash);
  assert.equal(hashRequirementSources([...sources].reverse()), requirements.aggregateHash);
});

test('accepts PUBLISHED with the approved draft identity', () => {
  const result = parsePlanFeatureHandoff({
    contractVersion: '1.0',
    runId,
    status: 'PUBLISHED',
    planeId,
    draft: { sha256: draftSha256 },
  }, runId);

  assert.equal(result.status, 'PUBLISHED');
  assert.equal(result.draft.sha256, draftSha256);
});

test('accepts STALE_DRAFT with the mismatched reviewed and current identities', () => {
  const result = parsePlanFeatureHandoff({
    contractVersion: '1.0',
    runId,
    status: 'STALE_DRAFT',
    planeId,
    draft: { expectedSha256: 'a'.repeat(64), actualSha256: 'b'.repeat(64) },
  }, runId);

  assert.equal(result.status, 'STALE_DRAFT');
});

test('does not inspect stdout when a valid handoff is present', async () => {
  await withFixture(async (root, draftPath) => {
    const handoffPath = path.join(root, 'handoff.json');
    await writeFile(handoffPath, JSON.stringify(ready(draftPath)), 'utf8');

    const result = await readPlanFeatureHandoff(handoffPath, runId);

    assert.equal(result.status, 'READY_FOR_REVIEW');
    await assert.rejects(readFile(path.join(root, 'stdout.log')));
  });
});

test('rejects malformed, partial, unsupported, unknown, and mismatched handoffs safely', async () => {
  await withFixture(async (root, draftPath) => {
    const cases: Array<[string, string, unknown]> = [
      ['corrupt JSON', 'not-json', 'MALFORMED_JSON'],
      ['partial JSON', '{"contractVersion":"1.0"', 'MALFORMED_JSON'],
      ['unsupported version', JSON.stringify({ ...ready(draftPath), contractVersion: '2.0' }), 'UNSUPPORTED_VERSION'],
      ['unknown status', JSON.stringify({ ...ready(draftPath), status: 'FAILED' }), 'UNKNOWN_STATUS'],
      ['run mismatch', JSON.stringify({ ...ready(draftPath), runId: 'run_other' }), 'RUN_ID_MISMATCH'],
      ['missing status field', JSON.stringify({ ...ready(draftPath), taskTreeReady: undefined }), 'INVALID_FIELD'],
    ];

    for (const [name, contents, code] of cases) {
      const handoffPath = path.join(root, `${name.replaceAll(' ', '-')}.json`);
      await writeFile(handoffPath, contents, 'utf8');
      await assert.rejects(
        readPlanFeatureHandoff(handoffPath, runId),
        (error: unknown) => error instanceof PlanFeatureHandoffError && error.code === code,
        name,
      );
    }
  });
});

test('rejects missing handoff, empty handoff, invalid required fields, and bad requirement hashes', async () => {
  await withFixture(async (root, draftPath) => {
    await assert.rejects(
      readPlanFeatureHandoff(path.join(root, 'missing.json'), runId),
      (error: unknown) => error instanceof PlanFeatureHandoffError && error.code === 'HANDOFF_UNAVAILABLE',
    );

    const emptyPath = path.join(root, 'empty.json');
    await writeFile(emptyPath, '', 'utf8');
    await assert.rejects(
      readPlanFeatureHandoff(emptyPath, runId),
      (error: unknown) => error instanceof PlanFeatureHandoffError && error.code === 'EMPTY_HANDOFF',
    );

    await assert.throws(
      () => parsePlanFeatureHandoff({ ...ready(draftPath), planeId: 'not-a-plane-id' }, runId),
      (error: unknown) => error instanceof PlanFeatureHandoffError && error.code === 'INVALID_FIELD',
    );
    await assert.throws(
      () => parsePlanFeatureHandoff({ ...ready(draftPath), requirements: { ...requirements, aggregateHash: 'c'.repeat(64) } }, runId),
      (error: unknown) => error instanceof PlanFeatureHandoffError && error.code === 'INVALID_REQUIREMENTS',
    );
  });
});

test('treats stdout that sounds successful as a technical failure without a handoff', async () => {
  await withFixture(async (root) => {
    await writeFile(path.join(root, 'stdout.log'), 'PUBLISHED successfully\nREADY_FOR_REVIEW\n', 'utf8');
    await assert.rejects(
      readPlanFeatureHandoff(path.join(root, 'missing-terminal-handoff.json'), runId),
      (error: unknown) => error instanceof PlanFeatureHandoffError && error.code === 'HANDOFF_UNAVAILABLE',
    );
  });
});

test('rejects a missing READY draft and a draft hash mismatch', async () => {
  await withFixture(async (root, draftPath) => {
    const missingDraft = ready(path.join(root, 'does-not-exist.md'));
    const missingPath = path.join(root, 'missing-draft.json');
    await writeFile(missingPath, JSON.stringify(missingDraft), 'utf8');
    await assert.rejects(
      readPlanFeatureHandoff(missingPath, runId),
      (error: unknown) => error instanceof PlanFeatureHandoffError && error.code === 'DRAFT_UNAVAILABLE',
    );

    const mismatch = ready(draftPath);
    mismatch.draft = { path: draftPath, sha256: 'c'.repeat(64) };
    const mismatchPath = path.join(root, 'hash-mismatch.json');
    await writeFile(mismatchPath, JSON.stringify(mismatch), 'utf8');
    await assert.rejects(
      readPlanFeatureHandoff(mismatchPath, runId),
      (error: unknown) => error instanceof PlanFeatureHandoffError && error.code === 'DRAFT_HASH_MISMATCH',
    );
  });
});

test('rejects a handoff whose Plane id differs from the active Task Lane context', async () => {
  await withFixture(async (root, draftPath) => {
    const handoffPath = path.join(root, 'plane-mismatch.json');
    await writeFile(handoffPath, JSON.stringify(ready(draftPath)), 'utf8');
    await assert.rejects(
      readPlanFeatureHandoff(handoffPath, runId, 'OTHER-99'),
      (error: unknown) => error instanceof PlanFeatureHandoffError && error.code === 'PLANE_ID_MISMATCH',
    );
  });
});
