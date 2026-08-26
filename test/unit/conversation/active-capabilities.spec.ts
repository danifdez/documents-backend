import { buildActiveCapabilitySet } from '../../../src/conversation/active-capabilities';

describe('active capability selection', () => {
  it('selects folder tools only when the owner has a configured folder', async () => {
    const manager = { getRepository: jest.fn() };

    const withoutFolder = await buildActiveCapabilitySet(manager as any, {
      ownerType: 'assistant',
      ownerId: 1,
      ownerPrincipal: 'user',
      folderScope: null,
      browserFederationEnabled: false,
    });
    const withFolder = await buildActiveCapabilitySet(manager as any, {
      ownerType: 'agent',
      ownerId: 2,
      ownerPrincipal: 'user',
      folderScope: '/workspace',
      browserFederationEnabled: false,
    });

    expect(withoutFolder.tools.map(({ name }) => name)).toEqual([
      'documents.search',
      'user_tasks.create',
      'agents.delegate',
    ]);
    expect(withFolder.tools.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'workspace_files.list',
        'workspace_files.search',
        'workspace_files.read',
        'workspace_files.write',
        'workspace_files.delete',
      ]),
    );
    expect(withFolder.skills).toEqual([]);
  });

  it('selects browser read only for a live paired browser', async () => {
    const query = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getExists: jest.fn().mockResolvedValue(true),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(query),
      }),
    };

    const selected = await buildActiveCapabilitySet(manager as any, {
      ownerType: 'assistant',
      ownerId: 1,
      ownerPrincipal: 'paired-user',
      folderScope: null,
      browserFederationEnabled: true,
    });

    expect(selected.tools).toContainEqual({
      name: 'browser.read_current_page',
      descriptorVersion: 'browser.read_current_page/1',
      availabilityBasis: 'paired_browser',
    });
    expect(query.andWhere).toHaveBeenCalledWith(
      'worker.ownerPrincipal = :ownerPrincipal',
      { ownerPrincipal: 'paired-user' },
    );
  });
});
