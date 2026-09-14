import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  PLAN_FEATURE_HANDOFF_VERSION,
  PlanFeatureHandoffError,
  type PlanFeatureHandoff,
  type RequirementFingerprint,
  parsePlanFeatureHandoff,
} from './index.js';

export type PlanFeatureHandoffWriteInput =
  | {
      status: 'READY_FOR_REVIEW';
      draftPath: string;
      requirements: RequirementFingerprint;
    }
  | {
      status: 'BA_REVIEW_REQUIRED';
      requirements: RequirementFingerprint;
    }
  | { status: 'PUBLISHED'; draftSha256: string }
  | { status: 'STALE_DRAFT'; expectedSha256: string; actualSha256: string };

export type WritePlanFeatureHandoffOptions = PlanFeatureHandoffWriteInput & {
  destinationPath: string;
  runId: string;
  planeId: string;
};

function invalid(message: string): never {
  throw new PlanFeatureHandoffError('INVALID_FIELD', message);
}

async function exactSha256(filePath: string): Promise<string> {
  try {
    return createHash('sha256').update(await readFile(filePath)).digest('hex');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unable to read draft';
    throw new PlanFeatureHandoffError('DRAFT_UNAVAILABLE', `draft unavailable: ${message}`);
  }
}

function envelope(options: WritePlanFeatureHandoffOptions, statusData: Record<string, unknown>): unknown {
  return {
    contractVersion: PLAN_FEATURE_HANDOFF_VERSION,
    runId: options.runId,
    status: options.status,
    planeId: options.planeId,
    ...statusData,
  };
}

async function payload(options: WritePlanFeatureHandoffOptions): Promise<PlanFeatureHandoff> {
  if (!path.isAbsolute(options.destinationPath)) invalid('destinationPath must be absolute');
  if (!options.runId) invalid('runId must be non-empty');

  let value: unknown;
  switch (options.status) {
    case 'READY_FOR_REVIEW': {
      if (!path.isAbsolute(options.draftPath)) invalid('draftPath must be absolute');
      const sha256 = await exactSha256(options.draftPath);
      value = envelope(options, {
        draft: { path: options.draftPath, sha256 },
        requirements: options.requirements,
        taskTreeReady: true,
      });
      break;
    }
    case 'BA_REVIEW_REQUIRED':
      value = envelope(options, { requirements: options.requirements });
      break;
    case 'PUBLISHED':
      value = envelope(options, { draft: { sha256: options.draftSha256 } });
      break;
    case 'STALE_DRAFT':
      value = envelope(options, {
        draft: { expectedSha256: options.expectedSha256, actualSha256: options.actualSha256 },
      });
      break;
  }
  return parsePlanFeatureHandoff(value, options.runId, options.planeId);
}

export async function writePlanFeatureHandoff(
  options: WritePlanFeatureHandoffOptions,
): Promise<PlanFeatureHandoff> {
  const handoff = await payload(options);
  const directory = path.dirname(options.destinationPath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(options.destinationPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const contents = `${JSON.stringify(handoff, null, 2)}\n`;
  let file;
  try {
    file = await open(temporaryPath, 'wx', 0o600);
    await file.writeFile(contents, 'utf8');
    await file.sync();
    await file.close();
    file = undefined;
    await rename(temporaryPath, options.destinationPath);
  } catch (error) {
    if (file) await file.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
  return handoff;
}
