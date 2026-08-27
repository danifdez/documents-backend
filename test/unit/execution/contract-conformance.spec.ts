import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { createHash } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { EXECUTION_CONTRACT_SET_HASH } from '../../../src/execution/execution.constants';

const root = resolve(__dirname, '../../../contracts/execution/v1');
const schemasRoot = join(root, 'schemas');
const fixturesRoot = resolve(
  __dirname,
  '../../contracts/execution/v1/fixtures',
);
const protocolFixturesRoot = join(fixturesRoot, 'protocol');

const readJson = (path: string): any => JSON.parse(readFileSync(path, 'utf8'));
const sha256 = (value: Buffer | string) =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

function canonicalValue(value: any): any {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  if (typeof value === 'number' && !Number.isInteger(value)) {
    throw new Error('floats are outside the canonical profile');
  }
  return value;
}

const canonicalHash = (value: any) =>
  sha256(JSON.stringify(canonicalValue(value)));

function schemaPaths(path = schemasRoot): string[] {
  return readdirSync(path, { withFileTypes: true })
    .flatMap((entry) => {
      const child = join(path, entry.name);
      return entry.isDirectory()
        ? schemaPaths(child)
        : entry.name.endsWith('.json')
          ? [child]
          : [];
    })
    .sort();
}

function verifyManifest(): string {
  const entries = schemaPaths().map((path) => ({
    path: path.slice(root.length + 1).replaceAll('\\', '/'),
    sha256: sha256(readFileSync(path)),
  }));
  const lines = entries
    .map((entry) => `${entry.path}\0${entry.sha256}\n`)
    .join('');
  const expected = {
    manifestSchema: 'execution-contract-manifest/1',
    contractVersion: 'v1',
    contractSetHash: sha256(lines),
    schemas: entries,
  };
  expect(readJson(join(root, 'schema-manifest.json'))).toEqual(expected);
  return expected.contractSetHash;
}

