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

export interface ExecutionTelemetrySummary {
  attemptedEvents?: number;
  acceptedEvents?: number;
  errors?: string[];
}

export interface ProgressGrantRequest {
  executionId: string;
  turnId: string;
  loopId: string;
  agentName: string;
  loopKind: 'top_level';
  executionAttemptId: string;
  requestedPolicy: {
    normal: number;
    repair: number;
    closing: number;
    maxTokensPerInference: number;
    toolCalls: number;
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
  phase: string;
  round: number;
  name: string;
  executionAttemptId: string;
}

export interface ExecutionCompletion {
  kind?: 'full' | 'partial';
  reason?: string;
}
