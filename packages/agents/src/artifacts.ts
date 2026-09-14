import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentCapabilities } from './types.js';

export interface AgentMetadata {
  sessionId: string | null;
  version: string;
  capabilities: AgentCapabilities;
}

export interface AgentArtifactPaths {
  directory: string;
  stdoutPath: string;
  stderrPath: string;
  metadataPath: string;
}

export function createAgentArtifactPaths(artifactRoot: string, runId: string): AgentArtifactPaths {
  const directory = path.join(artifactRoot, runId);
  return {
    directory,
    stdoutPath: path.join(directory, 'stdout.log'),
    stderrPath: path.join(directory, 'stderr.log'),
    metadataPath: path.join(directory, 'metadata.json'),
  };
}

export async function writeAgentMetadata(
  artifactRoot: string,
  runId: string,
  metadata: AgentMetadata,
): Promise<string> {
  const paths = createAgentArtifactPaths(artifactRoot, runId);
  await mkdir(paths.directory, { recursive: true });
  await writeFile(paths.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  return paths.metadataPath;
}
