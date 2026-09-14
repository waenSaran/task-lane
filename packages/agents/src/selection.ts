export type AgentKind = 'CODEX' | 'GROK';

export interface AgentSelectionInput {
  taskOverride?: AgentKind | null;
  repoLastUsed?: AgentKind | null;
  globalDefault: AgentKind;
}

export function selectAgent(input: AgentSelectionInput): AgentKind {
  if (input.taskOverride) return input.taskOverride;
  if (input.repoLastUsed) return input.repoLastUsed;
  return input.globalDefault;
}
