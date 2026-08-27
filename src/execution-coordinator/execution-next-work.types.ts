export const EXECUTION_NEXT_STEP_SELECTORS = Symbol(
  'EXECUTION_NEXT_STEP_SELECTORS',
);

export interface ExecutionNextStepSelector {
  readonly selectorId: string;
  selectNextWork(limit: number): Promise<number>;
}

export interface ExecutionNextWorkResult {
  selectedWorkItems: number;
  terminalCandidates: number;
}

export type AgentInferencePurpose = 'normal' | 'repair' | 'closing';

export interface AgentInferenceCoordination {
  schemaVersion: 'agent-inference/1';
  purpose: AgentInferencePurpose;
  phase: 'agent_loop' | 'output_repair' | 'forced_finalization';
  sourceStepId: string | null;
  evidenceStepIds: string[];
}

export type AgentLoopContinuation =
  | {
      kind: 'normal';
      directive?:
        | 'tool_budget_soft_limit'
        | 'exact_tool_repeat_warning'
        | 'exact_tool_repeat_blocked';
    }
  | { kind: 'closing'; reason: 'tool_budget_exhausted' }
  | { kind: 'partial'; trigger: 'exact_tool_repeat_persisted' };

export type RuntimeDirective =
  | {
      schemaVersion: 'runtime-directive/1';
      kind: 'output_repair';
      reason: string;
      toolsAllowed: false;
    }
  | {
      schemaVersion: 'runtime-directive/1';
      kind: 'forced_finalization';
      reason: 'budget_exhausted' | 'tool_budget_exhausted';
      toolsAllowed: false;
    }
  | {
      schemaVersion: 'runtime-directive/1';
      kind: 'progress_warning';
      reason:
        | 'normal_budget_soft_limit'
        | 'tool_budget_soft_limit'
        | 'exact_tool_repeat_warning'
        | 'exact_tool_repeat_blocked';
      toolsAllowed: true;
    };
