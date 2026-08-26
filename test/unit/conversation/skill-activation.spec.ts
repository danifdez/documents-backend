import { recordLoadedSkillResource } from '../../../src/conversation/skill-activation';

describe('skill activation resource checkpoints', () => {
  it('records an accepted resource load without discarding prior checkpoint data', async () => {
    const activation = {
      skillVersion: 'workspace-document-workflow/1',
      contentHash:
        'sha256:c755864bb8f6b113ff62c4912c20277bf66e71d37819921de46111a24c7cec91',
      status: 'active',
      phase: 'instructions_loaded',
      checkpoint: { cursor: 3 },
    };
    const repo = {
      findOne: jest.fn().mockResolvedValue(activation),
      save: jest.fn(async (value) => value),
    };
    const manager = { getRepository: jest.fn().mockReturnValue(repo) };

    await expect(
      recordLoadedSkillResource(manager as any, 'execution-id', {
        skillId: 'workspace-document-workflow',
        skillVersion: 'workspace-document-workflow/1',
        skillContentHash:
          'sha256:c755864bb8f6b113ff62c4912c20277bf66e71d37819921de46111a24c7cec91',
        resourceId: 'document-format-handling',
        resourceContentHash:
          'sha256:ccb06824a5ed7559cac8327619cb3f8de834ee44f2fda7f0460c7501df1b179c',
        operationId: 'operation-id',
      }),
    ).resolves.toBe(activation);

    expect(activation).toMatchObject({
      phase: 'resource_loaded',
      checkpoint: {
        cursor: 3,
        loadedResources: [
          {
            resourceId: 'document-format-handling',
            contentHash:
              'sha256:ccb06824a5ed7559cac8327619cb3f8de834ee44f2fda7f0460c7501df1b179c',
            operationId: 'operation-id',
          },
        ],
      },
    });
  });

  it('rejects a resource for a different frozen skill version', async () => {
    const repo = {
      findOne: jest.fn().mockResolvedValue({
        skillVersion: 'workspace-document-workflow/2',
        contentHash: 'sha256:' + '0'.repeat(64),
        status: 'active',
      }),
    };
    const manager = { getRepository: jest.fn().mockReturnValue(repo) };

    await expect(
      recordLoadedSkillResource(manager as any, 'execution-id', {
        skillId: 'workspace-document-workflow',
        skillVersion: 'workspace-document-workflow/1',
        skillContentHash: 'sha256:' + '1'.repeat(64),
        resourceId: 'document-format-handling',
        resourceContentHash: 'sha256:' + '2'.repeat(64),
        operationId: 'operation-id',
      }),
    ).rejects.toThrow('skill_activation_resource_mismatch');
  });
});
