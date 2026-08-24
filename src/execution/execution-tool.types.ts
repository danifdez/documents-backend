export type ToolRequester =
  | { kind: 'model'; operationId: string; attemptId: string }
  | { kind: 'deterministic'; component: string };

export interface ToolInvocationContract {
  schemaVersion: 'tool-invocation/1';
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
  requester: ToolRequester;
  executionContext: {
    executionId: string;
    turnId?: string;
    causedByEventId: string;
    phase?: string;
    userGoalRef?: string;
    dataClassification:
      'public' | 'workspace' | 'personal' | 'sensitive' | 'secret';
  };
}

export interface ToolPlanContract {
  schemaVersion: 'tool-plan/1';
  operationId: string;
  toolCallId: string;
  toolName: string;
  descriptorVersion: string;
  normalizedArguments: Record<string, unknown>;
  resources: Array<{
    resourceKey: string;
    mode: 'shared' | 'exclusive';
    kind?: string;
    id?: string;
    version?: string | number;
  }>;
  effects: Array<{
    effectClass:
      | 'none'
      | 'local_reversible'
      | 'local_destructive'
      | 'external_reversible'
      | 'external_irreversible';
    resourceKey: string;
    description: string;
    reversible: boolean;
    verificationRequired?: boolean;
  }>;
  policyDecision: {
    decision: 'allowed' | 'confirmation_required' | 'denied';
    rule: string;
    conditions?: string[];
    expiresAt?: string;
  };
  confirmationRequirement: null | {
    confirmationId: string;
    reason: string;
    prompt: string;
    scope: 'once' | 'execution';
    expiresAt?: string;
  };
  recoveryClass:
    'read_only_replayable' | 'idempotent' | 'effect_checked' | 'non_resumable';
  idempotencyKey: string | null;
  requiredCapabilities: string[];
  deadline: string;
  preparedAt: string;
}
