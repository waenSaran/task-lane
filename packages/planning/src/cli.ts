#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { writePlanFeatureHandoff } from './writer.js';
import type { RequirementFingerprint } from './index.js';

const { values } = parseArgs({
  options: {
    status: { type: 'string' },
    'draft-path': { type: 'string' },
    'requirements-file': { type: 'string' },
    'draft-sha256': { type: 'string' },
    'expected-sha256': { type: 'string' },
    'actual-sha256': { type: 'string' },
    'task-tree-ready': { type: 'boolean' },
  },
  allowPositionals: false,
});

function environment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function requirements(pathname: string | undefined): Promise<{ status: 'BA_REVIEW_REQUIRED'; requirements: RequirementFingerprint }> {
  if (!pathname) throw new Error('--requirements-file is required');
  return {
    status: 'BA_REVIEW_REQUIRED',
    requirements: JSON.parse(await readFile(pathname, 'utf8')) as RequirementFingerprint,
  };
}

async function main(): Promise<void> {
  const status = values.status;
  if (status === 'READY_FOR_REVIEW') {
    if (!values['task-tree-ready']) throw new Error('--task-tree-ready is required');
    if (!values['draft-path']) throw new Error('--draft-path is required');
    const input = await requirements(values['requirements-file']);
    await writePlanFeatureHandoff({
      destinationPath: environment('TASK_LANE_HANDOFF_PATH'),
      runId: environment('TASK_LANE_RUN_ID'),
      planeId: environment('TASK_LANE_PLANE_ID'),
      status,
      draftPath: values['draft-path'],
      requirements: input.requirements,
    });
    return;
  }
  if (status === 'BA_REVIEW_REQUIRED') {
    const input = await requirements(values['requirements-file']);
    await writePlanFeatureHandoff({
      destinationPath: environment('TASK_LANE_HANDOFF_PATH'),
      runId: environment('TASK_LANE_RUN_ID'),
      planeId: environment('TASK_LANE_PLANE_ID'),
      ...input,
    });
    return;
  }
  if (status === 'PUBLISHED') {
    if (!values['draft-sha256']) throw new Error('--draft-sha256 is required');
    await writePlanFeatureHandoff({
      destinationPath: environment('TASK_LANE_HANDOFF_PATH'),
      runId: environment('TASK_LANE_RUN_ID'),
      planeId: environment('TASK_LANE_PLANE_ID'),
      status,
      draftSha256: values['draft-sha256'],
    });
    return;
  }
  if (status === 'STALE_DRAFT') {
    if (!values['expected-sha256'] || !values['actual-sha256']) {
      throw new Error('--expected-sha256 and --actual-sha256 are required');
    }
    await writePlanFeatureHandoff({
      destinationPath: environment('TASK_LANE_HANDOFF_PATH'),
      runId: environment('TASK_LANE_RUN_ID'),
      planeId: environment('TASK_LANE_PLANE_ID'),
      status,
      expectedSha256: values['expected-sha256'],
      actualSha256: values['actual-sha256'],
    });
    return;
  }
  throw new Error('unsupported --status');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
