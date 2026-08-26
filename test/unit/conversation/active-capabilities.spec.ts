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
      objective: 'Answer this question',
    });
    const withFolder = await buildActiveCapabilitySet(manager as any, {
      ownerType: 'agent',
      ownerId: 2,
      ownerPrincipal: 'user',
      folderScope: '/workspace',
      browserFederationEnabled: false,
      objective: 'Answer this question',
    });

    expect(withoutFolder.tools.map(({ name }) => name)).toEqual([
      'documents.search',
      'skills.load_resource',
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

  it('activates a matching product skill only when its tools already exist', async () => {
    const manager = { getRepository: jest.fn() };
    const withoutFolder = await buildActiveCapabilitySet(manager as any, {
      ownerType: 'assistant',
      ownerId: 1,
      ownerPrincipal: 'user',
      folderScope: null,
      browserFederationEnabled: false,
      objective: 'Modify the spreadsheet file',
    });
    const withFolder = await buildActiveCapabilitySet(manager as any, {
      ownerType: 'agent',
      ownerId: 2,
      ownerPrincipal: 'user',
      folderScope: '/workspace',
      browserFederationEnabled: false,
      objective: 'Modifica el documento de presupuesto',
    });

    expect(withoutFolder.skills).toEqual([]);
    expect(withFolder.skills).toEqual([
      expect.objectContaining({
        skillId: 'workspace-document-workflow',
        version: 'workspace-document-workflow/1',
        activationReason: 'objective_match',
        contentHash:
          'sha256:c755864bb8f6b113ff62c4912c20277bf66e71d37819921de46111a24c7cec91',
      }),
    ]);
    expect(withFolder.skills[0]).not.toHaveProperty('instructions');
    expect(withFolder.skills[0].resources).toEqual([
      expect.objectContaining({
        resourceId: 'document-format-handling',
        contentHash:
          'sha256:ccb06824a5ed7559cac8327619cb3f8de834ee44f2fda7f0460c7501df1b179c',
      }),
    ]);
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
      objective: 'Read the current browser page',
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
