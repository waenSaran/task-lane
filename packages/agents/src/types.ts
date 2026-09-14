export interface AgentCapabilities {
  resume: boolean;
  cancellation: boolean;
}

export interface AgentFailure {
  code: string;
  message: string;
  recoverable: boolean;
}

export interface AgentDoctorResult {
  ok: boolean;
  version: string;
  authenticated: boolean;
  capabilities: AgentCapabilities;
  failure: AgentFailure | null;
}

export interface AgentExecutionRequest {
  runId: string;
  cwd: string;
  instruction: string;
  artifactRoot: string;
  handoffPath?: string;
  env?: Readonly<Record<string, string | undefined>>;
  signal?: AbortSignal;
}

export interface AgentResumeRequest extends AgentExecutionRequest {
  sessionId: string;
}

export interface AgentExecutionResult {
  exitCode: number | null;
  sessionId: string | null;
  version: string;
  stdoutPath: string;
  stderrPath: string;
  metadataPath: string;
  capabilities: AgentCapabilities;
  failure: AgentFailure | null;
}

export interface AgentAdapter {
  doctor(): Promise<AgentDoctorResult>;
  canResume(): Promise<boolean>;
  start(request: AgentExecutionRequest): Promise<AgentExecutionResult>;
  resume(request: AgentResumeRequest): Promise<AgentExecutionResult>;
}
