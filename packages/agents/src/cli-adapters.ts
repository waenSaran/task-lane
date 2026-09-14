import { execFile as execFileCallback } from 'node:child_process';
import { lstat, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createAgentArtifactPaths, writeAgentMetadata } from './artifacts.js';
import { runAgentProcess } from './process-runner.js';
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentDoctorResult,
  AgentExecutionRequest,
  AgentExecutionResult,
  AgentFailure,
  AgentResumeRequest,
} from './types.js';

const execFile = promisify(execFileCallback);
const UNKNOWN_VERSION = 'unknown';
const PLAN_FEATURE_REQUEST = /^\/plan-feature(?:\s|$)/;

function explicitCodexInstruction(instruction: string): string {
  return instruction.replace(/^\/plan-feature(?=\s|$)/, '$plan-feature');
}

export const PINNED_AGENT_VERSIONS = {
  CODEX: '0.154.0',
  GROK: '1.0.30',
} as const;

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  errorCode?: string;
}

export interface CliAdapterOptions {
  command?: string;
  environment?: Readonly<Record<string, string | undefined>>;
  homeDir?: string;
  repositoryRoot?: string;
  agentSourceRoot?: string;
  resumeSupported?: boolean;
}

export function parseCliVersion(output: string): string {
  return output.match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/)?.[0] ?? UNKNOWN_VERSION;
}

function environmentFor(
  base: Readonly<Record<string, string | undefined>> | undefined,
  override?: Readonly<Record<string, string | undefined>>,
): NodeJS.ProcessEnv {
  return { ...process.env, ...base, ...override };
}

async function runCommand(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  try {
    const result = await execFile(command, [...args], { cwd, env, maxBuffer: 1024 * 1024 });
    return { stdout: String(result.stdout), stderr: String(result.stderr), exitCode: 0 };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: string | number };
    return {
      stdout: String(failure.stdout ?? ''),
      stderr: String(failure.stderr ?? ''),
      exitCode: typeof failure.code === 'number' ? failure.code : null,
      errorCode: typeof failure.code === 'string' ? failure.code : undefined,
    };
  }
}

function failure(code: string, message: string, recoverable = true): AgentFailure {
  return { code, message, recoverable };
}

function stripTimestamp(line: string): string {
  return line.replace(/^\[[^\]]+\] /, '');
}

function sessionIdFromOutput(output: string, kind: 'codex' | 'grok'): string | null {
  for (const line of output.split(/\r?\n/)) {
    try {
      const event = JSON.parse(stripTimestamp(line)) as Record<string, unknown>;
      if (kind === 'codex' && event.type === 'thread.started' && typeof event.thread_id === 'string') {
        return event.thread_id;
      }
      if (kind === 'grok' && typeof event.sessionId === 'string') return event.sessionId;
    } catch {
      // Human-readable output is intentionally ignored; session ids come from machine events only.
    }
  }
  return null;
}

function authFailureFromOutput(stderr: string): AgentFailure | null {
  return /auth|unauthori[sz]ed|not authenticated|login required|api key/i.test(stderr)
    ? failure('AUTHENTICATION_UNAVAILABLE', 'Agent authentication is unavailable')
    : null;
}

async function hasGrokAuth(homeDir: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  if (env.XAI_API_KEY || env.GROK_DEPLOYMENT_KEY) return true;
  try {
    const auth = JSON.parse(await readFile(path.join(homeDir, '.grok', 'auth.json'), 'utf8')) as unknown;
    if (typeof auth === 'object' && auth !== null && /"key"\s*:\s*"[^"]+"/.test(JSON.stringify(auth))) return true;
  } catch {
    // A missing or malformed auth file is handled as unauthenticated below.
  }
  try {
    const config = await readFile(path.join(homeDir, '.grok', 'config.toml'), 'utf8');
    return /^\s*api_key\s*=\s*["'][^"']+["']/m.test(config);
  } catch {
    return false;
  }
}

async function replaceSymlink(target: string, source: string, type: 'dir' | 'file'): Promise<void> {
  await rm(target, { recursive: true, force: true });
  await symlink(source, target, type);
}

