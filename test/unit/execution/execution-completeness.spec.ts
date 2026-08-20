import { ExecutionService } from '../../../src/execution/execution.service';

describe('ExecutionService bundle completeness', () => {
  const derive = (
    ExecutionService.prototype as unknown as {
      deriveBundleMissingEvidence: (...args: unknown[]) => string[];
    }
  ).deriveBundleMissingEvidence;

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
        modelFingerprint: null,
      },
    );

    expect(missing).toEqual([
      'artifact.artifact-1.body',
      'environment.documentsRevision',
      'environment.modelFingerprint',
      'environment.promptPackages',
      'environment.toolVersions',
      'operation.inference-1.metrics.timeToFirstTokenMs',
      'operation.tool-1.finish',
    ]);
  });
});