function applyMutations(value: any, mutations: any[]): any {
  const result = structuredClone(value);
  for (const mutation of mutations) {
    const parts = mutation.path
      .slice(1)
      .split('/')
      .map((part: string) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
    const key = parts.pop()!;
    const parent = parts.reduce(
      (current: any, part: string) =>
        current[Array.isArray(current) ? Number(part) : part],
      result,
    );
    if (mutation.op === 'remove') {
      if (Array.isArray(parent)) {
        parent.splice(Number(key), 1);
      } else {
        delete parent[key];
      }
    } else if (mutation.op === 'replace' || mutation.op === 'add') {
      parent[Array.isArray(parent) ? Number(key) : key] = mutation.value;
    } else {
      throw new Error(`unsupported mutation ${mutation.op}`);
    }
  }
  return result;
}

function assertInvariants(
  bundle: any,
  bundlePath: string,
  contractHash: string,
): void {
  const events = bundle.events;
  const artifacts = new Map(
    bundle.artifacts.map((item: any) => [item.artifactId, item]),
  );
  const eventIds = new Set<string>();
  const producers = new Map<string, number>();
  const operations = new Map<string, any>();
  const finished = new Set<string>();
  const expectedSequences = Array.from(
    {
      length:
        bundle.eventRange.lastSequence - bundle.eventRange.firstSequence + 1,
    },
    (_, index) => bundle.eventRange.firstSequence + index,
  );
  expect(events.map((event: any) => event.sequence)).toEqual(expectedSequences);

  for (const event of events) {
    expect(event.rootExecutionId).toBe(bundle.rootExecutionId);
    if (event.causedByEventId)
      expect(eventIds.has(event.causedByEventId)).toBe(true);
    eventIds.add(event.eventId);
    const producerKey = `${event.producer.component}\0${event.producer.instanceId}`;
    expect(event.producerSequence).toBeGreaterThan(
      producers.get(producerKey) ?? 0,
    );
    producers.set(producerKey, event.producerSequence);
    for (const artifactId of event.artifactRefs)
      expect(artifacts.has(artifactId)).toBe(true);
    const { contentHash, ...withoutHash } = event;
    expect(contentHash).toBe(canonicalHash(withoutHash));
    const operationKey = `${event.operationId}\0${event.attemptId}`;
    if (event.eventType === 'operation.started')
      operations.set(operationKey, event);
    if (event.eventType === 'operation.finished') {
      expect(operations.has(operationKey)).toBe(true);
      expect(finished.has(operationKey)).toBe(false);
      expect(operations.get(operationKey).payload.operationKind).toBe(
        event.payload.operationKind,
      );
      finished.add(operationKey);
    }
  }

  const required = new Set([
    'execution.created',
    'execution.state_changed',
    'operation.started',
    'operation.finished',
    'message.recorded',
    'source.observed',
  ]);
  for (const event of events) required.delete(event.eventType);
  expect([...required]).toEqual([]);
  if (bundle.bundleCompleteness.status === 'reproducible') {
    expect([...operations.keys()].filter((key) => !finished.has(key))).toEqual(
      [],
    );
  }
  const terminal = events.filter(
    (event: any) =>
      event.eventType === 'execution.state_changed' &&
      ['completed', 'failed', 'cancelled'].includes(event.payload.to),
  );
  expect(terminal).toHaveLength(1);
  const terminalIndex = events.indexOf(terminal[0]);
  expect(
    events
      .slice(terminalIndex + 1)
      .every((event: any) =>
        ['source.withdrawn', 'artifact.withdrawn', 'artifact.expired'].includes(
          event.eventType,
        ),
      ),
  ).toBe(true);

  for (const artifact of bundle.artifacts) {
    if (!artifact.bundlePath) continue;
    const body = readFileSync(resolve(bundlePath, '..', artifact.bundlePath));
    expect(artifact.size).toBe(body.length);
    expect(artifact.contentHash).toBe(sha256(body));
  }
  expect(bundle.integrity.schemaManifestHash).toBe(contractHash);
  expect(bundle.integrity.eventsHash).toBe(canonicalHash(events));
  const { manifestHash, ...withoutManifestHash } = bundle;
  expect(manifestHash).toBe(canonicalHash(withoutManifestHash));
}

function validateProtocolFixture(ajv: Ajv2020, fixture: any): string | null {
  const records = new Map<string, any>();
  for (const record of fixture.records ?? []) {
    const validateRecord = ajv.getSchema(record.schemaId);
    if (!validateRecord || !validateRecord(record.instance)) {
      const unsupportedVersion = validateRecord?.errors?.some(
        (error) =>
          error.instancePath === '/schemaVersion' && error.keyword === 'const',
      );
      return unsupportedVersion
        ? 'unsupported_schema_version'
        : 'invalid_contract';
    }
    records.set(record.schemaId, record.instance);
  }

  const schema = (name: string) =>
    records.get(`https://documents.local/harness/v1/schemas/${name}`);
  const execution = schema('execution.schema.json');
  const step = schema('step.schema.json');
  const attempt = schema('step-attempt.schema.json');
  const assignment = schema('step-assignment.schema.json');
  const result = schema('step-result.schema.json');
  const ack = schema('step-result-ack.schema.json');
  const toolInvocation = schema('tool-invocation.schema.json');
  const toolPlan = schema('tool-plan.schema.json');
  const toolResult = schema('tool-result.schema.json');
  if (!execution || !step || !attempt || !assignment || !result || !ack)
    return 'invalid_contract';

  const terminalAttempt = ['expired', 'cancelled', 'failed', 'closed'].includes(
    attempt.status,
  );
  const attemptIsCurrent = step.currentAttemptId === attempt.attemptId;
  const attemptIsFenced =
    terminalAttempt &&
    !('currentAttemptId' in step) &&
    !['running', 'result_received'].includes(step.status);
  if (
    (!execution.parentExecutionId &&
      execution.rootExecutionId !== execution.executionId) ||
    step.executionId !== execution.executionId ||
    (!attemptIsCurrent && !attemptIsFenced)
  )
    return 'invalid_protocol_identity';

  const identityFields = ['executionId', 'stepId', 'operationId', 'attemptId'];
  for (const field of identityFields) {
    const expected = assignment[field];
    for (const record of [attempt, result, ack]) {
      if (record[field] !== expected) return 'invalid_protocol_identity';
    }
  }
  if (
    step.stepId !== assignment.stepId ||
    step.operationId !== assignment.operationId ||
    step.stepKind !== assignment.stepKind ||
    result.stepKind !== assignment.stepKind
  )
    return 'invalid_protocol_identity';

  const toolRecords = [toolInvocation, toolPlan, toolResult];
  if (toolRecords.some(Boolean) && !toolRecords.every(Boolean))
    return 'invalid_contract';
  if (
    toolInvocation &&
    (toolInvocation.executionContext.executionId !== execution.executionId ||
      toolInvocation.toolCallId !== toolPlan.toolCallId ||
      toolPlan.toolCallId !== toolResult.toolCallId ||
      toolPlan.operationId !== toolResult.operationId ||
      toolInvocation.name !== toolPlan.toolName)
  )
    return 'invalid_protocol_identity';

  return null;
}

const browserMutationCases = [
  {
    name: 'browser.navigate',
    capability: 'tool.browser.navigate/1',
    effectClass: 'external_reversible',
    reversible: true,
    arguments: {
      url: 'https://example.test/next',
      expectedCurrentUrl: 'https://example.test/current',
    },
  },
  {
    name: 'browser.go_back',
    capability: 'tool.browser.go_back/1',
    effectClass: 'external_reversible',
    reversible: true,
    arguments: { expectedCurrentUrl: 'https://example.test/current' },
  },
  {
    name: 'browser.click',
    capability: 'tool.browser.click/1',
    effectClass: 'external_irreversible',
    reversible: false,
    arguments: {
      expectedCurrentUrl: 'https://example.test/current',
      elementIndex: 2,
      expectedKind: 'button',
      expectedLabel: 'Continue',
    },
  },
  {
    name: 'browser.type_text',
    capability: 'tool.browser.type_text/1',
    effectClass: 'external_irreversible',
    reversible: false,
    arguments: {
      expectedCurrentUrl: 'https://example.test/current',
      elementIndex: 3,
      expectedLabel: 'Search',
      expectedCurrentValue: '',
      expectedCurrentValueTruncated: false,
      text: 'harness',
    },
  },
  {
    name: 'browser.select_option',
    capability: 'tool.browser.select_option/1',
    effectClass: 'external_irreversible',
    reversible: false,
    arguments: {
      expectedCurrentUrl: 'https://example.test/current',
      elementIndex: 4,
      expectedLabel: 'Environment',
      expectedCurrentValue: 'dev',
      expectedCurrentValueTruncated: false,
      optionValue: 'prod',
      expectedOptionLabel: 'Production',
    },
  },
] as const;

function asBrowserMutationFixture(
  fixture: any,
  mutation: (typeof browserMutationCases)[number],
): any {
  const value = structuredClone(fixture);
  value.scenario = `${value.scenario}-${mutation.name}`;
  for (const record of value.records) {
    const instance = record.instance;
    if (record.schemaId.endsWith('/step.schema.json')) {
      instance.work.taskType = mutation.name;
      instance.work.toolPlan.normalizedArguments = mutation.arguments;
      instance.requiredCapabilities = [mutation.capability];
    }
    if (record.schemaId.endsWith('/step-assignment.schema.json')) {
      instance.work.taskType = mutation.name;
      instance.work.toolPlan.normalizedArguments = mutation.arguments;
    }
    if (record.schemaId.endsWith('/tool-invocation.schema.json')) {
      instance.name = mutation.name;
      instance.arguments = mutation.arguments;
    }
    if (record.schemaId.endsWith('/tool-plan.schema.json')) {
      instance.toolName = mutation.name;
      instance.descriptorVersion = `${mutation.name}/1`;
      instance.normalizedArguments = mutation.arguments;
      instance.effects[0].effectClass = mutation.effectClass;
      instance.effects[0].reversible = mutation.reversible;
      instance.effects[0].description = `Apply ${mutation.name} in IA Browser`;
      instance.policyDecision.rule =
        'paired_browser_mutation_requires_confirmation';
      instance.idempotencyKey = `${mutation.name}:${instance.toolCallId}`;
      instance.requiredCapabilities = [mutation.capability];
    }
    if (record.schemaId.endsWith('/step-result.schema.json')) {
      instance.output.toolResult.effects[0].effectClass = mutation.effectClass;
    }
    if (record.schemaId.endsWith('/tool-result.schema.json')) {
      instance.effects[0].effectClass = mutation.effectClass;
    }
  }
  return value;
}

describe('execution v1 contract', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  for (const path of schemaPaths()) ajv.addSchema(readJson(path));
  const validate = ajv.getSchema(
    'https://documents.local/harness/v1/schemas/execution-bundle.schema.json',
  )!;
  const validateEvent = ajv.getSchema(
    'https://documents.local/harness/v1/schemas/execution-event.schema.json',
  )!;
  const validateStepResult = ajv.getSchema(
    'https://documents.local/harness/v1/schemas/step-result.schema.json',
  )!;
  const validateActiveContext = ajv.getSchema(
    'https://documents.local/harness/v1/schemas/active-context.schema.json',
  )!;
  const validateSkillActivation = ajv.getSchema(
    'https://documents.local/harness/v1/schemas/skill-activation.schema.json',
  )!;
  const validateContextChunkPlan = ajv.getSchema(
    'https://documents.local/harness/v1/schemas/context-chunk-plan.schema.json',
  )!;
  const contractHash = verifyManifest();

  const event = (payload: any, overrides: any = {}) => ({
    schemaVersion: 'execution-event/1',
    eventId: 'event-progress-1',
    rootExecutionId: 'execution-progress-1',
    executionId: 'execution-progress-1',
    sequence: 1,
    producerSequence: 1,
    eventType: 'progress.reported',
    producer: {
      component: 'documents-models',
      instanceId: 'models-test',
      version: 'test',
    },
    actor: { type: 'worker' },
    occurredAt: '2026-08-20T12:00:00Z',
    ingestedAt: '2026-08-20T12:00:00Z',
    payloadSchema: 'progress.reported/1',
    payload,
    artifactRefs: [],
    security: {
      dataClassification: 'workspace',
      purpose: 'evaluation',
      allowedDestinations: ['documents', 'ai-train'],
      redactionApplied: true,
    },
    contentHash: `sha256:${'0'.repeat(64)}`,
    ...overrides,
  });

  it('keeps the runtime adapter pinned to the copied schema set', () => {
    expect(contractHash).toBe(EXECUTION_CONTRACT_SET_HASH);
  });

  it('requires terminal skill activations to carry their finished timestamp', () => {
    const activation = {
      schemaVersion: 'skill-activation/1',
      activationId: '00000000-0000-4000-8000-000000000021',
      executionId: '00000000-0000-4000-8000-000000000022',
      skillId: 'workspace-document-workflow',
      skillVersion: 'workspace-document-workflow/1',
      contentHash:
        'sha256:c755864bb8f6b113ff62c4912c20277bf66e71d37819921de46111a24c7cec91',
      activationReason: 'signal_match',
      inputBindings: {
        owner: { type: 'assistant', id: 1 },
        signal: {
          kind: 'owner_scope_configured',
          scope: 'workspace_folder',
        },
      },
      phase: 'finished',
      checkpoint: null,
      status: 'completed',
      activatedAt: '2026-08-26T10:00:00Z',
      finishedAt: '2026-08-26T10:01:00Z',
    };

    expect(validateSkillActivation(activation)).toBe(true);
    expect(
      validateSkillActivation({
        ...activation,
        inputBindings: {
          ...activation.inputBindings,
          signal: 'workspace_folder_configured',
        },
      }),
    ).toBe(false);
    expect(validateSkillActivation({ ...activation, finishedAt: null })).toBe(
      false,
    );
    const researchActivation = {
      ...activation,
      skillId: 'evidence-research-workflow',
      skillVersion: 'evidence-research-workflow/1',
      contentHash:
        'sha256:902f4eb209b750d9b7a62c8cb9daa297158e45a284a8f857fba3a676dcea8002',
      inputBindings: {
        owner: { type: 'assistant', id: 1 },
        signal: {
          kind: 'capability_available',
          capability: 'documents.search',
        },
      },
    };
    expect(validateSkillActivation(researchActivation)).toBe(true);
    expect(
      validateSkillActivation({
        ...researchActivation,
        skillVersion: 'workspace-document-workflow/1',
      }),
    ).toBe(false);
  });

  it('validates the frozen active context and its continuity capsule', () => {
    const conversation = {
      artifactId: '00000000-0000-4000-8000-000000000011',
      revision: 7,
      contentHash: `sha256:${'a'.repeat(64)}`,
    };
    const capsule = {
      schemaVersion: 'continuity-capsule/1',
      sourceConversation: conversation,
      omittedMessageCount: 2,
      omittedTurnCount: 1,
      roleCounts: { user: 1, assistant: 1 },
      firstOmittedAt: '2026-08-26T10:00:00Z',
      lastOmittedAt: '2026-08-26T10:01:00Z',
      truncatedMessageIds: [],
      digest: 'user [turn old]: Previous request',
    };
    const activeContext = {
      schemaVersion: 'active-context/1',
      artifactId: '00000000-0000-4000-8000-000000000012',
      rootExecutionId: '00000000-0000-4000-8000-000000000013',
      sessionId: '00000000-0000-4000-8000-000000000014',
      turnId: '00000000-0000-4000-8000-000000000015',
      causedByEventId: '00000000-0000-4000-8000-000000000016',
      sourceConversation: conversation,
      layers: {
        stable: { ownerId: 1 },
        contextual: {
          conversation: [{ role: 'user', content: 'Continue' }],
          continuityCapsule: capsule,
          activeMemory: null,
          activeCapabilities: {
            schemaVersion: 'active-capability-set/1',
            owner: { type: 'assistant', id: 1 },
            selectionPolicy: 'backend-signals/1',
            skillSignals: [],
            tools: [
              {
                name: 'documents.search',
                descriptorVersion: 'documents.search/1',
                availabilityBasis: 'core_read',
              },
            ],
            skills: [],
          },
          activeInputReduction: null,
        },
        volatile: {},
      },
      effectivePayload: {
        ownerId: 1,
        conversation: [{ role: 'user', content: 'Continue' }],
        continuityCapsule: capsule,
      },
    };

    expect(validateActiveContext(activeContext)).toBe(true);
    expect(
      validateActiveContext({
        ...activeContext,
        layers: {
          ...activeContext.layers,
          contextual: {
            ...activeContext.layers.contextual,
            activeInputReduction: {
              schemaVersion: 'active-input-reduction/1',
              sourceArtifact: {
                artifactId: '00000000-0000-4000-8000-000000000017',
                contentHash: `sha256:${'b'.repeat(64)}`,
                size: 20000,
              },
              planArtifact: {
                artifactId: '00000000-0000-4000-8000-000000000018',
                contentHash: `sha256:${'c'.repeat(64)}`,
              },
              strategy: 'chunk-map-reduce/1',
              chunkCount: 2,
              digest: 'Complete reduced request',
            },
          },
        },
      }),
    ).toBe(true);
    expect(
      validateActiveContext({
        ...activeContext,
        schemaVersion: 'active-context/2',
      }),
    ).toBe(false);
  });

  it('validates a deterministic chunk plan for oversized input', () => {
    expect(
      validateContextChunkPlan({
        schemaVersion: 'context-chunk-plan/1',
        sourceArtifact: {
          artifactId: '00000000-0000-4000-8000-000000000017',
          contentHash: `sha256:${'b'.repeat(64)}`,
          size: 20000,
        },
        algorithm: 'deterministic-text-boundaries/1',
        offsetUnit: 'utf16-code-unit',
        maxChunkChars: 12000,
        reductionFanIn: 8,
        chunks: [
          {
            index: 0,
            start: 0,
            end: 12000,
            contentHash: `sha256:${'c'.repeat(64)}`,
          },
          {
            index: 1,
            start: 12000,
            end: 20000,
            contentHash: `sha256:${'d'.repeat(64)}`,
          },
        ],
      }),
    ).toBe(true);
  });

  it('requires the canonical ToolResult inside every tool StepResult', () => {
    const result = {
      schemaVersion: 'step-result/1',
      executionId: '00000000-0000-4000-8000-000000000001',
      stepId: '00000000-0000-4000-8000-000000000002',
      operationId: '00000000-0000-4000-8000-000000000003',
      attemptId: '00000000-0000-4000-8000-000000000004',
      stepKind: 'tool',
      status: 'succeeded',
      runtimeFingerprint: `sha256:${'a'.repeat(64)}`,
      output: {
        kind: 'tool',
        toolResult: {
          schemaVersion: 'tool-result/1',
          operationId: '00000000-0000-4000-8000-000000000003',
          toolCallId: '00000000-0000-4000-8000-000000000005',
          status: 'succeeded',
          content: 'One match',
          structuredContent: { count: 1 },
          artifactRefs: [],
          sourceRefs: [],
          effects: [],
          error: null,
        },
      },
      artifactRefs: [],
      error: null,
    };

    expect(validateStepResult(result)).toBe(true);
    expect(
      validateStepResult({
        ...result,
        output: { kind: 'tool' },
      }),
    ).toBe(false);
  });

  it.each(
    readdirSync(join(protocolFixturesRoot, 'valid'))
      .sort()
      .map((name) => [name]),
  )('accepts shared step protocol fixture %s', (name) => {
    const fixture = readJson(join(protocolFixturesRoot, 'valid', name));
    expect(validateProtocolFixture(ajv, fixture)).toBeNull();
  });

  it.each(
    [
      'browser-effect-cancelled-before-apply.json',
      'browser-effect-duplicate-ack.json',
      'browser-effect-expired-lease.json',
    ].flatMap((fixtureName) =>
      browserMutationCases.map((mutation) => [fixtureName, mutation] as const),
    ),
  )(
    'accepts %s projected onto %s and its effect class',
    (fixtureName, mutation) => {
      const fixture = asBrowserMutationFixture(
        readJson(join(protocolFixturesRoot, 'valid', fixtureName)),
        mutation,
      );
      expect(validateProtocolFixture(ajv, fixture)).toBeNull();
    },
  );

  it.each(
    readdirSync(join(protocolFixturesRoot, 'invalid'))
      .sort()
      .map((name) => [name]),
  )('rejects shared step protocol fixture %s with its stable code', (name) => {
    const path = join(protocolFixturesRoot, 'invalid', name);
    const fixture = readJson(path);
    const base = resolve(protocolFixturesRoot, 'invalid', fixture.base);
    const value = applyMutations(readJson(base), fixture.mutations);
    expect(validateProtocolFixture(ajv, value)).toBe(fixture.expectedError);
  });

  it('accepts only bounded leaf summaries on successful tool operations', () => {
    const payload = {
      operationKind: 'tool_call',
      status: 'succeeded',
      result: { summary: '3 matching documents found' },
      error: null,
      resultSummary: '3 matching documents found',
      resultSummaryKind: 'leaf_tool',
    };
    const finishedEvent = (value: any) =>
      event(value, {
        eventType: 'operation.finished',
        payloadSchema: 'operation.finished/1',
        operationId: '00000000-0000-4000-8000-000000000010',
        attemptId: '00000000-0000-4000-8000-000000000011',
        toolCallId: '00000000-0000-4000-8000-000000000012',
      });

    expect(validateEvent(finishedEvent(payload))).toBe(true);
    expect(
      validateEvent(finishedEvent({ ...payload, resultSummary: '' })),
    ).toBe(false);
    expect(
      validateEvent(
        finishedEvent({ ...payload, resultSummary: 'x'.repeat(201) }),
      ),
    ).toBe(false);
    expect(
      validateEvent(
        finishedEvent({ ...payload, resultSummaryKind: 'model_summary' }),
      ),
    ).toBe(false);
    expect(validateEvent(finishedEvent({ ...payload, status: 'failed' }))).toBe(
      false,
    );
  });

  it('requires a successful partial result for runtime-authored completion', () => {
    const payload = {
      from: 'running',
      to: 'completed',
      completionKind: 'partial',
      completionReason: 'partial_budget_exhausted',
      completionSource: 'runtime_template',
      partialResult: {
        version: '1',
        trigger: 'closing_output_empty',
        loopId: '00000000-0000-4000-8000-000000000020',
        grantId: '00000000-0000-4000-8000-000000000021',
        completedOperations: [
          {
            operationId: '00000000-0000-4000-8000-000000000023',
            toolCallId: '00000000-0000-4000-8000-000000000024',
            name: 'workspace_research',
            summary: '3 matching documents found',
          },
        ],
        pending: ['final_synthesis'],
      },
      result: { reply: 'Completed work: 3 matching documents found' },
      error: null,
    };
    const terminalEvent = (value: any) =>
      event(value, {
        eventType: 'execution.state_changed',
        payloadSchema: 'execution.state_changed/1',
      });

    expect(validateEvent(terminalEvent(payload))).toBe(true);
    expect(
      validateEvent(terminalEvent({ ...payload, completionKind: 'full' })),
    ).toBe(false);
    expect(
      validateEvent(
        terminalEvent({
          ...payload,
          partialResult: {
            ...payload.partialResult,
            trigger: 'provider_error',
          },
        }),
      ),
    ).toBe(false);
    expect(
      validateEvent(
        terminalEvent({
          ...payload,
          to: 'failed',
          error: { code: 'failed', message: 'failed' },
        }),
      ),
    ).toBe(false);
    const loopPartial = {
      ...payload,
      completionReason: 'partial_loop_guard',
      partialResult: {
        ...payload.partialResult,
        trigger: 'exact_tool_repeat_persisted',
        pending: ['strategy_change'],
        continuation: {
          kind: 'new_turn',
          reason: 'different_strategy_required',
        },
      },
    };
    expect(validateEvent(terminalEvent(loopPartial))).toBe(true);
    expect(
      validateEvent(
        terminalEvent({
          ...loopPartial,
          partialResult: {
            ...loopPartial.partialResult,
            pending: ['final_synthesis'],
          },
        }),
      ),
    ).toBe(false);
  });

  it('accepts a policy snapshot and rejects negative limits', () => {
    const payload = {
      message: 'Effective progress policy recorded',
      kind: 'policy_snapshot',
      policy: {
        version: '1',
        source: 'models.task_config',
        loopId: 'loop-progress-1',
        agentName: 'assistant',
        loopKind: 'top_level',
        maxRounds: 3,
        normalInferenceSoftLimit: 2,
        maxOutputRepairs: 1,
        forcedFinalizationAvailable: true,
        maxTokensPerInference: 1000,
        maxToolCalls: 6,
      },
    };
    expect(validateEvent(event(payload))).toBe(true);
    expect(
      validateEvent(
        event({
          ...payload,
          policy: { ...payload.policy, maxRounds: -1 },
        }),
      ),
    ).toBe(false);
    expect(
      validateEvent(
        event({
          ...payload,
          policy: { ...payload.policy, normalInferenceSoftLimit: -1 },
        }),
      ),
    ).toBe(false);
  });

  it('accepts an unknown token total and rejects a negative ledger counter', () => {
    const zero = { started: 0, finished: 0, unfinished: 0, failed: 0 };
    const payload = {
      message: 'Durable progress ledger recorded',
      kind: 'ledger_snapshot',
      ledger: {
        version: '1',
        lastSequence: 4,
        operations: {
          inference: { started: 1, finished: 1, unfinished: 0, failed: 0 },
          tool_call: zero,
        },
        inferencePhases: {
          direct_response: {
            started: 1,
            finished: 1,
            unfinished: 0,
            failed: 0,
          },
        },
        loops: {},
        promptTokens: { known: false, total: 0, unknownOperations: 1 },
        generatedTokens: { known: false, total: 0, unknownOperations: 1 },
        completeness: 'complete',
      },
    };
    expect(validateEvent(event(payload))).toBe(true);
    expect(
      validateEvent(
        event({
          ...payload,
          ledger: {
            ...payload.ledger,
            operations: {
              ...payload.ledger.operations,
              tool_call: { ...zero, unfinished: -1 },
            },
          },
        }),
      ),
    ).toBe(false);
  });

  it('accepts authoritative grants and rejects invalid reservations', () => {
    const grant = {
      version: '1',
      grantId: 'grant-progress-1',
      executionId: 'execution-progress-1',
      turnId: 'turn-progress-1',
      loopId: 'loop-progress-1',
      profileId: 'documents_chat_v1',
      policyVersion: '1',
      requestedPolicy: {
        normal: 3,
        normalInferenceSoftLimit: 2,
        repair: 1,
        closing: 1,
        maxTokensPerInference: 1000,
        toolCalls: 6,
        toolCallSoftLimit: 4,
        exactToolRepeatWarning: true,
        exactToolRepeatBlockAfterWarning: true,
        exactToolRepeatTerminateAfterBlock: true,
      },
      effectivePolicy: {
        normal: 2,
        normalInferenceSoftLimit: 1,
        repair: 1,
        closing: 1,
        maxTokensPerInference: 512,
        toolCalls: 2,
        toolCallSoftLimit: 1,
        exactToolRepeatWarning: true,
        exactToolRepeatBlockAfterWarning: true,
        exactToolRepeatTerminateAfterBlock: true,
      },
      grantedAt: '2026-08-20T10:00:00Z',
    };
    expect(
      validateEvent(
        event({
          message: 'Authoritative inference budget granted',
          kind: 'budget_grant',
          grant,
        }),
      ),
    ).toBe(true);
    const historicalGrant = structuredClone(grant);
    delete (historicalGrant.requestedPolicy as { toolCalls?: number })
      .toolCalls;
    delete (historicalGrant.effectivePolicy as { toolCalls?: number })
      .toolCalls;
    delete (
      historicalGrant.requestedPolicy as {
        normalInferenceSoftLimit?: number;
      }
    ).normalInferenceSoftLimit;
    delete (
      historicalGrant.effectivePolicy as {
        normalInferenceSoftLimit?: number;
      }
    ).normalInferenceSoftLimit;
    expect(
      validateEvent(
        event({
          message: 'Historical inference budget granted',
          kind: 'budget_grant',
          grant: historicalGrant,
        }),
      ),
    ).toBe(true);
    const reservation = {
      version: '1',
      reservationId: 'reservation-progress-1',
      grantId: grant.grantId,
      operationId: 'operation-progress-1',
      bucket: 'closing',
      phase: 'forced_finalization',
      round: 2,
      name: 'forced_finalization',
      status: 'reserved',
      decidedAt: '2026-08-20T10:00:01Z',
    };
    const toolReservation = {
      ...reservation,
      reservationId: 'reservation-progress-tool-1',
      operationId: 'operation-progress-tool-1',
      operationKind: 'tool_call',
      bucket: 'tool',
      toolCallId: 'tool-call-progress-1',
      phase: 'agent_loop',
      round: 1,
      name: 'folder_read',
      operationFingerprint: `sha256:${'a'.repeat(64)}`,
      operationFingerprintVersion: 'canonical_tool_input_v1',
      toolBatchSize: 1,
      toolBatchIndex: 0,
    };
    expect(
      validateEvent(
        event({
          message: 'Tool budget reserved',
          kind: 'budget_reservation',
          reservation: toolReservation,
        }),
      ),
    ).toBe(true);
    const loopGuardSignal = {
      version: '1',
      guardKind: 'immediate_exact_tool_repeat',
      action: 'warn',
      grantId: grant.grantId,
      loopId: grant.loopId,
      previousOperationId: 'operation-progress-tool-0',
      triggeringOperationId: toolReservation.operationId,
      operationFingerprint: toolReservation.operationFingerprint,
      operationFingerprintVersion: 'canonical_tool_input_v1',
      decidedAt: '2026-08-20T10:00:02Z',
    };
    expect(
      validateEvent(
        event({
          message: 'Immediate exact tool repeat detected',
          kind: 'loop_guard_triggered',
          loopGuardSignal,
        }),
      ),
    ).toBe(true);
    expect(
      validateEvent(
        event({
          message: 'Invalid fingerprint version',
          kind: 'loop_guard_triggered',
          loopGuardSignal: {
            ...loopGuardSignal,
            operationFingerprintVersion: 'unknown',
          },
        }),
      ),
    ).toBe(false);
    const blockSignal = {
      ...loopGuardSignal,
      action: 'block',
      triggeringOperationId: 'operation-progress-tool-2',
      warningAppliedToOperationId: 'operation-progress-inference-1',
      resultFingerprint: `sha256:${'b'.repeat(64)}`,
      resultFingerprintVersion: 'tool_output_content_hash_v1',
    };
    expect(
      validateEvent(
        event({
          message: 'Immediate exact tool repeat blocked',
          kind: 'loop_guard_triggered',
          loopGuardSignal: blockSignal,
        }),
      ),
    ).toBe(true);
    const terminateSignal = {
      ...blockSignal,
      action: 'terminate',
      blockedOperationId: blockSignal.triggeringOperationId,
      triggeringOperationId: 'operation-progress-tool-3',
      blockResultAppliedToOperationId: 'operation-progress-inference-2',
    };
    expect(
      validateEvent(
        event({
          message: 'Immediate exact tool repeat persisted',
          kind: 'loop_guard_triggered',
          loopGuardSignal: terminateSignal,
        }),
      ),
    ).toBe(true);
    const terminateWithoutApplication = structuredClone(terminateSignal);
    delete (
      terminateWithoutApplication as {
        blockResultAppliedToOperationId?: string;
      }
    ).blockResultAppliedToOperationId;
    expect(
      validateEvent(
        event({
          message: 'Invalid termination without application',
          kind: 'loop_guard_triggered',
          loopGuardSignal: terminateWithoutApplication,
        }),
      ),
    ).toBe(false);
    const blockWithoutEvidence = structuredClone(blockSignal);
    delete (blockWithoutEvidence as { resultFingerprint?: string })
      .resultFingerprint;
    expect(
      validateEvent(
        event({
          message: 'Invalid block without durable result evidence',
          kind: 'loop_guard_triggered',
          loopGuardSignal: blockWithoutEvidence,
        }),
      ),
    ).toBe(false);
    expect(
      validateEvent(
        event({
          message: 'Invalid warning carrying block-only evidence',
          kind: 'loop_guard_triggered',
          loopGuardSignal: {
            ...loopGuardSignal,
            warningAppliedToOperationId: 'operation-progress-inference-1',
            resultFingerprint: `sha256:${'b'.repeat(64)}`,
            resultFingerprintVersion: 'tool_output_content_hash_v1',
          },
        }),
      ),
    ).toBe(false);
    const softLimitSignal = {
      version: '1',
      grantId: grant.grantId,
      operationKind: 'tool_call',
      bucket: 'tool',
      softLimit: 1,
      hardLimit: 2,
      committed: 1,
      available: 1,
      triggeringOperationId: toolReservation.operationId,
      decidedAt: '2026-08-20T10:00:02Z',
    };
    expect(
      validateEvent(
        event({
          message: 'Tool budget soft limit reached',
          kind: 'budget_soft_limit_reached',
          signal: softLimitSignal,
        }),
      ),
    ).toBe(true);
    expect(
      validateEvent(
        event({
          message: 'Normal inference budget soft limit reached',
          kind: 'budget_soft_limit_reached',
          signal: {
            ...softLimitSignal,
            operationKind: 'inference',
            bucket: 'normal',
          },
        }),
      ),
    ).toBe(true);
    expect(
      validateEvent(
        event({
          message: 'Invalid soft limit signal',
          kind: 'budget_soft_limit_reached',
          signal: { ...softLimitSignal, operationKind: 'inference' },
        }),
      ),
    ).toBe(false);
    expect(
      validateEvent(
        event({
          message: 'Invalid tool bucket',
          kind: 'budget_reservation',
          reservation: { ...toolReservation, bucket: 'normal' },
        }),
      ),
    ).toBe(false);
    expect(
      validateEvent(
        event({
          message: 'Invalid tool phase',
          kind: 'budget_reservation',
          reservation: {
            ...toolReservation,
            phase: 'forced_finalization',
          },
        }),
      ),
    ).toBe(false);
    expect(
      validateEvent(
        event({
          message: 'Inference budget reserved',
          kind: 'budget_reservation',
          reservation,
        }),
      ),
    ).toBe(true);
    expect(
      validateEvent(
        event({
          message: 'Invalid inference tool identity',
          kind: 'budget_reservation',
          reservation: {
            ...reservation,
            operationKind: 'inference',
            toolCallId: 'tool-1',
          },
        }),
      ),
    ).toBe(false);
    expect(
      validateEvent(
        event({
          message: 'Invalid reservation',
          kind: 'budget_reservation',
          reservation: { ...reservation, bucket: 'unknown' },
        }),
      ),
    ).toBe(false);
    expect(
      validateEvent(
        event({
          message: 'Invalid negative grant',
          kind: 'budget_grant',
          grant: {
            ...grant,
            effectivePolicy: { ...grant.effectivePolicy, toolCalls: -1 },
          },
        }),
      ),
    ).toBe(false);
    expect(
      validateEvent(
        event({
          message: 'Invalid extra policy field',
          kind: 'budget_grant',
          grant: {
            ...grant,
            effectivePolicy: { ...grant.effectivePolicy, unlimited: true },
          },
        }),
      ),
    ).toBe(false);
    expect(
      validateEvent(
        event({
          message: 'Inference budget reservation denied',
          kind: 'budget_reservation',
          reservation: {
            ...reservation,
            status: 'denied',
            reason: 'budget_hard_limit_reached',
          },
        }),
      ),
    ).toBe(true);
    const budgetedToolStart = event(
      {
        operationKind: 'tool_call',
        status: 'dispatched',
        name: 'folder_read',
        loopId: 'loop-progress-1',
        agentName: 'assistant',
        loopKind: 'top_level',
        round: 1,
        maxRounds: 2,
        phase: 'agent_loop',
        budgetGrantId: grant.grantId,
        budgetReservationId: toolReservation.reservationId,
        budgetBucket: 'tool',
        operationFingerprint: toolReservation.operationFingerprint,
        operationFingerprintVersion: 'canonical_tool_input_v1',
      },
      {
        eventType: 'operation.started',
        payloadSchema: 'operation.started/1',
        operationId: toolReservation.operationId,
        attemptId: 'attempt-progress-tool-1',
        toolCallId: toolReservation.toolCallId,
      },
    );
    expect(validateEvent(budgetedToolStart)).toBe(true);
    const budgetedNormalStart = event(
      {
        operationKind: 'inference',
        status: 'dispatched',
        name: 'chat_with_tools',
        loopId: 'loop-progress-1',
        agentName: 'assistant',
        loopKind: 'top_level',
        round: 2,
        maxRounds: 3,
        phase: 'agent_loop',
        budgetGrantId: grant.grantId,
        budgetReservationId: 'reservation-progress-normal-1',
        budgetBucket: 'normal',
        budgetSoftLimitWarningApplied: true,
        loopGuardWarningApplied: true,
        loopGuardBlockResultApplied: true,
      },
      {
        eventType: 'operation.started',
        payloadSchema: 'operation.started/1',
        operationId: 'operation-progress-normal-1',
        attemptId: 'attempt-progress-normal-1',
      },
    );
    expect(validateEvent(budgetedNormalStart)).toBe(true);
    expect(
      validateEvent({
        ...budgetedNormalStart,
        payload: {
          ...budgetedNormalStart.payload,
          operationFingerprint: `sha256:${'b'.repeat(64)}`,
          operationFingerprintVersion: 'canonical_tool_input_v1',
        },
      }),
    ).toBe(false);
    expect(
      validateEvent({
        ...budgetedToolStart,
        payload: {
          ...budgetedToolStart.payload,
          budgetSoftLimitWarningApplied: true,
        },
      }),
    ).toBe(false);
    expect(
      validateEvent({
        ...budgetedToolStart,
        payload: {
          ...budgetedToolStart.payload,
          phase: 'forced_finalization',
        },
      }),
    ).toBe(false);
    const toolStartWithoutId = structuredClone(budgetedToolStart);
    delete (toolStartWithoutId as { toolCallId?: string }).toolCallId;
    expect(validateEvent(toolStartWithoutId)).toBe(false);
    expect(
      validateEvent(
        event(
          {
            operationKind: 'inference',
            status: 'dispatched',
            name: 'forced_finalization',
            loopId: 'loop-progress-1',
            agentName: 'assistant',
            loopKind: 'top_level',
            round: 2,
            maxRounds: 2,
            phase: 'forced_finalization',
            budgetGrantId: grant.grantId,
          },
          {
            eventType: 'operation.started',
            payloadSchema: 'operation.started/1',
            operationId: 'operation-progress-2',
            attemptId: 'attempt-progress-2',
          },
        ),
      ),
    ).toBe(false);
  });

  it('rejects unknown inference phases when loop metadata is present', () => {
    expect(
      validateEvent(
        event(
          {
            operationKind: 'inference',
            status: 'dispatched',
            name: 'chat_with_tools',
            loopId: 'loop-progress-1',
            agentName: 'assistant',
            loopKind: 'top_level',
            round: 1,
            maxRounds: 3,
            phase: 'made_up_phase',
          },
          {
            eventType: 'operation.started',
            payloadSchema: 'operation.started/1',
            operationId: 'operation-progress-1',
            attemptId: 'attempt-progress-1',
          },
        ),
      ),
    ).toBe(false);
  });

  it.each([
    'documents-bundle.json',
    'ia-browser-bundle.json',
    'progress-complete-bundle.json',
    'progress-interrupted-bundle.json',
  ])('accepts %s with valid hashes and invariants', (name) => {
    const path = join(fixturesRoot, 'valid', name);
    const bundle = readJson(path);
    if (!validate(bundle)) throw new Error(JSON.stringify(validate.errors));
    assertInvariants(bundle, path, contractHash);
  });

  it.each(readdirSync(join(fixturesRoot, 'invalid')).sort())(
    'rejects %s',
    (name) => {
      const fixture = readJson(join(fixturesRoot, 'invalid', name));
      const basePath = resolve(fixturesRoot, 'invalid', fixture.base);
      const bundle = applyMutations(readJson(basePath), fixture.mutations);
      const schemaValid = validate(bundle);
      if (fixture.expectedFailure === 'schema') expect(schemaValid).toBe(false);
      else {
        if (!schemaValid) throw new Error(JSON.stringify(validate.errors));
        expect(() =>
          assertInvariants(bundle, basePath, contractHash),
        ).toThrow();
      }
    },
  );

  it('ignores an unknown optional field', () => {
    const bundle = readJson(
      join(fixturesRoot, 'valid', 'documents-bundle.json'),
    );
    bundle.optionalExtension = { producerHint: 'future' };
    if (!validate(bundle)) throw new Error(JSON.stringify(validate.errors));
  });
});
