export interface ExecutionAccessScope {
  ownerPrincipal: string;
  workspaceId: string;
}

export interface ExecutionContext {
  schemaVersion: 'execution-context/1';
  rootExecutionId: string;
  executionId: string;
  turnId?: string;
  causedByEventId: string;
}

export interface IncomingExecutionArtifact {
  artifactId: string;
  kind: string;
  contentHash: string;
  size: number;
  mediaType: string;
  encoding?: 'identity';
  dataClassification: string;
  redaction?: Record<string, unknown>;
  retentionClass?: string;
  createdByEventId?: string | null;
  inputSourceIds?: string[];
  bodyBase64?: string;
}

export interface ProgressGrantRequest {
  executionId: string;
  turnId: string;
  loopId: string;
  agentName: string;
  loopKind: 'top_level';
  requestedPolicy: {
    normal: number;
    normalInferenceSoftLimit: number;
    repair: number;
    closing: number;
    maxTokensPerInference: number;
    toolCalls: number;
    toolCallSoftLimit: number;
    exactToolRepeatWarning?: boolean;
    exactToolRepeatBlockAfterWarning?: boolean;
    exactToolRepeatTerminateAfterBlock?: boolean;
  };
}

export interface OperationBudgetReservationRequest {
  executionId: string;
  loopId: string;
  grantId: string;
  operationId: string;
  operationKind: 'inference' | 'tool_call';
  bucket: 'normal' | 'repair' | 'closing' | 'tool';
  toolCallId?: string;
  operationFingerprint?: string;
  operationFingerprintVersion?: 'canonical_tool_input_v1';
  toolBatchSize?: number;
  toolBatchIndex?: number;
  phase: string;
  round: number;
  name: string;
}

export interface ExecutionCompletion {
  kind?: 'full' | 'partial';
  reason?: string;
  source?: 'model' | 'runtime_template';
  partialResult?: DeterministicPartialResult;
}

export interface DeterministicPartialOperation {
  operationId: string;
  toolCallId: string;
  name: string;
  summary: string;
}

export interface DeterministicPartialResult {
  version: '1';
  trigger:
    | 'closing_unavailable'
    | 'closing_output_empty'
    | 'exact_tool_repeat_persisted';
  loopId: string;
  grantId: string;
  completedOperations: DeterministicPartialOperation[];
  pending: ['final_synthesis'] | ['strategy_change'];
  continuation?: {
    kind: 'new_turn';
    reason: 'different_strategy_required';
  };
}
