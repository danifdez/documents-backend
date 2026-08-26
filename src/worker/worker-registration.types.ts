import { ExecutionStepKind } from '../execution/execution-step-kind.enum';

export interface EffectiveWorkerCapability {
  schemaVersion: 'worker-capability/1';
  capabilityId: string;
  stepKinds: ExecutionStepKind[];
  taskTypes: string[];
  maxConcurrency: number;
}

export interface WorkerRegistrationView {
  schemaVersion: 'worker-registration/1';
  workerId: string;
  protocolVersion: 'step-protocol/1';
  runtimeVersions: Record<string, string>;
  installedArtifacts: string[];
  effectiveStepCapabilities: EffectiveWorkerCapability[];
  hardware: Record<string, unknown>;
  concurrency: {
    maximum: number;
    available: number;
  };
  activeAssignments: string[];
  heartbeat: string;
  loadSummary: {
    state: 'available' | 'busy' | 'offline';
    active: number;
  };
}
