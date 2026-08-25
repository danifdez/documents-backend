// eslint-disable-next-line max-len
import { RelationshipExtractionProcessor } from '../../../src/execution-processor/processors/relationship-extraction-processor';
import { ExecutionEntity } from '../../../src/execution/execution.entity';

describe('RelationshipExtractionProcessor', () => {
  const execution = (result: unknown) =>
    ({
      executionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
      payload: {
        resourceId: 7,
        projectId: 3,
        entities: [
          { id: 1, name: 'Ada Lovelace', type: 'PERSON' },
          { id: 2, name: 'Analytical Engine', type: 'PRODUCT' },
        ],
      },
      result,
    }) as ExecutionEntity;

  it('replaces graph relationships during backend finalization', async () => {
    const graphService = {
      replaceExtractedRelationships: jest.fn().mockResolvedValue(undefined),
    };
    const processor = new RelationshipExtractionProcessor(graphService as any);
    const relationships = [
      {
        subject: 'Ada Lovelace',
        predicate: 'documented',
        object: 'Analytical Engine',
        confidence: 0.5,
        context: 'Ada documented the Analytical Engine.',
      },
    ];

    await expect(
      processor.process(execution({ relationships })),
    ).resolves.toMatchObject({
      success: true,
      resourceId: 7,
      relationshipsExtracted: 1,
      publication: {
        socketEvent: 'relationshipExtractionComplete',
        payload: { resourceId: 7, relationships },
      },
    });
    expect(graphService.replaceExtractedRelationships).toHaveBeenCalledWith(
      7,
      3,
      expect.arrayContaining([{ id: 1, name: 'Ada Lovelace', type: 'PERSON' }]),
      relationships,
    );
  });

  it('rejects the removed error-as-result contract', async () => {
    const graphService = { replaceExtractedRelationships: jest.fn() };
    const processor = new RelationshipExtractionProcessor(graphService as any);

    await expect(
      processor.process(execution({ error: 'old graph failure' })),
    ).rejects.toThrow('Invalid relationship extraction result');
    expect(graphService.replaceExtractedRelationships).not.toHaveBeenCalled();
  });
});
