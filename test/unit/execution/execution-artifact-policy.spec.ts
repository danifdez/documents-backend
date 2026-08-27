import { derivedArtifactPolicy } from '../../../src/execution/execution-artifact-policy';

describe('execution artifact policy', () => {
  it('propagates the most restrictive policy and complete provenance', () => {
    const policy = derivedArtifactPolicy(
      [
        {
          artifactId: '10000000-0000-4000-8000-000000000001',
          dataClassification: 'personal',
          retentionClass: 'diagnostic',
          expiresAt: new Date('2026-09-20T00:00:00Z'),
          inputSourceIds: ['10000000-0000-4000-8000-000000000011'],
        },
        {
          artifactId: '10000000-0000-4000-8000-000000000002',
          dataClassification: 'sensitive',
          retentionClass: 'operational',
          expiresAt: new Date('2026-09-10T00:00:00Z'),
          inputSourceIds: [
            '10000000-0000-4000-8000-000000000011',
            '10000000-0000-4000-8000-000000000012',
          ],
        },
      ],
      new Date('2026-09-01T00:00:00Z'),
    );

    expect(policy).toEqual({
      dataClassification: 'sensitive',
      retentionClass: 'operational',
      expiresAt: new Date('2026-09-08T00:00:00Z'),
      inputSourceIds: [
        '10000000-0000-4000-8000-000000000011',
        '10000000-0000-4000-8000-000000000012',
      ],
      derivedFromArtifactIds: [
        '10000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000002',
      ],
    });
  });

  it('rejects unknown classifications and retention classes', () => {
    const source = {
      artifactId: '10000000-0000-4000-8000-000000000001',
      dataClassification: 'workspace',
      retentionClass: 'operational',
      expiresAt: null,
      inputSourceIds: [],
    };

    expect(() =>
      derivedArtifactPolicy([{ ...source, dataClassification: 'unknown' }]),
    ).toThrow('artifact_classification_invalid');
    expect(() =>
      derivedArtifactPolicy([{ ...source, retentionClass: 'legacy' }]),
    ).toThrow('artifact_retention_class_invalid');
  });
});
