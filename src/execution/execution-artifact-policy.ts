export const EXECUTION_ARTIFACT_RETENTION_CLASSES = [
  'operational',
  'diagnostic',
  'evaluation',
] as const;

export type ExecutionArtifactRetentionClass =
  (typeof EXECUTION_ARTIFACT_RETENTION_CLASSES)[number];

export interface ExecutionArtifactDataPolicy {
  classification: string;
  allowedPurposes: ['execution'];
  allowedDestinations: Array<'documents-models' | 'ia-browser'>;
  retentionClass: ExecutionArtifactRetentionClass;
  expiresAt: string | null;
  sourceRefs: string[];
}

const DEFAULT_RETENTION_MS: Record<ExecutionArtifactRetentionClass, number> = {
  operational: 7 * 24 * 60 * 60 * 1_000,
  diagnostic: 30 * 24 * 60 * 60 * 1_000,
  evaluation: 90 * 24 * 60 * 60 * 1_000,
};

export function assertArtifactRetentionClass(
  value: string,
): asserts value is ExecutionArtifactRetentionClass {
  if (
    !EXECUTION_ARTIFACT_RETENTION_CLASSES.includes(
      value as ExecutionArtifactRetentionClass,
    )
  ) {
    throw new Error('artifact_retention_class_invalid');
  }
}

export function defaultArtifactExpiry(
  retentionClass: ExecutionArtifactRetentionClass,
  createdAt = new Date(),
): Date {
  return new Date(createdAt.getTime() + DEFAULT_RETENTION_MS[retentionClass]);
}

const CLASSIFICATION_ORDER = [
  'public',
  'workspace',
  'personal',
  'sensitive',
] as const;

export function mostRestrictedClassification(values: string[]): string {
  return values.reduce((selected, value) => {
    const selectedIndex = CLASSIFICATION_ORDER.indexOf(selected as never);
    const valueIndex = CLASSIFICATION_ORDER.indexOf(value as never);
    if (valueIndex < 0) throw new Error('artifact_classification_invalid');
    return valueIndex > selectedIndex ? value : selected;
  }, 'public');
}

export function earliestArtifactExpiry(
  values: Array<Date | null | undefined>,
): Date | null | undefined {
  const dated = values.filter((value): value is Date => value instanceof Date);
  if (dated.length) {
    return new Date(Math.min(...dated.map((value) => value.getTime())));
  }
  return values.some((value) => value === null) ? null : undefined;
}

const RETENTION_ORDER: ExecutionArtifactRetentionClass[] = [
  'evaluation',
  'diagnostic',
  'operational',
];

export function mostRestrictiveRetentionClass(
  values: string[],
): ExecutionArtifactRetentionClass {
  return values.reduce<ExecutionArtifactRetentionClass>((selected, value) => {
    assertArtifactRetentionClass(value);
    return RETENTION_ORDER.indexOf(value) > RETENTION_ORDER.indexOf(selected)
      ? value
      : selected;
  }, 'evaluation');
}

export function derivedArtifactPolicy(
  artifacts: Array<{
    artifactId: string;
    dataClassification: string;
    retentionClass: string;
    expiresAt: Date | null;
    inputSourceIds: string[];
  }>,
  createdAt = new Date(),
): {
  dataClassification: string;
  retentionClass: ExecutionArtifactRetentionClass;
  expiresAt: Date;
  inputSourceIds: string[];
  derivedFromArtifactIds: string[];
} {
  const retentionClass = mostRestrictiveRetentionClass([
    'evaluation',
    ...artifacts.map((artifact) => artifact.retentionClass),
  ]);
  return {
    dataClassification: mostRestrictedClassification([
      'workspace',
      ...artifacts.map((artifact) => artifact.dataClassification),
    ]),
    retentionClass,
    expiresAt: earliestArtifactExpiry([
      defaultArtifactExpiry(retentionClass, createdAt),
      ...artifacts.map((artifact) => artifact.expiresAt),
    ])!,
    inputSourceIds: [
      ...new Set(
        artifacts.flatMap((artifact) => artifact.inputSourceIds ?? []),
      ),
    ],
    derivedFromArtifactIds: [
      ...new Set(artifacts.map((artifact) => artifact.artifactId)),
    ],
  };
}
