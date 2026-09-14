import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const PLAN_FEATURE_HANDOFF_VERSION = '1.0' as const;
export const PLAN_FEATURE_HANDOFF_STATUSES = [
  'READY_FOR_REVIEW',
  'BA_REVIEW_REQUIRED',
  'PUBLISHED',
  'STALE_DRAFT',
] as const;

export type PlanFeatureHandoffStatus = (typeof PLAN_FEATURE_HANDOFF_STATUSES)[number];

export interface RequirementSource {
  planeId: string;
  hash: string;
}

export interface RequirementFingerprint {
  aggregateHash: string;
  sources: readonly RequirementSource[];
}

interface HandoffEnvelope {
  contractVersion: typeof PLAN_FEATURE_HANDOFF_VERSION;
  runId: string;
  planeId: string;
}

export interface ReadyForReviewHandoff extends HandoffEnvelope {
  status: 'READY_FOR_REVIEW';
  draft: { path: string; sha256: string };
  requirements: RequirementFingerprint;
  taskTreeReady: true;
}

export interface BaReviewRequiredHandoff extends HandoffEnvelope {
  status: 'BA_REVIEW_REQUIRED';
  requirements: RequirementFingerprint;
}

export interface PublishedHandoff extends HandoffEnvelope {
  status: 'PUBLISHED';
  draft: { sha256: string };
}

export interface StaleDraftHandoff extends HandoffEnvelope {
  status: 'STALE_DRAFT';
  draft: { expectedSha256: string; actualSha256: string };
}

export type PlanFeatureHandoff =
  | ReadyForReviewHandoff
  | BaReviewRequiredHandoff
  | PublishedHandoff
  | StaleDraftHandoff;

export type PlanFeatureHandoffErrorCode =
  | 'HANDOFF_UNAVAILABLE'
  | 'EMPTY_HANDOFF'
  | 'MALFORMED_JSON'
  | 'INVALID_HANDOFF'
  | 'UNSUPPORTED_VERSION'
  | 'RUN_ID_MISMATCH'
  | 'UNKNOWN_STATUS'
  | 'INVALID_FIELD'
  | 'INVALID_REQUIREMENTS'
  | 'PLANE_ID_MISMATCH'
  | 'DRAFT_UNAVAILABLE'
  | 'DRAFT_HASH_MISMATCH';

export class PlanFeatureHandoffError extends Error {
  readonly code: PlanFeatureHandoffErrorCode;

  constructor(
    code: PlanFeatureHandoffErrorCode,
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = 'PlanFeatureHandoffError';
  }
}

const HASH = /^[a-f0-9]{64}$/;
const PLANE_ID = /^[A-Z][A-Z0-9]*-\d+$/;

function fail(code: PlanFeatureHandoffErrorCode, message: string): never {
  throw new PlanFeatureHandoffError(code, message);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_HANDOFF', `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || value.length === 0) {
    fail('INVALID_FIELD', `${field} must be a non-empty string`);
  }
  return value;
}

function shaField(record: Record<string, unknown>, field: string): string {
  const value = stringField(record, field);
  if (!HASH.test(value)) fail('INVALID_FIELD', `${field} must be a lowercase SHA-256`);
  return value;
}

function planeIdField(record: Record<string, unknown>): string {
  const value = stringField(record, 'planeId');
  if (!PLANE_ID.test(value)) fail('INVALID_FIELD', 'planeId has an invalid shape');
  return value;
}

function parseRequirements(value: unknown): RequirementFingerprint {
  const record = object(value, 'requirements');
  const aggregateHash = shaField(record, 'aggregateHash');
  const rawSources = record.sources;
  if (!Array.isArray(rawSources)) fail('INVALID_REQUIREMENTS', 'requirements.sources must be an array');

  const sources = rawSources.map((source, index) => {
    const item = object(source, `requirements.sources[${index}]`);
    return { planeId: planeIdField(item), hash: shaField(item, 'hash') };
  });
  const ids = new Set<string>();
  for (const source of sources) {
    if (ids.has(source.planeId)) fail('INVALID_REQUIREMENTS', 'requirement source ids must be unique');
    ids.add(source.planeId);
  }
  if (hashRequirementSources(sources) !== aggregateHash) {
    fail('INVALID_REQUIREMENTS', 'requirements.aggregateHash does not match sources');
  }
  return { aggregateHash, sources };
}

