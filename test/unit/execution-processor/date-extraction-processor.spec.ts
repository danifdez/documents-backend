import { DateExtractionProcessor } from '../../../src/execution-processor/processors/date-extraction-processor'; // eslint-disable-line max-len
import { ExecutionEntity } from '../../../src/execution/execution.entity';
import { ResourceDateEntity } from '../../../src/resource-date/resource-date.entity';
import { ResourceEntity } from '../../../src/resource/resource.entity';

describe('DateExtractionProcessor', () => {
  it('replaces and verifies the resource dates through the effect journal', async () => {
    const date = {
      date: '2026-08-27',
      endDate: null,
      rawExpression: '27 August 2026',
      precision: 'day',
      charOffset: 12,
      contextSnippet: 'Published on 27 August 2026',
      unresolvedReason: null,
    };
    const resourceDates = {
      find: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 3, resourceId: 7, ...date }]),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
      create: jest.fn((value) => value),
      save: jest.fn(async (rows) => rows),
    };
    const resources = {
      findOne: jest.fn().mockResolvedValue({ id: 7 }),
    };
    const manager = {
      getRepository: jest.fn((entity) =>
        entity === ResourceEntity ? resources : resourceDates,
      ),
    };
    const effectJournal = {
      runVerified: jest.fn(async (_input, callback) => ({
        applied: true,
        observation: await callback(manager),
      })),
    };
    const processor = new DateExtractionProcessor(effectJournal as any);
    const execution = {
      executionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
      taskType: 'date-extraction',
      payload: { resourceId: 7 },
      result: { dates: [date] },
    } as ExecutionEntity;

    await expect(processor.process(execution)).resolves.toEqual({
      success: true,
      resourceId: 7,
      datesExtracted: 1,
    });

    expect(effectJournal.runVerified).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: execution.executionId,
        effectKey: 'date-extraction-resource-replace:7',
        effectType: 'resource_dates_replace',
        resourceKey: 'resource-dates:7',
        intent: { resourceId: 7, dates: [date] },
      }),
      expect.any(Function),
    );
    expect(manager.getRepository).toHaveBeenCalledWith(ResourceDateEntity);
    expect(resourceDates.delete).toHaveBeenCalledWith({ resourceId: 7 });
    expect(resourceDates.save).toHaveBeenCalledWith([
      { resourceId: 7, ...date },
    ]);
  });
});
