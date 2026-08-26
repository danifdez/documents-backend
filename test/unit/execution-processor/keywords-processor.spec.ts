// eslint-disable-next-line max-len
import { KeywordsProcessor } from '../../../src/execution-processor/processors/keywords-processor';
import { ExecutionEntity } from '../../../src/execution/execution.entity';
import { ResourceEntity } from '../../../src/resource/resource.entity';

describe('KeywordsProcessor', () => {
  const execution = (result: unknown) =>
    ({
      executionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
      payload: { resourceId: 7 },
      result,
    }) as ExecutionEntity;

  it('persists a canonical keywords result', async () => {
    const resources = {
      findOne: jest.fn().mockResolvedValue({
        id: 7,
        keywords: ['previous'],
      }),
      save: jest.fn(async (resource) => resource),
      findOneBy: jest.fn().mockResolvedValue({
        id: 7,
        keywords: ['PostgreSQL', 'workflows'],
      }),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
        expect(entity).toBe(ResourceEntity);
        return resources;
      }),
    };
    const effectJournal = {
      runVerified: jest.fn(async (_input, callback) => ({
        applied: true,
        observation: await callback(manager),
      })),
    };
    const processor = new KeywordsProcessor(effectJournal as any);

    await expect(
      processor.process(execution({ keywords: ['PostgreSQL', 'workflows'] })),
    ).resolves.toMatchObject({
      success: true,
      publication: { payload: { type: 'keywords', resourceId: 7 } },
    });
    expect(effectJournal.runVerified).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: execution({}).executionId,
        effectKey: 'keywords-resource-replace:7',
        effectType: 'resource_keywords_replace',
        resourceKey: 'resource:7',
        intent: {
          resourceId: 7,
          keywords: ['PostgreSQL', 'workflows'],
        },
      }),
      expect.any(Function),
    );
    expect(resources.save).toHaveBeenCalledWith(
      expect.objectContaining({ keywords: ['PostgreSQL', 'workflows'] }),
    );
  });

  it('rejects the removed domain error result', async () => {
    const effectJournal = { runVerified: jest.fn() };
    const processor = new KeywordsProcessor(effectJournal as any);

    await expect(
      processor.process(execution({ error: 'old domain error' })),
    ).rejects.toThrow('Keywords execution returned an invalid result');
    expect(effectJournal.runVerified).not.toHaveBeenCalled();
  });

  it('propagates persistence failures', async () => {
    const resources = {
      findOne: jest.fn().mockResolvedValue({ id: 7, keywords: null }),
      save: jest.fn().mockRejectedValue(new Error('database unavailable')),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue(resources),
    };
    const effectJournal = {
      runVerified: jest.fn(async (_input, callback) => callback(manager)),
    };
    const processor = new KeywordsProcessor(effectJournal as any);

    await expect(
      processor.process(execution({ keywords: ['PostgreSQL'] })),
    ).rejects.toThrow('database unavailable');
  });
});