function parseDraft(value: unknown, fields: readonly string[]): Record<string, string> {
  const record = object(value, 'draft');
  const result: Record<string, string> = {};
  for (const field of fields) result[field] = shaField(record, field);
  return result;
}

export function hashRequirementSources(sources: readonly RequirementSource[]): string {
  const canonical = [...sources]
    .sort((left, right) => left.planeId < right.planeId ? -1 : left.planeId > right.planeId ? 1 : 0)
    .map(({ planeId, hash }) => ({ planeId, hash }));
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

export function parsePlanFeatureHandoff(
  value: unknown,
  expectedRunId: string,
  expectedPlaneId?: string,
): PlanFeatureHandoff {
  const record = object(value, 'handoff');
  if (record.contractVersion !== PLAN_FEATURE_HANDOFF_VERSION) {
    if (typeof record.contractVersion !== 'string') fail('INVALID_FIELD', 'contractVersion must be a string');
    fail('UNSUPPORTED_VERSION', `unsupported contractVersion: ${record.contractVersion}`);
  }
  const runId = stringField(record, 'runId');
  if (runId !== expectedRunId) fail('RUN_ID_MISMATCH', 'handoff runId does not match the active run');
  const planeId = planeIdField(record);
  if (expectedPlaneId !== undefined && planeId !== expectedPlaneId) {
    fail('PLANE_ID_MISMATCH', 'handoff planeId does not match the active Plane item');
  }
  const status = record.status;
  if (typeof status !== 'string' || !PLAN_FEATURE_HANDOFF_STATUSES.includes(status as PlanFeatureHandoffStatus)) {
    fail('UNKNOWN_STATUS', 'handoff status is not supported');
  }
  const envelope = { contractVersion: PLAN_FEATURE_HANDOFF_VERSION, runId, planeId };

  switch (status) {
    case 'READY_FOR_REVIEW': {
      const draft = object(record.draft, 'draft');
      const draftPath = stringField(draft, 'path');
      if (!path.isAbsolute(draftPath)) fail('INVALID_FIELD', 'draft.path must be absolute');
      const taskTreeReady = record.taskTreeReady;
      if (taskTreeReady !== true) fail('INVALID_FIELD', 'taskTreeReady must be true');
      return {
        ...envelope,
        status,
        draft: { path: draftPath, sha256: shaField(draft, 'sha256') },
        requirements: parseRequirements(record.requirements),
        taskTreeReady,
      };
    }
    case 'BA_REVIEW_REQUIRED':
      return { ...envelope, status, requirements: parseRequirements(record.requirements) };
    case 'PUBLISHED':
      return { ...envelope, status, draft: parseDraft(record.draft, ['sha256']) as { sha256: string } };
    case 'STALE_DRAFT': {
      const draft = parseDraft(record.draft, ['expectedSha256', 'actualSha256']) as {
        expectedSha256: string;
        actualSha256: string;
      };
      if (draft.expectedSha256 === draft.actualSha256) {
        fail('INVALID_FIELD', 'STALE_DRAFT identities must differ');
      }
      return { ...envelope, status, draft };
    }
  }
  return fail('UNKNOWN_STATUS', 'handoff status is not supported');
}

export async function readPlanFeatureHandoff(
  handoffPath: string,
  expectedRunId: string,
  expectedPlaneId?: string,
): Promise<PlanFeatureHandoff> {
  let contents: string;
  try {
    contents = await readFile(handoffPath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unable to read handoff';
    fail('HANDOFF_UNAVAILABLE', message);
  }
  if (contents.trim().length === 0) fail('EMPTY_HANDOFF', 'handoff file is empty');

  let value: unknown;
  try {
    value = JSON.parse(contents) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid JSON';
    fail('MALFORMED_JSON', message);
  }
  const handoff = parsePlanFeatureHandoff(value, expectedRunId, expectedPlaneId);
  if (handoff.status !== 'READY_FOR_REVIEW') return handoff;

  let draftBytes: Buffer;
  try {
    draftBytes = await readFile(handoff.draft.path);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unable to read draft';
    fail('DRAFT_UNAVAILABLE', message);
  }
  const actualSha256 = createHash('sha256').update(draftBytes).digest('hex');
  if (actualSha256 !== handoff.draft.sha256) {
    fail('DRAFT_HASH_MISMATCH', 'draft SHA-256 does not match the handoff');
  }
  return handoff;
}

export * from './runner.js';
export * from './writer.js';