async function prepareCodexEnvironment(
  homeDir: string,
  cwd: string,
  artifactRoot: string,
  runId: string,
  environment: NodeJS.ProcessEnv,
): Promise<{ environment: NodeJS.ProcessEnv; failure: AgentFailure | null }> {
  const canonicalSkill = path.join(cwd, '.claude', 'skills', 'plan-feature');
  try {
    const skill = await lstat(path.join(canonicalSkill, 'SKILL.md'));
    if (!skill.isFile()) throw new Error('canonical plan-feature skill is not a file');
  } catch {
    return {
      environment,
      failure: failure('CANONICAL_SKILL_MISSING', 'The repository canonical .claude/skills/plan-feature/SKILL.md is unavailable', false),
    };
  }

  const runtimeRoot = path.join(artifactRoot, runId, 'codex-runtime');
  const codexHome = path.join(runtimeRoot, '.codex');
  const skillLink = path.join(runtimeRoot, '.agents', 'skills', 'plan-feature');
  await mkdir(path.dirname(skillLink), { recursive: true });
  await mkdir(codexHome, { recursive: true });
  await replaceSymlink(skillLink, canonicalSkill, 'dir');

  const sourceCodexHome = environment.CODEX_HOME ?? path.join(homeDir, '.codex');
  for (const filename of ['auth.json', 'config.toml']) {
    await replaceSymlink(path.join(codexHome, filename), path.join(sourceCodexHome, filename), 'file');
  }

  return {
    environment: { ...environment, HOME: runtimeRoot, CODEX_HOME: codexHome },
    failure: null,
  };
}

interface Definition {
  kind: 'codex' | 'grok';
  command: string;
  environment: Readonly<Record<string, string | undefined>>;
  homeDir: string;
  repositoryRoot?: string;
  agentSourceRoot?: string;
  resumeSupported: boolean;
  expectedVersion: string;
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

class CliAdapter implements AgentAdapter {
  constructor(private readonly definition: Definition) {}

  async doctor(): Promise<AgentDoctorResult> {
    const environment = environmentFor(this.definition.environment);
    const versionResult = await runCommand(this.definition.command, ['--version'], os.tmpdir(), environment);
    const version = parseCliVersion(versionResult.stdout || versionResult.stderr);
    if (version === UNKNOWN_VERSION) {
      return {
        ok: false,
        version,
        authenticated: false,
        capabilities: this.capabilities(),
        failure: failure(versionResult.errorCode === 'ENOENT' ? 'BINARY_MISSING' : 'VERSION_UNAVAILABLE', 'Agent CLI version could not be read', false),
      };
    }
    if (version !== this.definition.expectedVersion) {
      return {
        ok: false,
        version,
        authenticated: false,
        capabilities: this.capabilities(),
        failure: failure('UNSUPPORTED_VERSION', `Expected ${this.definition.expectedVersion}, found ${version}`, false),
      };
    }

    const authResult = this.definition.kind === 'codex'
      ? await this.codexAuth(environment)
      : await this.grokAuth(environment);
    return {
      ok: authResult.authenticated,
      version,
      authenticated: authResult.authenticated,
      capabilities: this.capabilities(),
      failure: authResult.authenticated
        ? null
        : authResult.failure ?? failure('AUTHENTICATION_UNAVAILABLE', 'Agent authentication is unavailable'),
    };
  }

  async canResume(): Promise<boolean> {
    return this.definition.resumeSupported;
  }

  async start(request: AgentExecutionRequest): Promise<AgentExecutionResult> {
    return this.execute(request, false);
  }

  async resume(request: AgentResumeRequest): Promise<AgentExecutionResult> {
    if (!request.sessionId.trim()) {
      return this.failureResult(request, null, failure('SESSION_MISSING', 'A session id is required to resume'));
    }
    if (!this.definition.resumeSupported) {
      return this.failureResult(request, null, failure('RESUME_UNSUPPORTED', 'Native agent resume is unavailable'));
    }
    return this.execute(request, true);
  }

  private capabilities(): AgentCapabilities {
    return { resume: this.definition.resumeSupported, cancellation: true };
  }

  private agentCwd(cwd: string): { cwd: string; failure: AgentFailure | null } {
    const { repositoryRoot, agentSourceRoot } = this.definition;
    if (!repositoryRoot && !agentSourceRoot) return { cwd, failure: null };
    if (!repositoryRoot || !agentSourceRoot) {
      return { cwd, failure: failure('SOURCE_VIEW_UNAVAILABLE', 'Agent source view configuration is incomplete', false) };
    }
    if (isWithin(agentSourceRoot, cwd)) return { cwd, failure: null };
    if (!isWithin(repositoryRoot, cwd)) {
      return { cwd, failure: failure('SOURCE_VIEW_UNAVAILABLE', 'The selected repository is outside the managed source roots', false) };
    }
    return { cwd: path.join(agentSourceRoot, path.relative(repositoryRoot, cwd)), failure: null };
  }

