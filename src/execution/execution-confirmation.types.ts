import { ToolPlanContract } from './execution-tool.types';

export type ExecutionConfirmationStatus =
  'pending' | 'approved' | 'denied' | 'expired';

export interface ExecutionConfirmationView {
  schemaVersion: 'confirmation/1';
  confirmationId: string;
  executionId: string;
  operationId: string;
  toolCallId: string;
  planHash: string;
  toolName: string;
  reason: string;
  prompt: string;
  scope: 'once' | 'execution';
  resources: ToolPlanContract['resources'];
  effects: ToolPlanContract['effects'];
  status: ExecutionConfirmationStatus;
  expiresAt: string | null;
  decidedAt: string | null;
}

export interface ExecutionConfirmationEnvelope {
  confirmation: ExecutionConfirmationView;
  ownerId: number | null;
  taskType: string;
}
