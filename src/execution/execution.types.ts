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
