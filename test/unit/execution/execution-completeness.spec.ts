import { ExecutionService } from '../../../src/execution/execution.service';

describe('ExecutionService bundle completeness', () => {
  const derive = (
    ExecutionService.prototype as unknown as {
      deriveBundleMissingEvidence: (...args: unknown[]) => string[];
    }
  ).deriveBundleMissingEvidence;
  const readIdentities = (
    ExecutionService.prototype as unknown as {
      readInferenceIdentities: (...args: unknown[]) => Promise<unknown>;
    }
  ).readInferenceIdentities;
  const readToolVersions = (
    ExecutionService.prototype as unknown as {
      readToolVersions: (...args: unknown[]) => Promise<unknown>;
    }
  ).readToolVersions;

  it('declares unknown inference evidence, omitted bodies, and open operations', () => {
    const missing = derive(
      { missingEvidence: [] },
      [
        {
          eventType: 'operation.started',
          operationId: 'inference-1',
          attemptId: 'attempt-1',
          payload: { operationKind: 'inference' },
        },
        {
          eventType: 'operation.finished',
          operationId: 'inference-1',
          attemptId: 'attempt-1',
          payload: {
            operationKind: 'inference',
            metrics: { timeToFirstTokenMs: 'unknown' },
          },
        },
        {
          eventType: 'operation.started',
          operationId: 'tool-1',
          attemptId: 'attempt-2',
          payload: { operationKind: 'tool_call' },
        },
      ],
      [{ artifactId: 'artifact-1', body: null }],
      {
        codeFingerprints: [],
        promptPackages: [],
        toolVersions: [],
        modelFingerprints: [],
        adapterFingerprints: [],
        runtimeFingerprints: [],
      },
    );

    expect(missing).toEqual([
      'artifact.artifact-1.body',
      'environment.adapterFingerprints',
      'environment.codeFingerprints',
      'environment.modelFingerprints',
      'environment.promptPackages',
      'environment.runtimeFingerprints',
      'environment.toolVersions',
      'operation.inference-1.metrics.timeToFirstTokenMs',
      'operation.tool-1.finish',
    ]);
  });

  it('collects every persisted model and distinguishes no adapter from unknown', async () => {
    const find = jest.fn().mockResolvedValue([
      {
        operationId: 'inference-1',
        result: {
          codeFingerprint: `sha256:${'c'.repeat(64)}`,
          runtimeFingerprint: `sha256:${'b'.repeat(64)}`,
          inference: {
            effectiveModel: 'model-b',
            effectiveAdapter: null,
            effectivePromptPackages: ['prompt-b'],
          },
        },
      },
      {
        operationId: 'inference-2',
        result: {
          codeFingerprint: `sha256:${'c'.repeat(64)}`,
          runtimeFingerprint: `sha256:${'a'.repeat(64)}`,
          inference: {
            effectiveModel: 'model-a',
            effectiveAdapter: 'adapter-a',
            effectivePromptPackages: ['prompt-a'],
          },
        },
      },
    ]);
    const identities = await readIdentities.call(
      { dataSource: { getRepository: () => ({ find }) } },
      [
        {
          eventType: 'operation.started',
          executionId: 'execution-1',
          operationId: 'inference-1',
          payload: { operationKind: 'inference' },
        },
        {
          eventType: 'operation.started',
          executionId: 'execution-1',
          operationId: 'inference-2',
          payload: { operationKind: 'inference' },
        },
      ],
    );

    expect(identities).toEqual({
      modelFingerprints: ['model-a', 'model-b'],
      adapterFingerprints: ['adapter-a'],
      promptPackages: ['prompt-a', 'prompt-b'],
      codeFingerprints: [`sha256:${'c'.repeat(64)}`],
      runtimeFingerprints: [
        `sha256:${'a'.repeat(64)}`,
        `sha256:${'b'.repeat(64)}`,
      ],
      modelIdentityKnown: true,
      adapterIdentityKnown: true,
      promptIdentityKnown: true,
      codeIdentityKnown: true,
      runtimeIdentityKnown: true,
    });
  });

  it('collects descriptor versions from every persisted tool plan', async () => {
    const find = jest.fn().mockResolvedValue([
      {
        operationId: 'tool-1',
        plan: { descriptorVersion: 'documents.search/1' },
      },
      {
        operationId: 'tool-2',
        plan: { descriptorVersion: 'documents.read/2' },
      },
    ]);
    const identities = await readToolVersions.call(
      { dataSource: { getRepository: () => ({ find }) } },
      [
        {
          eventType: 'operation.started',
          operationId: 'tool-1',
          payload: { operationKind: 'tool_call' },
        },
        {
          eventType: 'operation.started',
          operationId: 'tool-2',
          payload: { operationKind: 'tool_call' },
        },
      ],
    );

    expect(identities).toEqual({
      toolVersions: ['documents.read/2', 'documents.search/1'],
      toolIdentityKnown: true,
    });
  });
});
