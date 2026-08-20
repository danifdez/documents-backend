export type ProgressCounter = {
  started: number;
  finished: number;
  unfinished: number;
  failed: number;
};

export type ProgressTokenUsage = {
  known: boolean;
  total: number;
  unknownOperations: number;
};

export type ProgressLedger = {
  version: '1';
  lastSequence: number;
  operations: {
    inference: ProgressCounter;
    tool_call: ProgressCounter;
  };
  inferencePhases: Record<string, ProgressCounter>;
  loops: Record<
    string,
    {
      agentName: string;
      loopKind: string;
      maxRounds: number;
      operations: {
        inference: ProgressCounter;
        tool_call: ProgressCounter;
      };
      inferencePhases: Record<string, ProgressCounter>;
    }
  >;
  promptTokens: ProgressTokenUsage;
  generatedTokens: ProgressTokenUsage;
  completeness: 'complete' | 'partial';
};

export type ProgressPolicyProjection = {
  version: '1';
  loops: Record<string, Record<string, unknown>>;
};

export type ProgressEvent = {
  sequence?: string | number;
  eventType: string;
  operationId?: string | null;
  attemptId?: string | null;
  payload: Record<string, unknown>;
};

const INFERENCE_PHASES = new Set([
  'direct_response',
  'agent_loop',
  'output_repair',
  'forced_finalization',
  'structured_output_repair',
  'memory_extraction',
]);

function counter(): ProgressCounter {
  return { started: 0, finished: 0, unfinished: 0, failed: 0 };
}

function tokenUsage(): ProgressTokenUsage {
  return { known: true, total: 0, unknownOperations: 0 };
}

function operationKey(event: ProgressEvent): string {
  return `${String(event.operationId ?? '')}:${String(event.attemptId ?? '')}`;
}

function inferencePhase(payload: Record<string, unknown>): string {
  const explicit = String(payload.phase ?? '');
  if (INFERENCE_PHASES.has(explicit)) return explicit;
  const name = String(payload.name ?? '');
  if (name === 'output_repair') return 'output_repair';
  if (name === 'forced_finalization') return 'forced_finalization';
  if (name === 'memory_extraction') return 'memory_extraction';
  if (name === 'structured_output_repair') return 'structured_output_repair';
  if (name === 'chat_with_tools') return 'agent_loop';
  return 'direct_response';
}

function consumeTokens(usage: ProgressTokenUsage, value: unknown): void {
  if (Number.isInteger(value) && Number(value) >= 0) {
    usage.total += Number(value);
    return;
  }
  usage.known = false;
  usage.unknownOperations += 1;
}

function recordStarted(counters: ProgressCounter[]): void {
  for (const value of counters) {
    value.started += 1;
    value.unfinished += 1;
  }
}

function recordFinished(
  counters: ProgressCounter[],
  failed: boolean,
): void {
  for (const value of counters) {
    value.finished += 1;
    value.unfinished = Math.max(0, value.unfinished - 1);
    if (failed) value.failed += 1;
  }
}

export function projectExecutionProgress(events: ProgressEvent[]): {
  policy: ProgressPolicyProjection | null;
  ledger: ProgressLedger;
} {
  const ledger: ProgressLedger = {
    version: '1',
    lastSequence: 0,
    operations: { inference: counter(), tool_call: counter() },
    inferencePhases: {},
    loops: {},
    promptTokens: tokenUsage(),
    generatedTokens: tokenUsage(),
    completeness: 'complete',
  };
  const policy: ProgressPolicyProjection = { version: '1', loops: {} };
  const starts = new Map<
    string,
    {
      operationKind: 'inference' | 'tool_call';
      phase?: string;
      loopId?: string;
    }
  >();

  for (const event of events) {
    ledger.lastSequence = Math.max(
      ledger.lastSequence,
      Number(event.sequence ?? 0),
    );
    if (
      event.eventType === 'progress.reported' &&
      event.payload.kind === 'policy_snapshot'
    ) {
      const snapshot = event.payload.policy;
      if (snapshot && typeof snapshot === 'object') {
        const value = snapshot as Record<string, unknown>;
        const loopId = String(value.loopId ?? '');
        if (loopId) policy.loops[loopId] = structuredClone(value);
      }
      continue;
    }
    const kind = event.payload.operationKind;
    if (kind !== 'inference' && kind !== 'tool_call') continue;
    const operationKind = kind as 'inference' | 'tool_call';
    const key = operationKey(event);
    if (event.eventType === 'operation.started') {
      const phase =
        operationKind === 'inference'
          ? inferencePhase(event.payload)
          : undefined;
      const loopId = event.payload.loopId
        ? String(event.payload.loopId)
        : undefined;
      starts.set(key, { operationKind, phase, loopId });
      const counters = [ledger.operations[operationKind]];
      if (phase) {
        ledger.inferencePhases[phase] ??= counter();
        counters.push(ledger.inferencePhases[phase]);
      }
      if (loopId) {
        const loop = (ledger.loops[loopId] ??= {
          agentName: String(event.payload.agentName),
          loopKind: String(event.payload.loopKind),
          maxRounds: Number(event.payload.maxRounds),
          operations: { inference: counter(), tool_call: counter() },
          inferencePhases: {},
        });
        counters.push(loop.operations[operationKind]);
        if (phase) {
          loop.inferencePhases[phase] ??= counter();
          counters.push(loop.inferencePhases[phase]);
        }
      }
      recordStarted(counters);
      continue;
    }
    if (event.eventType !== 'operation.finished') continue;
    const start = starts.get(key);
    if (!start) continue;
    const counters = [ledger.operations[start.operationKind]];
    if (start.phase) {
      counters.push(ledger.inferencePhases[start.phase]);
    }
    if (start.loopId) {
      const loop = ledger.loops[start.loopId];
      counters.push(loop.operations[start.operationKind]);
      if (start.phase) {
        counters.push(loop.inferencePhases[start.phase]);
      }
    }
    recordFinished(counters, event.payload.status === 'failed');
    if (start.operationKind === 'inference') {
      const metrics =
        event.payload.metrics && typeof event.payload.metrics === 'object'
          ? (event.payload.metrics as Record<string, unknown>)
          : {};
      consumeTokens(ledger.promptTokens, metrics.promptTokens);
      consumeTokens(ledger.generatedTokens, metrics.generatedTokens);
    }
  }

  ledger.completeness = Object.values(ledger.operations).some(
    (value) => value.unfinished > 0,
  )
    ? 'partial'
    : 'complete';
  return {
    policy: Object.keys(policy.loops).length ? policy : null,
    ledger,
  };
}
