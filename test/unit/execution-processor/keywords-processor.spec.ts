// eslint-disable-next-line max-len
import { KeywordsProcessor } from '../../../src/execution-processor/processors/keywords-processor';
import { ExecutionEntity } from '../../../src/execution/execution.entity';

describe('KeywordsProcessor', () => {
  const execution = (result: unknown) =>
    ({
      executionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
      payload: { resourceId: 7 },
      result,
    }) as ExecutionEntity;

  it('persists a canonical keywords result', async () => {
    const resourceService = { update: jest.fn().mockResolvedValue(undefined) };
    const processor = new KeywordsProcessor(resourceService as any);

    await expect(
      processor.process(execution({ keywords: ['PostgreSQL', 'workflows'] })),
    ).resolves.toMatchObject({
      success: true,
      publication: { payload: { type: 'keywords', resourceId: 7 } },
    });
    expect(resourceService.update).toHaveBeenCalledWith(7, {
      keywords: ['PostgreSQL', 'workflows'],
    });
  });

  it('rejects the removed domain error result', async () => {
    const resourceService = { update: jest.fn() };
    const processor = new KeywordsProcessor(resourceService as any);

    await expect(
      processor.process(execution({ error: 'old domain error' })),
    ).rejects.toThrow('Keywords execution returned an invalid result');
    expect(resourceService.update).not.toHaveBeenCalled();
  });

  it('propagates persistence failures', async () => {
    const resourceService = {
      update: jest.fn().mockRejectedValue(new Error('database unavailable')),
    };
    const processor = new KeywordsProcessor(resourceService as any);

    await expect(
      processor.process(execution({ keywords: ['PostgreSQL'] })),
    ).rejects.toThrow('database unavailable');
  });
});