  private async codexAuth(environment: NodeJS.ProcessEnv): Promise<{ authenticated: boolean; failure: AgentFailure | null }> {
    if (environment.CODEX_API_KEY) return { authenticated: true, failure: null };
    const result = await runCommand(this.definition.command, ['doctor', '--json'], os.tmpdir(), environment);
    if (result.errorCode === 'ENOENT') return { authenticated: false, failure: failure('BINARY_MISSING', 'Agent CLI is not installed', false) };
    try {
      const report = JSON.parse(result.stdout) as { checks?: Record<string, { status?: string }> };
      const authenticated = report.checks?.['auth.credentials']?.status === 'ok';
      return { authenticated, failure: authenticated ? null : failure('AUTHENTICATION_UNAVAILABLE', 'Agent authentication is unavailable') };
    } catch {
      return { authenticated: false, failure: authFailureFromOutput(result.stderr) ?? failure('AUTHENTICATION_UNAVAILABLE', 'Agent authentication status is unavailable') };
    }
  }

  private async grokAuth(environment: NodeJS.ProcessEnv): Promise<{ authenticated: boolean; failure: AgentFailure | null }> {
    const inspect = await runCommand(this.definition.command, ['inspect', '--json'], os.tmpdir(), environment);
    if (inspect.errorCode === 'ENOENT') return { authenticated: false, failure: failure('BINARY_MISSING', 'Agent CLI is not installed', false) };
    if (inspect.exitCode !== 0) return { authenticated: false, failure: authFailureFromOutput(inspect.stderr) ?? failure('CLI_DOCTOR_FAILED', 'Agent capability check failed') };
    const authenticated = await hasGrokAuth(this.definition.homeDir, environment);
    return { authenticated, failure: authenticated ? null : failure('AUTHENTICATION_UNAVAILABLE', 'Agent authentication is unavailable') };
  }

  private startArgs(request: AgentExecutionRequest): string[] {
    return this.definition.kind === 'codex'
      ? ['exec', '--json', '--cd', request.cwd, '--sandbox', 'workspace-write', explicitCodexInstruction(request.instruction)]
      : ['--no-auto-update', '--single', request.instruction, '--cwd', request.cwd, '--output-format', 'json', '--sandbox', 'workspace-write', '--always-approve'];
  }

  private resumeArgs(request: AgentResumeRequest): string[] {
    return this.definition.kind === 'codex'
      ? ['exec', 'resume', '--json', '--cd', request.cwd, '--sandbox', 'workspace-write', request.sessionId, explicitCodexInstruction(request.instruction)]
      : ['--no-auto-update', '--single', request.instruction, '--resume', request.sessionId, '--cwd', request.cwd, '--output-format', 'json', '--sandbox', 'workspace-write', '--always-approve'];
  }

  private async execute(
    request: AgentExecutionRequest,
    resuming: boolean,
  ): Promise<AgentExecutionResult> {
    const sourceView = this.agentCwd(request.cwd);
    if (sourceView.failure) return this.failureResult(request, null, sourceView.failure);
    const executionRequest = { ...request, cwd: sourceView.cwd };
    const args = resuming ? this.resumeArgs(executionRequest as AgentResumeRequest) : this.startArgs(executionRequest);
    let environment = environmentFor(this.definition.environment, request.env);
    if (this.definition.kind === 'codex' && PLAN_FEATURE_REQUEST.test(request.instruction)) {
      const prepared = await prepareCodexEnvironment(this.definition.homeDir, executionRequest.cwd, request.artifactRoot, request.runId, environment);
      if (prepared.failure) return this.failureResult(request, null, prepared.failure);
      environment = prepared.environment;
    }
    const versionResult = await runCommand(this.definition.command, ['--version'], os.tmpdir(), environment);
    const version = parseCliVersion(versionResult.stdout || versionResult.stderr);
    if (version === UNKNOWN_VERSION) {
      return this.failureResult(request, version, failure(versionResult.errorCode === 'ENOENT' ? 'BINARY_MISSING' : 'VERSION_UNAVAILABLE', 'Agent CLI version could not be read', false));
    }
    if (version !== this.definition.expectedVersion) {
      return this.failureResult(request, version, failure('UNSUPPORTED_VERSION', `Expected ${this.definition.expectedVersion}, found ${version}`, false));
    }

    const processResult = await runAgentProcess({
      command: this.definition.command,
      args,
      cwd: executionRequest.cwd,
      env: environment,
      artifactRoot: request.artifactRoot,
      runId: request.runId,
      signal: request.signal,
    });
    let processFailure: AgentFailure | null = null;
    if (processResult.failure) {
      processFailure = processResult.failure.code === 'PROCESS_FAILED'
        ? authFailureFromOutput(`${await readFile(processResult.stderrPath, 'utf8')}\n${await readFile(processResult.stdoutPath, 'utf8')}`) ?? failure('PROCESS_FAILED', processResult.failure.message)
        : failure(processResult.failure.code, processResult.failure.message);
    } else if (processResult.exitCode !== 0) {
      processFailure = failure('PROCESS_FAILED', `Agent process exited with code ${processResult.exitCode ?? 'unknown'}`);
    }
    const sessionId = processFailure ? null : sessionIdFromOutput(await readFile(processResult.stdoutPath, 'utf8'), this.definition.kind);
    const finalFailure = processFailure ?? (sessionId ? null : failure('SESSION_MISSING', 'Agent did not return a machine-readable session id'));
    const metadataPath = await writeAgentMetadata(request.artifactRoot, request.runId, {
      sessionId,
      version,
      capabilities: this.capabilities(),
    });
    return {
      exitCode: processResult.exitCode,
      sessionId,
      version,
      stdoutPath: processResult.stdoutPath,
      stderrPath: processResult.stderrPath,
      metadataPath,
      capabilities: this.capabilities(),
      failure: finalFailure,
    };
  }

