// eslint-disable-next-line max-len
import { KeyPointsProcessor } from '../../../src/execution-processor/processors/key-points-processor';
import { ExecutionEntity } from '../../../src/execution/execution.entity';
import { ResourceEntity } from '../../../src/resource/resource.entity';

describe('KeyPointsProcessor', () => {
  const execution = (result: unknown) =>
    ({
      executionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
      payload: { resourceId: 7 },
      result,
    }) as ExecutionEntity;

  it('persists a canonical key-point result', async () => {
    const resources = {
      findOne: jest.fn().mockResolvedValue({
        id: 7,
        keyPoints: ['Previous'],
      }),
      save: jest.fn(async (resource) => resource),
      findOneBy: jest.fn().mockResolvedValue({
        id: 7,
        keyPoints: ['Backend owns durable coordination'],
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
    const processor = new KeyPointsProcessor(effectJournal as any);

    await expect(
      processor.process(
        execution({ key_points: ['Backend owns durable coordination'] }),
      ),
    ).resolves.toMatchObject({
      success: true,
      publication: { payload: { type: 'key-points', resourceId: 7 } },
    });
    expect(effectJournal.runVerified).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: execution({}).executionId,
        effectKey: 'key-points-resource-replace:7',
        effectType: 'resource_key_points_replace',
        resourceKey: 'resource:7',
        intent: {
          resourceId: 7,
          keyPoints: ['Backend owns durable coordination'],
        },
      }),
      expect.any(Function),
    );
    expect(resources.save).toHaveBeenCalledWith(
      expect.objectContaining({
        keyPoints: ['Backend owns durable coordination'],
      }),
    );
  });

  it('rejects the removed domain error result', async () => {
    const effectJournal = { runVerified: jest.fn() };
    const processor = new KeyPointsProcessor(effectJournal as any);

    await expect(
      processor.process(execution({ error: 'old domain error' })),
    ).rejects.toThrow('Key-point execution returned an invalid result');
    expect(effectJournal.runVerified).not.toHaveBeenCalled();
  });

  it('propagates persistence failures', async () => {
    const resources = {
      findOne: jest.fn().mockResolvedValue({ id: 7, keyPoints: null }),
      save: jest.fn().mockRejectedValue(new Error('database unavailable')),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue(resources),
    };
    const effectJournal = {
      runVerified: jest.fn(async (_input, callback) => callback(manager)),
    };
    const processor = new KeyPointsProcessor(effectJournal as any);

    await expect(
      processor.process(execution({ key_points: ['Durable coordination'] })),
    ).rejects.toThrow('database unavailable');
  });
});
