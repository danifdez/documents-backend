// eslint-disable-next-line max-len
import { KeyPointsProcessor } from '../../../src/execution-processor/processors/key-points-processor';
import { ExecutionEntity } from '../../../src/execution/execution.entity';

describe('KeyPointsProcessor', () => {
  const execution = (result: unknown) =>
    ({
      executionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
      payload: { resourceId: 7 },
      result,
    }) as ExecutionEntity;

  it('persists a canonical key-point result', async () => {
    const resourceService = { update: jest.fn().mockResolvedValue(undefined) };
    const processor = new KeyPointsProcessor(resourceService as any);

    await expect(
      processor.process(
        execution({ key_points: ['Backend owns durable coordination'] }),
      ),
    ).resolves.toMatchObject({
      success: true,
      publication: { payload: { type: 'key-points', resourceId: 7 } },
    });
    expect(resourceService.update).toHaveBeenCalledWith(7, {
      keyPoints: ['Backend owns durable coordination'],
    });
  });

  it('rejects the removed domain error result', async () => {
    const resourceService = { update: jest.fn() };
    const processor = new KeyPointsProcessor(resourceService as any);

    await expect(
      processor.process(execution({ error: 'old domain error' })),
    ).rejects.toThrow('Key-point execution returned an invalid result');
    expect(resourceService.update).not.toHaveBeenCalled();
  });

  it('propagates persistence failures', async () => {
    const resourceService = {
      update: jest.fn().mockRejectedValue(new Error('database unavailable')),
    };
    const processor = new KeyPointsProcessor(resourceService as any);

    await expect(
      processor.process(execution({ key_points: ['Durable coordination'] })),
    ).rejects.toThrow('database unavailable');
  });
});
