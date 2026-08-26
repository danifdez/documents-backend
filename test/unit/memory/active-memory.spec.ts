import { buildActiveMemoryContext } from '../../../src/memory/active-memory';
import { MemoryEntryEntity } from '../../../src/memory/memory-entry.entity';

const entry = (
  id: string,
  type: MemoryEntryEntity['type'],
  name: string,
  body: string,
  updatedAt: string,
): MemoryEntryEntity =>
  ({
    id,
    assistantId: 1,
    agentId: null,
    name,
    type,
    body,
    contentHash: `sha256:${id.replaceAll('-', '').padEnd(64, '0').slice(0, 64)}`,
    sourceKind: 'manual',
    sourceExecutionId: null,
    sourceTurnId: null,
    sourceMessageId: null,
    sourceArtifactId: null,
    sourceArtifactRevision: null,
    consentStatus: 'granted',
    consentBasis: 'explicit_user_action',
    consentedAt: new Date('2026-08-20T09:00:00Z'),
    dataClassification: 'workspace',
    purpose: 'conversation_memory',
    allowedDestinations: ['documents-models', 'documents'],
    updatedAt: new Date(updatedAt),
  }) as MemoryEntryEntity;

describe('active memory selection', () => {
  it('freezes candidates and selects only relevant or preference entries', async () => {
    const repository = {
      find: jest
        .fn()
        .mockResolvedValue([
          entry(
            '00000000-0000-4000-8000-000000000001',
            'fact',
            'Editor',
            'The preferred editor is Neovim',
            '2026-08-20T10:00:00Z',
          ),
          entry(
            '00000000-0000-4000-8000-000000000002',
            'episode',
            'Trip',
            'Visited Lisbon in spring',
            '2026-08-21T10:00:00Z',
          ),
          entry(
            '00000000-0000-4000-8000-000000000003',
            'preference',
            'Response style',
            'Keep responses concise',
            '2026-08-19T10:00:00Z',
          ),
        ]),
    };
    const manager = { getRepository: jest.fn().mockReturnValue(repository) };

    const context = await buildActiveMemoryContext(
      manager as any,
      'assistant',
      1,
      'Which editor do I prefer?',
    );

    expect(context.activeEntries.map((item) => item.name)).toEqual([
      'Editor',
      'Response style',
    ]);
    expect(context.candidates).toHaveLength(3);
    expect(
      context.candidates.find((item) => item.type === 'episode')?.selected,
    ).toBe(false);
    expect(context.activeEntries[0].dataPolicy.allowedDestinations).toEqual([
      'documents',
      'documents-models',
    ]);
  });

  it('queries only granted entries owned by the current agent', async () => {
    const repository = { find: jest.fn().mockResolvedValue([]) };
    const manager = { getRepository: jest.fn().mockReturnValue(repository) };

    await buildActiveMemoryContext(manager as any, 'agent', 7, 'Continue');

    expect(repository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          agentId: 7,
          consentStatus: 'granted',
        }),
        take: 50,
      }),
    );
  });
});
