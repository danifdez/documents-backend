import { WorkerRegistrationView } from '../worker/worker-registration.types';

export interface ExecutionOperationalCheck {
  observedMs: number;
  thresholdMs: number;
  status: 'ok' | 'degraded';
}

export interface ExecutionOperationalSnapshot {
  schemaVersion: 'execution-operations/1';
  generatedAt: string;
  state: 'operational' | 'degraded';
  queue: {
    ready: number;
    running: number;
    blocked: number;
    overdueDeadlines: number;
    oldestReadyMs: number;
  };
  attempts: {
    leased: number;
    running: number;
    resultReceived: number;
    expiredActiveLeases: number;
    oldestReceivedMs: number;
  };
  workers: {
    online: number;
    offline: number;
    revoked: number;
    maximumConcurrency: number;
    activeAssignments: number;
    availableConcurrency: number;
  };
  registrations: WorkerRegistrationView[];
  publication: {
    pending: number;
    publishing: number;
    expiredPublishingLeases: number;
    oldestUnpublishedMs: number;
  };
  recovery: {
    staleFinalizations: number;
    staleEffects: number;
    inconclusiveEffects: number;
    expiredConfirmations: number;
  };
  artifacts: {
    active: number;
    unavailable: number;
    expiredButActive: number;
    activeBytes: number;
    largestActiveBytes: number;
  };
  slo: {
    readyQueue: ExecutionOperationalCheck;
    resultCoordination: ExecutionOperationalCheck;
    publication: ExecutionOperationalCheck;
  };
}

export interface ExecutionReconciliationResult {
  schemaVersion: 'execution-reconciliation/1';
  reconciledAt: string;
  limit: number;
  recoveredEffects: number;
  expiredAttempts: number;
  expiredConfirmations: number;
  recoveredFinalizations: number;
  acceptedResults: number;
  finalizedExecutions: number;
  publishedNotifications: number;
  offlinedWorkers: number;
  expiredArtifacts: number;
  stateAfter: ExecutionOperationalSnapshot;
}
