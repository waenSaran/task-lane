import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createAgentArtifactPaths, writeAgentMetadata } from './artifacts.js';
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentDoctorResult,
  AgentExecutionRequest,
  AgentExecutionResult,
  AgentResumeRequest,
} from './types.js';

export type FakeAgentScenarioStatus =
  | 'READY_FOR_REVIEW'
  | 'BA_REVIEW_REQUIRED'
  | 'FAILED'
  | 'PUBLISHED';

export interface FakeAgentScenario {
  status: FakeAgentScenarioStatus;
  sessionId?: string;
  handoff?: Readonly<Record<string, unknown>>;
}

export interface FakeAgentAdapterOptions {
  version?: string;
  canResume?: boolean;
  scenarios?: readonly FakeAgentScenario[];
}

export interface FakeAgentCall {
  method: 'start' | 'resume';
  request: AgentExecutionRequest | AgentResumeRequest;
  scenario: FakeAgentScenario;
}

export class FakeAgentAdapter implements AgentAdapter {
  readonly calls: FakeAgentCall[] = [];
  private readonly version: string;
  private readonly resumeEnabled: boolean;
  private readonly scenarios: FakeAgentScenario[];
  private sequence = 0;

  constructor(options: FakeAgentAdapterOptions = {}) {
    this.version = options.version ?? 'fake/1.0.0';
    this.resumeEnabled = options.canResume ?? true;
    this.scenarios = [...(options.scenarios ?? [])];
  }

  private capabilities(): AgentCapabilities {
    return { resume: this.resumeEnabled, cancellation: true };
  }

  async doctor(): Promise<AgentDoctorResult> {
    return {
      ok: true,
      version: this.version,
      authenticated: true,
      capabilities: this.capabilities(),
      failure: null,
    };
  }

  async canResume(): Promise<boolean> {
    return this.resumeEnabled;
  }

  async start(request: AgentExecutionRequest): Promise<AgentExecutionResult> {
    return this.execute('start', request);
  }

  async resume(request: AgentResumeRequest): Promise<AgentExecutionResult> {
    if (!this.resumeEnabled) {
      const scenario = this.nextScenario();
      this.calls.push({ method: 'resume', request, scenario });
      return this.resultFor(request, null, 1, {
        code: 'RESUME_UNSUPPORTED',
        message: 'Fake agent resume is disabled',
        recoverable: true,
      });
    }
    return this.execute('resume', request);
  }

  private nextScenario(): FakeAgentScenario {
    return this.scenarios.shift() ?? { status: 'READY_FOR_REVIEW' };
  }

  private async execute(
    method: 'start' | 'resume',
    request: AgentExecutionRequest | AgentResumeRequest,
  ): Promise<AgentExecutionResult> {
    const scenario = this.nextScenario();
    this.calls.push({ method, request, scenario });
    const sessionId = scenario.sessionId ?? ('sessionId' in request ? request.sessionId : `fake-session-${++this.sequence}`);

    if (scenario.status === 'FAILED') {
      return this.resultFor(request, sessionId, 1, {
        code: 'FAKE_AGENT_FAILURE',
        message: 'Configured fake agent failure',
        recoverable: true,
      });
    }

    if (request.handoffPath) {
      await mkdir(path.dirname(request.handoffPath), { recursive: true });
      await writeFile(
        request.handoffPath,
        `${JSON.stringify({
          contractVersion: '1.0',
          runId: request.runId,
          status: scenario.status,
          planeId: 'FAKE-1',
          ...scenario.handoff,
        }, null, 2)}\n`,
        'utf8',
      );
    }

    return this.resultFor(request, sessionId, 0, null);
  }

  private async resultFor(
    request: AgentExecutionRequest,
    sessionId: string | null,
    exitCode: number,
    failure: AgentExecutionResult['failure'],
  ): Promise<AgentExecutionResult> {
    const paths = createAgentArtifactPaths(request.artifactRoot, request.runId);
    await mkdir(paths.directory, { recursive: true });
    await Promise.all([
      writeFile(paths.stdoutPath, failure ? '[fake] execution failed\n' : '[fake] execution completed\n', 'utf8'),
      writeFile(paths.stderrPath, failure ? `[fake] ${failure.code}\n` : '', 'utf8'),
    ]);
    const metadataPath = await writeAgentMetadata(request.artifactRoot, request.runId, {
      sessionId,
      version: this.version,
      capabilities: this.capabilities(),
    });
    return {
      exitCode,
      sessionId,
      version: this.version,
      stdoutPath: paths.stdoutPath,
      stderrPath: paths.stderrPath,
      metadataPath,
      capabilities: this.capabilities(),
      failure,
    };
  }
}
