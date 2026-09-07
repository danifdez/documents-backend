import { BadRequestException } from '@nestjs/common';
import {
  redactExecutionText,
  rejectForbiddenData,
  rejectSensitiveArtifactBody,
} from '../../../src/execution/execution-data-policy';

describe('Execution data policy', () => {
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
    const artifact = {
      kind: 'test',
      contentHash: 'sha256:test',
      size: 0,
      dataClassification: 'workspace',
      mediaType: 'application/json',
      artifactId: '00000000-0000-4000-8000-000000000001',
    };

    expect(() =>
      rejectSensitiveArtifactBody(
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
      rejectSensitiveArtifactBody(
        artifact,
        Buffer.from(JSON.stringify({ accessToken: 'raw-secret' })),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      rejectSensitiveArtifactBody(
        artifact,
        Buffer.from(JSON.stringify({ text: 'accessToken=raw-secret' })),
      ),
    ).toThrow(BadRequestException);
  });

  it('preserves forbidden-key paths and redaction markers', () => {
    expect(() =>
      rejectForbiddenData({ nested: [{ 'API-Key': 'sample' }] }),
    ).toThrow(
      new BadRequestException(
        '$.nested[0].API-Key is forbidden in execution data',
      ),
    );
    expect(() => rejectForbiddenData({ password: '[REDACTED]' })).not.toThrow();
  });

  describe('sensitive artifact validation contract', () => {
    const validate = (body: string, mediaType = 'application/json') =>
      rejectSensitiveArtifactBody(
        {
          mediaType,
          artifactId: 'artifact-1',
          kind: 'test',
          contentHash: 'sha256:test',
          size: 0,
          dataClassification: 'workspace',
        },
        Buffer.from(body),
      );

    it.each(['application/json', 'application/ld+json; charset=utf-8'])(
      'reports nested forbidden keys for %s before sensitive strings',
      (mediaType) => {
        expect(() =>
          validate(
            JSON.stringify({
              text: 'Bearer sample',
              nested: [{ 'API-Key': 'sample' }],
            }),
            mediaType,
          ),
        ).toThrow(
          new BadRequestException(
            '$artifact.nested[0].API-Key is forbidden in execution data',
          ),
        );
      },
    );

    it('reports paths for sensitive strings inside arrays', () => {
      expect(() =>
        validate(JSON.stringify({ nested: ['Bearer sample'] })),
      ).toThrow(
        new BadRequestException(
          '$artifact.nested[0] contains unredacted sensitive text',
        ),
      );
    });

    it.each(['text/plain', 'text/html; charset=utf-8'])(
      'rejects sensitive text for %s',
      (mediaType) => {
        expect(() => validate('<think>private</think>', mediaType)).toThrow(
          new BadRequestException(
            'Artifact contains unredacted sensitive text: artifact-1',
          ),
        );
      },
    );

    it('does not reject malformed JSON', () => {
      expect(() => validate('{"text":"Bearer sample"')).not.toThrow();
    });

    it.each(['application/octet-stream', 'image/png', 'Application/JSON'])(
      'skips %s bodies',
      (mediaType) => {
        expect(() => validate('Bearer sample', mediaType)).not.toThrow();
      },
    );

    it.each(['null', '42', 'true', '[]', '{"nested":[null,42,true]}'])(
      'accepts harmless JSON %s',
      (body) => {
        expect(() => validate(body)).not.toThrow();
      },
    );
  });
});
