import { ExecutionArtifactService } from '../../../src/execution/execution-artifact.service';
import { ExecutionStepStatus } from '../../../src/execution/execution-step-status.enum';

describe('ExecutionArtifactService', () => {
  it('loads ordered JSON outputs referenced by completed steps', async () => {
    const steps = {
      find: jest.fn().mockResolvedValue([
        {
          outputArtifactRefs: [
            { role: 'vector_points', artifactId: 'second', revision: 2 },
            { role: 'vector_points', artifactId: 'first', revision: 1 },
          ],
        },
      ]),
    };
    const artifacts = {
      find: jest.fn().mockResolvedValue([
        {
          artifactId: 'first',
          kind: 'vector_points',
          producedByAttemptId: 'attempt',
          body: null,
        },
        {
          artifactId: 'second',
          kind: 'vector_points',
          producedByAttemptId: 'attempt',
          body: null,
        },
      ]),
    };
    const service = new ExecutionArtifactService(
      steps as any,
      artifacts as any,
      {
        readBody: jest.fn(async (artifact) =>
          Buffer.from(
            artifact.artifactId === 'first'
              ? '{"points":[1]}'
              : '{"points":[2]}',
          ),
        ),
      } as any,
    );

    await expect(
      service.readOutputJson(
        {
          executionId: 'execution',
          rootExecutionId: 'root',
        } as any,
        'vector_points',
        'vector_points',
      ),
    ).resolves.toEqual([{ points: [1] }, { points: [2] }]);
    expect(steps.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          executionId: 'execution',
          status: ExecutionStepStatus.COMPLETED,
        }),
      }),
    );
  });
});
