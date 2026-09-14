import { rm } from 'node:fs/promises';
import type {
  AgentAdapter,
  AgentExecutionRequest,
  AgentExecutionResult,
  AgentResumeRequest,
} from '@task-lane/agents';
import { readPlanFeatureHandoff } from './index.js';

export const TASK_LANE_RUNTIME_ENV = {
  runId: 'TASK_LANE_RUN_ID',
  planeId: 'TASK_LANE_PLANE_ID',
  handoffPath: 'TASK_LANE_HANDOFF_PATH',
  handoffWriter: 'TASK_LANE_HANDOFF_WRITER',
} as const;

export interface TaskLanePlanFeatureRunnerContext {
  runId: string;
  planeId: string;
  handoffPath: string;
  handoffWriterPath: string;
}

export function buildTaskLanePlanFeatureInstruction(
  context: TaskLanePlanFeatureRunnerContext,
  additionalInstruction = '',
): string {
  return [
    `/plan-feature ${context.planeId}`,
    'Task Lane bridge instructions (mandatory):',
    'Run the existing /plan-feature invocation above exactly as installed.',
    'Do not modify the canonical /plan-feature skill or its HRCS files.',
    'The skill remains the authority for business readiness, planning decisions, and every Plane write.',
    `At the terminal planning boundary, invoke the Task Lane handoff writer at "$${TASK_LANE_RUNTIME_ENV.handoffWriter}" with the status-specific evidence.`,
    `Use "$${TASK_LANE_RUNTIME_ENV.handoffPath}" as the handoff destination and emit exactly one supported terminal handoff: READY_FOR_REVIEW, BA_REVIEW_REQUIRED, PUBLISHED, or STALE_DRAFT.`,
    'A technical error must fail the run; never encode it as a business status.',
    'Do not use stdout or conversational text as the handoff protocol.',
    additionalInstruction.trim() ? `Additional Task Lane context:\n${additionalInstruction.trim()}` : '',
  ].filter(Boolean).join('\n');
}

export class TaskLanePlanFeatureRunner {
  private readonly adapter: Pick<AgentAdapter, 'start' | 'resume'>;
  private readonly context: TaskLanePlanFeatureRunnerContext;

  constructor(
    adapter: Pick<AgentAdapter, 'start' | 'resume'>,
    context: TaskLanePlanFeatureRunnerContext,
  ) {
    this.adapter = adapter;
    this.context = context;
  }

  private request(request: AgentExecutionRequest): AgentExecutionRequest {
    return {
      ...request,
      runId: this.context.runId,
      instruction: buildTaskLanePlanFeatureInstruction(this.context, request.instruction),
      handoffPath: this.context.handoffPath,
      env: {
        ...request.env,
        [TASK_LANE_RUNTIME_ENV.runId]: this.context.runId,
        [TASK_LANE_RUNTIME_ENV.planeId]: this.context.planeId,
        [TASK_LANE_RUNTIME_ENV.handoffPath]: this.context.handoffPath,
        [TASK_LANE_RUNTIME_ENV.handoffWriter]: this.context.handoffWriterPath,
      },
    };
  }

  private async verify(result: AgentExecutionResult): Promise<AgentExecutionResult> {
    if (result.exitCode !== 0 || result.failure !== null) return result;
    try {
      await readPlanFeatureHandoff(this.context.handoffPath, this.context.runId, this.context.planeId);
      return result;
    } catch {
      return {
        ...result,
        failure: {
          code: 'PLAN_FEATURE_HANDOFF_INVALID',
          message: 'Agent completed without a valid Task Lane plan-feature handoff',
          recoverable: true,
        },
      };
    }
  }

  private async clearHandoff(): Promise<void> {
    await rm(this.context.handoffPath, { force: true });
  }

  async start(request: AgentExecutionRequest): Promise<AgentExecutionResult> {
    await this.clearHandoff();
    return this.verify(await this.adapter.start(this.request(request)));
  }

  async resume(request: AgentResumeRequest): Promise<AgentExecutionResult> {
    await this.clearHandoff();
    return this.verify(await this.adapter.resume({ ...this.request(request), sessionId: request.sessionId }));
  }
}
