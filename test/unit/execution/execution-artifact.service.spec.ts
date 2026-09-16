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
    expect(artifacts.find).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          contentHash: true,
          size: true,
          storageRef: true,
          contentState: true,
          expiresAt: true,
          body: true,
        }),
      }),
    );
  });

  it('resolves the complete derived artifact closure in stable order', async () => {
    const repository = {
      findBy: jest.fn().mockResolvedValue([
        {
          artifactId: 'artifact-c',
          derivedFromArtifactIds: ['artifact-d'],
        },
        {
          artifactId: 'artifact-d',
          derivedFromArtifactIds: ['artifact-b'],
        },
        {
          artifactId: 'artifact-a',
          derivedFromArtifactIds: [],
        },
      ]),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue(repository),
    };
    const service = new ExecutionArtifactService(
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.derivedArtifactClosure(manager as any, 'root', ['artifact-b']),
    ).resolves.toEqual(['artifact-b', 'artifact-c', 'artifact-d']);
    expect(repository.findBy).toHaveBeenCalledWith({
      rootExecutionId: 'root',
    });
  });

  it('retires only active artifacts from the derived closure', async () => {
    const deletedAt = new Date('2026-08-28T10:00:00Z');
    const stored = [
      {
        artifactId: 'artifact-d',
        derivedFromArtifactIds: ['artifact-b'],
        contentState: 'active',
        body: Buffer.from('derived'),
        storageRef: 'file:v1/derived.blob',
        withdrawalReason: null,
        contentDeletedAt: null,
      },
      {
        artifactId: 'artifact-c',
        derivedFromArtifactIds: ['artifact-d'],
        contentState: 'withdrawn',
        body: null,
        storageRef: 'withdrawn:v1:artifact-c',
        withdrawalReason: 'previous',
        contentDeletedAt: new Date('2026-08-27T10:00:00Z'),
      },
      {
        artifactId: 'artifact-b',
        derivedFromArtifactIds: [],
        contentState: 'active',
        body: Buffer.from('source'),
        storageRef: 'postgres:v1:artifact-b',
        withdrawalReason: null,
        contentDeletedAt: null,
      },
    ];
    const query = {
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(stored),
    };
    const repository = {
      findBy: jest.fn().mockResolvedValue(stored),
      createQueryBuilder: jest.fn().mockReturnValue(query),
      save: jest.fn().mockImplementation(async (artifacts) => artifacts),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue(repository),
    };
    const storage = {
      deleteBody: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ExecutionArtifactService(
      {} as any,
      {} as any,
      storage as any,
    );

    await expect(
      service.retireGraph(
        manager as any,
        'root',
        ['artifact-b'],
        'expired',
        'retention_expired',
        deletedAt,
      ),
    ).resolves.toEqual(['artifact-b', 'artifact-d']);
    expect(storage.deleteBody).toHaveBeenCalledTimes(2);
    expect(repository.save).toHaveBeenCalledWith([stored[0], stored[2]]);
    expect(stored[0]).toMatchObject({
      body: null,
      storageRef: 'expired:v1:artifact-d',
      contentState: 'expired',
      withdrawalReason: 'retention_expired',
      contentDeletedAt: deletedAt,
    });
    expect(stored[1]).toMatchObject({
      contentState: 'withdrawn',
      withdrawalReason: 'previous',
    });
  });
});