  private async failureResult(
    request: AgentExecutionRequest,
    version: string | null,
    agentFailure: AgentFailure,
  ): Promise<AgentExecutionResult> {
    const paths = createAgentArtifactPaths(request.artifactRoot, request.runId);
    await mkdir(paths.directory, { recursive: true });
    await Promise.all([
      writeFile(paths.stdoutPath, '', 'utf8'),
      writeFile(paths.stderrPath, `[agent] ${agentFailure.code}\n`, 'utf8'),
    ]);
    const metadataPath = await writeAgentMetadata(request.artifactRoot, request.runId, {
      sessionId: null,
      version: version ?? UNKNOWN_VERSION,
      capabilities: this.capabilities(),
    });
    return {
      exitCode: null,
      sessionId: null,
      version: version ?? UNKNOWN_VERSION,
      stdoutPath: paths.stdoutPath,
      stderrPath: paths.stderrPath,
      metadataPath,
      capabilities: this.capabilities(),
      failure: agentFailure,
    };
  }
}

export class CodexAdapter implements AgentAdapter {
  private readonly adapter: CliAdapter;

  constructor(options: CliAdapterOptions = {}) {
    this.adapter = new CliAdapter({
      kind: 'codex',
      command: options.command ?? 'codex',
      environment: options.environment ?? {},
      homeDir: options.homeDir ?? os.homedir(),
      repositoryRoot: options.repositoryRoot ?? process.env.TASK_LANE_REPO_ROOT,
      agentSourceRoot: options.agentSourceRoot ?? process.env.TASK_LANE_AGENT_REPO_ROOT,
      resumeSupported: options.resumeSupported ?? true,
      expectedVersion: PINNED_AGENT_VERSIONS.CODEX,
    });
  }

  doctor() { return this.adapter.doctor(); }
  canResume() { return this.adapter.canResume(); }
  start(request: AgentExecutionRequest) { return this.adapter.start(request); }
  resume(request: AgentResumeRequest) { return this.adapter.resume(request); }
}

export class GrokAdapter implements AgentAdapter {
  private readonly adapter: CliAdapter;

  constructor(options: CliAdapterOptions = {}) {
    this.adapter = new CliAdapter({
      kind: 'grok',
      command: options.command ?? 'grok',
      environment: options.environment ?? {},
      homeDir: options.homeDir ?? os.homedir(),
      repositoryRoot: options.repositoryRoot ?? process.env.TASK_LANE_REPO_ROOT,
      agentSourceRoot: options.agentSourceRoot ?? process.env.TASK_LANE_AGENT_REPO_ROOT,
      resumeSupported: options.resumeSupported ?? true,
      expectedVersion: PINNED_AGENT_VERSIONS.GROK,
    });
  }

  doctor() { return this.adapter.doctor(); }
  canResume() { return this.adapter.canResume(); }
  start(request: AgentExecutionRequest) { return this.adapter.start(request); }
  resume(request: AgentResumeRequest) { return this.adapter.resume(request); }
}
