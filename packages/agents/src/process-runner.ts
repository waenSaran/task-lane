import { spawn } from 'node:child_process';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { redactSecrets } from './redaction.js';

export interface AgentProcessFailure {
  code: 'SPAWN_FAILED' | 'PROCESS_FAILED' | 'CANCELLED';
  message: string;
}

export interface AgentProcessRequest {
  command: string;
  args?: readonly string[];
  cwd: string;
  env?: Readonly<Record<string, string | undefined>>;
  stdin?: string;
  artifactRoot: string;
  runId: string;
  literalSecrets?: readonly string[];
  signal?: AbortSignal;
  now?: () => Date;
}

export interface AgentProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdoutPath: string;
  stderrPath: string;
  failure: AgentProcessFailure | null;
}

const SENSITIVE_ENV_KEY = /(TOKEN|API[_-]?KEY|PASSWORD|SECRET|AUTH)/i;

function formatLines(lines: readonly string[], now: () => Date, secrets: readonly string[]): string {
  return lines
    .filter((line) => line.length > 0)
    .map((line) => `[${now().toISOString()}] ${redactSecrets(line, secrets)}\n`)
    .join('');
}

function environmentSecrets(env: Readonly<Record<string, string | undefined>> | undefined): string[] {
  if (!env) return [];
  return Object.entries(env)
    .filter(([key, value]) => SENSITIVE_ENV_KEY.test(key) && Boolean(value))
    .flatMap(([, value]) => (value ? [value] : []));
}

export async function runAgentProcess(request: AgentProcessRequest): Promise<AgentProcessResult> {
  const runDir = path.join(request.artifactRoot, request.runId);
  const stdoutPath = path.join(runDir, 'stdout.log');
  const stderrPath = path.join(runDir, 'stderr.log');
  await mkdir(runDir, { recursive: true });
  await Promise.all([writeFile(stdoutPath, ''), writeFile(stderrPath, '')]);

  const now = request.now ?? (() => new Date());
  const secrets = [...(request.literalSecrets ?? []), ...environmentSecrets(request.env)];
  const env = request.env ? { ...process.env, ...request.env } : process.env;
  let stdoutWrites = Promise.resolve();
  let stderrWrites = Promise.resolve();
  let stdoutPending = '';
  let stderrPending = '';
  let cancelled = request.signal?.aborted ?? false;

  return await new Promise<AgentProcessResult>((resolve) => {
    let settled = false;
    const child = spawn(request.command, [...(request.args ?? [])], {
      cwd: request.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const finish = async (result: AgentProcessResult) => {
      if (settled) return;
      settled = true;
      if (request.signal) request.signal.removeEventListener('abort', onAbort);
      if (stdoutPending) {
        const pending = formatLines([stdoutPending], now, secrets);
        stdoutWrites = stdoutWrites.then(() => appendFile(stdoutPath, pending, 'utf8'));
        stdoutPending = '';
      }
      if (stderrPending) {
        const pending = formatLines([stderrPending], now, secrets);
        stderrWrites = stderrWrites.then(() => appendFile(stderrPath, pending, 'utf8'));
        stderrPending = '';
      }
      await Promise.all([stdoutWrites, stderrWrites]);
      resolve(result);
    };

    const onAbort = () => {
      cancelled = true;
      child.kill('SIGTERM');
    };

    if (request.signal) request.signal.addEventListener('abort', onAbort, { once: true });
    if (cancelled) onAbort();

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdoutPending += String(chunk);
      const lines = stdoutPending.split(/\r?\n/);
      stdoutPending = lines.pop() ?? '';
      const formatted = formatLines(lines, now, secrets);
      if (formatted) stdoutWrites = stdoutWrites.then(() => appendFile(stdoutPath, formatted, 'utf8'));
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderrPending += String(chunk);
      const lines = stderrPending.split(/\r?\n/);
      stderrPending = lines.pop() ?? '';
      const formatted = formatLines(lines, now, secrets);
      if (formatted) stderrWrites = stderrWrites.then(() => appendFile(stderrPath, formatted, 'utf8'));
    });

    child.once('error', (error) => {
      void finish({
        exitCode: null,
        signal: null,
        stdoutPath,
        stderrPath,
        failure: { code: 'SPAWN_FAILED', message: error.message },
      });
    });

    child.once('close', (exitCode, signal) => {
      if (cancelled) {
        void finish({
          exitCode,
          signal,
          stdoutPath,
          stderrPath,
          failure: { code: 'CANCELLED', message: 'Agent process cancelled' },
        });
        return;
      }
      void finish({
        exitCode,
        signal,
        stdoutPath,
        stderrPath,
        failure: exitCode === 0
          ? null
          : { code: 'PROCESS_FAILED', message: `Agent process exited with code ${exitCode ?? 'unknown'}` },
      });
    });

    if (request.stdin !== undefined) child.stdin?.end(request.stdin);
    else child.stdin?.end();
  });
}
