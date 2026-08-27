import {
  canonicalHash,
  canonicalDomainHash,
  canonicalJson,
  contentHash,
  redactExecutionText,
  ExecutionService,
} from '../../../src/execution/execution.service';
import { BadRequestException } from '@nestjs/common';
import { ExecutionPriority } from '../../../src/execution/execution-priority.enum';

describe('ExecutionService primitives', () => {
  it('creates single-assignment inference work explicitly', async () => {
    const service = Object.create(
      ExecutionService.prototype,
    ) as ExecutionService;
    const create = jest.fn().mockResolvedValue({ executionId: 'execution-1' });
    service.create = create;
    const payload = {
      question: 'What is this document about?',
      graphContext: [],
    };

    await service.createInference('ask', ExecutionPriority.NORMAL, payload);

    expect(create).toHaveBeenCalledWith(
      'ask',
      ExecutionPriority.NORMAL,
      payload,
      {
        initialStep: {
          stepKind: 'inference',
          work: { taskType: 'ask', payload },
          finalizeOnFailure: false,
          requiredCapabilities: ['ask'],
          priority: 0,
        },
      },
    );
  });

  it('creates deterministic code work explicitly', async () => {
    const service = Object.create(
      ExecutionService.prototype,
    ) as ExecutionService;
    const create = jest.fn().mockResolvedValue({ executionId: 'execution-1' });
    service.create = create;
    const payload = { datasetId: 7, params: { field: 'score' } };
    const inputArtifacts = [
      {
        role: 'datasets',
        kind: 'dataset_snapshot',
        mediaType: 'application/json',
        body: Buffer.from('{}'),
      },
    ];

    await service.createCode(
      'distribution',
      ExecutionPriority.NORMAL,
      payload,
      { inputArtifacts },
    );

    expect(create).toHaveBeenCalledWith(
      'distribution',
      ExecutionPriority.NORMAL,
      payload,
      {
        inputArtifacts,
        initialStep: {
          stepKind: 'code',
          work: { taskType: 'distribution', payload },
          finalizeOnFailure: false,
          requiredCapabilities: ['distribution'],
          priority: 0,
        },
      },
    );
  });

  it('creates a finalizer child with a stable idempotency identity', async () => {
    const service = Object.create(ExecutionService.prototype) as any;
    const parent = {
      executionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
      rootExecutionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
      cancellationRequestedAt: null,
    };
    const executions = {
      findOneBy: jest.fn().mockResolvedValue(parent),
      findOne: jest.fn().mockResolvedValue(parent),
      find: jest.fn().mockResolvedValue([]),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue(executions),
    };
    service.dataSource = {
      transaction: jest.fn((callback) => callback(manager)),
    };
    service.createChildInference = jest.fn().mockResolvedValue({
      execution: { executionId: 'child-1' },
      step: { stepId: 'step-1' },
    });
    const input = {
      taskType: 'detect-language',
      payload: { resourceId: 7, samples: ['one', 'two'] },
      work: {
        taskType: 'detect-language',
        payload: { resourceId: 7, samples: ['one', 'two'] },
      },
      requiredCapability: 'detect-language',
      deadline: new Date('2026-08-27T12:00:00.000Z'),
      causedByEventId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca702',
    };

    await service.createChildInferenceOnce(
      parent.executionId,
      'transcribe:detect-language',
      input,
    );

    expect(service.createChildInference).toHaveBeenCalledWith(
      manager,
      parent,
      expect.objectContaining({
        payload: {
          ...input.payload,
          originFinalizerKey: 'transcribe:detect-language',
        },
        work: {
          taskType: 'detect-language',
          payload: {
            ...input.payload,
            originFinalizerKey: 'transcribe:detect-language',
          },
        },
      }),
    );
  });

  it('reuses the existing finalizer child without creating another', async () => {
    const service = Object.create(ExecutionService.prototype) as any;
    const parent = {
      executionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
      rootExecutionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
      cancellationRequestedAt: null,
    };
    const payload = {
      resourceId: 7,
      samples: ['one', 'two'],
      originFinalizerKey: 'transcribe:detect-language',
    };
    const child = {
      executionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca702',
      parentExecutionId: parent.executionId,
      taskType: 'detect-language',
      payload,
    };
    const step = {
      stepId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca703',
      executionId: child.executionId,
      stepKind: 'inference',
    };
    const executions = {
      findOneBy: jest.fn().mockResolvedValue(parent),
      findOne: jest.fn().mockResolvedValue(parent),
      find: jest.fn().mockResolvedValue([child]),
    };
    const steps = { findOne: jest.fn().mockResolvedValue(step) };
    const manager = {
      getRepository: jest.fn((entity) =>
        entity.name === 'ExecutionEntity' ? executions : steps,
      ),
    };
    service.dataSource = {
      transaction: jest.fn((callback) => callback(manager)),
    };
    service.createChildInference = jest.fn();

    await expect(
      service.createChildInferenceOnce(
        parent.executionId,
        'transcribe:detect-language',
        {
          taskType: 'detect-language',
          payload: { resourceId: 7, samples: ['one', 'two'] },
          work: {
            taskType: 'detect-language',
            payload: { resourceId: 7, samples: ['one', 'two'] },
          },
          requiredCapability: 'detect-language',
          causedByEventId: parent.executionId,
        },
      ),
    ).resolves.toEqual({ execution: child, step });
    expect(service.createChildInference).not.toHaveBeenCalled();
  });

  it('reuses an idempotent compound child while holding the root lock', async () => {
    const service = Object.create(ExecutionService.prototype) as any;
    const root = {
      executionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
      rootExecutionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
      cancellationRequestedAt: null,
    };
    const parent = {
      executionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca702',
      rootExecutionId: root.executionId,
      cancellationRequestedAt: null,
    };
    const payload = {
      resourceId: 7,
      chunkCount: 1,
      originFinalizerKey: 'detect-language:date-extraction:7:hash',
    };
    const child = {
      executionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca703',
      parentExecutionId: parent.executionId,
      taskType: 'date-extraction',
      payload,
    };
    const executions = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(root)
        .mockResolvedValueOnce(parent),
      find: jest.fn().mockResolvedValue([child]),
    };
    const steps = { countBy: jest.fn().mockResolvedValue(2) };
    const manager = {
      getRepository: jest.fn((entity) =>
        entity.name === 'ExecutionEntity' ? executions : steps,
      ),
    };
    service.dataSource = {
      transaction: jest.fn((callback) => callback(manager)),
    };

    await expect(
      service.create(
        'date-extraction',
        ExecutionPriority.NORMAL,
        { resourceId: 7, chunkCount: 1 },
        {
          rootExecutionId: root.executionId,
          parentExecutionId: parent.executionId,
          childIdempotencyKey: 'detect-language:date-extraction:7:hash',
          steps: [{ stepKind: 'inference' }, { stepKind: 'code' }] as any,
        },
      ),
    ).resolves.toBe(child);
    expect(steps.countBy).toHaveBeenCalledWith({
      executionId: child.executionId,
    });
  });

  it('canonicalizes object keys recursively', () => {
    expect(canonicalJson({ z: 1, a: { y: 2, b: 3 } })).toBe(
      '{"a":{"b":3,"y":2},"z":1}',
    );
    expect(canonicalJson({ ä: 1, z: 2, a: 3, A: 4 })).toBe(
      '{"A":4,"a":3,"z":2,"ä":1}',
    );
  });

  it('produces stable sha256 identifiers', () => {
    expect(canonicalHash({ b: 2, a: 1 })).toBe(canonicalHash({ a: 1, b: 2 }));
    expect(canonicalDomainHash({ b: 0.5, a: 1 })).toBe(
      canonicalDomainHash({ a: 1, b: 0.5 }),
    );
    expect(contentHash('execution')).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('redacts private reasoning and credentials', () => {
    const value = redactExecutionText(
      '<think>private</think> Authorization=secret Bearer abc.def',
    );
    expect(value).not.toContain('private');
    expect(value).not.toContain('secret');
    expect(value).not.toContain('abc.def');
    expect(redactExecutionText(value)).toBe(value);
  });

  it('accepts redaction markers in artifacts but rejects raw secrets', () => {
    const service = Object.create(ExecutionService.prototype) as {
      rejectSensitiveArtifactBody: (
        artifact: { mediaType: string; artifactId: string },
        body: Buffer,
      ) => void;
    };
    const artifact = {
      mediaType: 'application/json',
      artifactId: '00000000-0000-4000-8000-000000000001',
    };

    expect(() =>
      service.rejectSensitiveArtifactBody(
        artifact,
        Buffer.from(
          JSON.stringify({
            accessToken: '[REDACTED]',
            text: 'Bearer [REDACTED]; accessToken=[REDACTED].',
          }),
        ),
      ),
    ).not.toThrow();
    expect(() =>
      service.rejectSensitiveArtifactBody(
        artifact,
        Buffer.from(JSON.stringify({ accessToken: 'raw-secret' })),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      service.rejectSensitiveArtifactBody(
        artifact,
        Buffer.from(JSON.stringify({ text: 'accessToken=raw-secret' })),
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects evaluation export before reading evidence without consent', async () => {
    const service = Object.create(
      ExecutionService.prototype,
    ) as ExecutionService;

    await expect(
      service.exportBundle(
        '00000000-0000-4000-8000-000000000001',
        { ownerPrincipal: 'user-1' },
        false,
      ),
    ).rejects.toThrow('Explicit consent');
  });
});
