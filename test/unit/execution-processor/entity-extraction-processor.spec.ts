import { contentHash } from '../../../src/execution/execution-canonical';
import { ExecutionEntity } from '../../../src/execution/execution.entity';
import { EntityExtractionProcessor } from '../../../src/execution-processor/processors/entity-extraction-processor'; // eslint-disable-line max-len
import { ResourceEntity } from '../../../src/resource/resource.entity';

describe('EntityExtractionProcessor', () => {
  it('atomically replaces pending entities in the resource language', async () => {
    const content = '<p>Ada founded Example Corp.</p>';
    const resource = {
      id: 7,
      content,
      language: 'en',
      status: 'extracted',
    };
    const resources = {
      findOne: jest.fn().mockResolvedValue(resource),
      save: jest.fn().mockResolvedValue(resource),
      findOneBy: jest.fn().mockImplementation(async () => resource),
    };
    let pendingId = 10;
    const observedEntities = [
      {
        name: 'Ada',
        language: 'en',
        translations: { en: 'Ada' },
        scope: 'document',
        status: 'pending',
        entity_type: 'PERSON',
      },
      {
        name: 'Example Corp',
        language: 'en',
        translations: { en: 'Example Corp' },
        scope: 'document',
        status: 'pending',
        entity_type: 'ORGANIZATION',
      },
    ];
    const manager = {
      getRepository: jest.fn((entity) => {
        expect(entity).toBe(ResourceEntity);
        return resources;
      }),
      query: jest.fn(async (query: string) => {
        if (query.includes('FROM entity_types WHERE')) {
          return [
            { id: 1, name: 'PERSON' },
            { id: 2, name: 'ORGANIZATION' },
          ];
        }
        if (query.includes('INSERT INTO pending_entities')) {
          return [{ id: pendingId++ }];
        }
        if (query.includes('FROM pending_entities pending')) {
          return observedEntities;
        }
        return [];
      }),
    };
    const effectJournal = {
      runVerified: jest.fn(async (_input, callback) => ({
        applied: true,
        observation: await callback(manager),
      })),
    };
    const processor = new EntityExtractionProcessor(effectJournal as any);
    const execution = {
      executionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
      payload: {
        resourceId: 7,
        sourceContentHash: contentHash(content),
        sourceLanguage: 'en',
      },
      result: {
        entities: [
          { word: 'Ada', entity: 'PERSON' },
          { word: 'Example Corp', entity: 'ORG' },
        ],
      },
    } as ExecutionEntity;

    await expect(processor.process(execution)).resolves.toEqual({
      success: true,
      entitiesProcessed: 2,
    });

    expect(effectJournal.runVerified).toHaveBeenCalledWith(
      expect.objectContaining({
        effectKey: 'entity-extraction:7',
        effectType: 'pending_entities_replace',
      }),
      expect.any(Function),
    );
    expect(manager.query).toHaveBeenCalledWith(
      'DELETE FROM pending_entities WHERE resource_id = $1',
      [7],
    );
    expect(resource.status).toBe('entities');
  });
});
