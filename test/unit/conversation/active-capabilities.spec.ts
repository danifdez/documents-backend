import { buildActiveCapabilitySet } from '../../../src/conversation/active-capabilities';
import {
  WORKSPACE_FOLDER_CONFIGURED_SIGNAL,
  selectProductSkills,
} from '../../../src/conversation/product-skill-registry';

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
    expect(withoutFolder.skillSignals).toEqual(['document_search_available']);
    expect(withFolder.skillSignals).toEqual([
      'document_search_available',
      'workspace_folder_configured',
    ]);
    expect(withFolder.skills.map(({ skillId }) => skillId)).toEqual([
      'workspace-document-workflow',
      'evidence-research-workflow',
    ]);
  });

  it('activates product skills from typed signals and available tools', async () => {
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

    expect(withoutFolder.skills.map(({ skillId }) => skillId)).toEqual([
      'evidence-research-workflow',
    ]);
    expect(withFolder.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skillId: 'workspace-document-workflow',
          version: 'workspace-document-workflow/1',
          activationReason: 'signal_match',
          activationSignal: 'workspace_folder_configured',
          contentHash:
            'sha256:c755864bb8f6b113ff62c4912c20277bf66e71d37819921de46111a24c7cec91',
        }),
      ]),
    );
    expect(withFolder.skills[0]).not.toHaveProperty('instructions');
    expect(withFolder.skills[0].resources).toEqual([
      expect.objectContaining({
        resourceId: 'document-format-handling',
        contentHash:
          'sha256:ccb06824a5ed7559cac8327619cb3f8de834ee44f2fda7f0460c7501df1b179c',
      }),
    ]);
  });

  it('selects browser read and confirmed navigation for a live paired browser', async () => {
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
    expect(selected.tools).toContainEqual({
      name: 'browser.navigate',
      descriptorVersion: 'browser.navigate/1',
      availabilityBasis: 'paired_browser',
    });
    expect(selected.tools).toContainEqual({
      name: 'browser.go_back',
      descriptorVersion: 'browser.go_back/1',
      availabilityBasis: 'paired_browser',
    });
    expect(selected.tools).toContainEqual({
      name: 'browser.click',
      descriptorVersion: 'browser.click/1',
      availabilityBasis: 'paired_browser',
    });
    expect(selected.tools).toContainEqual({
      name: 'browser.type_text',
      descriptorVersion: 'browser.type_text/1',
      availabilityBasis: 'paired_browser',
    });
    expect(selected.tools).toContainEqual({
      name: 'browser.select_option',
      descriptorVersion: 'browser.select_option/1',
      availabilityBasis: 'paired_browser',
    });
    expect(query.andWhere).toHaveBeenCalledWith(
      'worker.ownerPrincipal = :ownerPrincipal',
      { ownerPrincipal: 'paired-user' },
    );
    expect(query.andWhere).toHaveBeenCalledWith(
      'worker.capabilities @> :capabilities::jsonb',
      {
        capabilities: JSON.stringify([
          'tool.browser.read_current_page/1',
          'tool.browser.navigate/1',
          'tool.browser.go_back/1',
          'tool.browser.click/1',
          'tool.browser.type_text/1',
          'tool.browser.select_option/1',
        ]),
      },
    );
  });

  it('selects evidence research without requiring a configured folder', async () => {
    const selected = await buildActiveCapabilitySet(
      { getRepository: jest.fn() } as any,
      {
        ownerType: 'assistant',
        ownerId: 1,
        ownerPrincipal: 'user',
        folderScope: null,
        browserFederationEnabled: false,
      },
    );

    expect(selected.skills).toEqual([
      expect.objectContaining({
        skillId: 'evidence-research-workflow',
        version: 'evidence-research-workflow/1',
        activationReason: 'signal_match',
        activationSignal: 'document_search_available',
        contentHash:
          'sha256:902f4eb209b750d9b7a62c8cb9daa297158e45a284a8f857fba3a676dcea8002',
        resources: [
          expect.objectContaining({
            resourceId: 'source-evaluation',
            contentHash:
              'sha256:3c5472ac70881363440979f779dac8ad657c662a6666495a5f667ef4a8a79879',
          }),
        ],
      }),
    ]);
  });

  it('can freeze multiple independently applicable skills for one turn', async () => {
    const selected = await buildActiveCapabilitySet(
      { getRepository: jest.fn() } as any,
      {
        ownerType: 'agent',
        ownerId: 7,
        ownerPrincipal: 'user',
        folderScope: '/workspace',
        browserFederationEnabled: false,
      },
    );

    expect(selected.skills.map(({ skillId }) => skillId)).toEqual([
      'workspace-document-workflow',
      'evidence-research-workflow',
    ]);
  });

  it('does not let a signal grant missing workspace capabilities', () => {
    const selected = selectProductSkills(
      [WORKSPACE_FOLDER_CONFIGURED_SIGNAL],
      new Set([
        'workspace_files.list',
        'workspace_files.search',
        'workspace_files.read',
        'workspace_files.write',
      ]),
    );

    expect(selected).toEqual([]);
  });
});
