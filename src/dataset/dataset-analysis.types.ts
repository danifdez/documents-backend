export const DATASET_ANALYSIS_TASK_TYPES = [
  'distribution',
  'correlation',
  'correlation-matrix',
  'group-by',
  'time-series',
  'outliers',
  'pivot-table',
  'summary',
  'query',
  'chart',
] as const;

export type DatasetAnalysisTaskType =
  (typeof DATASET_ANALYSIS_TASK_TYPES)[number];

export function isDatasetAnalysisTaskType(
  value: string,
): value is DatasetAnalysisTaskType {
  return (DATASET_ANALYSIS_TASK_TYPES as readonly string[]).includes(value);
}
