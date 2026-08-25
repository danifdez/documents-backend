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
        documentsRevision: 'unknown',
        promptPackages: [],
        toolVersions: [],
        modelFingerprints: [],
        adapterFingerprints: [],
      },
    );

    expect(missing).toEqual([
      'artifact.artifact-1.body',
      'environment.adapterFingerprints',
      'environment.documentsRevision',
      'environment.modelFingerprints',
      'environment.promptPackages',
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
          inference: { effectiveModel: 'model-b', effectiveAdapter: null },
        },
      },
      {
        operationId: 'inference-2',
        result: {
          inference: {
            effectiveModel: 'model-a',
            effectiveAdapter: 'adapter-a',
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
      modelIdentityKnown: true,
      adapterIdentityKnown: true,
    });
  });
});
