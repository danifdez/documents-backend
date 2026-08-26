import { TranscribeProcessor } from '../../../src/execution-processor/processors/transcribe-processor'; // eslint-disable-line max-len
import { ExecutionEntity } from '../../../src/execution/execution.entity';
import { ResourceEntity } from '../../../src/resource/resource.entity';

describe('TranscribeProcessor', () => {
  it('journals the transcript and creates one idempotent language child', async () => {
    const resource = {
      id: 7,
      content: '<p>Existing</p>',
      status: 'transcribing',
    };
    const resources = {
      findOne: jest.fn().mockResolvedValue(resource),
      save: jest.fn(async (value) => value),
      findOneBy: jest.fn().mockImplementation(async () => resource),
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
    const executions = {
      createChildInferenceOnce: jest.fn().mockResolvedValue({}),
    };
    const processor = new TranscribeProcessor(
      executions as any,
      effectJournal as any,
    );
    const transcript = `${'a'.repeat(200)}${'b'.repeat(200)}${'c'.repeat(200)}`;
    const execution = {
      executionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
      lastEventId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca702',
      payload: { resourceId: 7 },
      result: { transcript, language: 'en', duration: 10 },
    } as ExecutionEntity;

    await expect(processor.process(execution)).resolves.toEqual(
      expect.objectContaining({ success: true, resourceId: 7 }),
    );

    expect(effectJournal.runVerified).toHaveBeenCalledWith(
      expect.objectContaining({
        effectKey: 'transcribe-resource-content:7',
        effectType: 'resource_transcription_append',
      }),
      expect.any(Function),
    );
    expect(executions.createChildInferenceOnce).toHaveBeenCalledWith(
      execution.executionId,
      'transcribe:detect-language:7',
      expect.objectContaining({
        taskType: 'detect-language',
        payload: {
          resourceId: 7,
          samples: ['a'.repeat(200), 'c'.repeat(200)],
        },
        causedByEventId: execution.lastEventId,
      }),
    );
    expect(resource.content).toContain('class="transcript"');
    expect(resource.status).toBe('confirmed_extraction');
  });

  it('journals an empty transcript without creating a language child', async () => {
    const resource = { id: 7, status: 'transcribing' };
    const resources = {
      findOne: jest.fn().mockResolvedValue(resource),
      save: jest.fn(async (value) => value),
      findOneBy: jest.fn().mockImplementation(async () => resource),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue(resources),
    };
    const effectJournal = {
      runVerified: jest.fn(async (_input, callback) => ({
        applied: true,
        observation: await callback(manager),
      })),
    };
    const executions = { createChildInferenceOnce: jest.fn() };
    const processor = new TranscribeProcessor(
      executions as any,
      effectJournal as any,
    );

    await expect(
      processor.process({
        executionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
        payload: { resourceId: 7 },
        result: { transcript: '' },
      } as ExecutionEntity),
    ).resolves.toEqual({
      success: false,
      resourceId: 7,
      reason: 'empty_transcript',
    });

    expect(effectJournal.runVerified).toHaveBeenCalledWith(
      expect.objectContaining({
        effectKey: 'transcribe-empty-resource-status:7',
      }),
      expect.any(Function),
    );
    expect(executions.createChildInferenceOnce).not.toHaveBeenCalled();
  });
});
