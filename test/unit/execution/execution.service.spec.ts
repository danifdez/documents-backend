import {
  canonicalHash,
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
    const payload = { texts: ['Hello'], targetLanguage: 'es' };

    await service.createInference(
      'translate',
      ExecutionPriority.NORMAL,
      payload,
    );

    expect(create).toHaveBeenCalledWith(
      'translate',
      ExecutionPriority.NORMAL,
      payload,
      {
        initialStep: {
          stepKind: 'inference',
          work: { taskType: 'translate', payload },
          requiredCapabilities: ['translate'],
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
          requiredCapabilities: ['distribution'],
          priority: 0,
        },
      },
    );
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
        { ownerPrincipal: 'user-1', workspaceId: 'workspace-1' },
        false,
      ),
    ).rejects.toThrow('Explicit consent');
  });
});
