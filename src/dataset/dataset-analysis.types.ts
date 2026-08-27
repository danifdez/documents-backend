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

export type DatasetAggregateFunction =
  'mean' | 'sum' | 'count' | 'min' | 'max' | 'median';

export interface DatasetFilterPayload {
  field: string;
  operator: 'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains';
  value: string | number | boolean;
}

export interface DatasetAnalysisParamsByTaskType {
  distribution: { field: string; bins?: number | 'auto' };
  correlation: { field1: string; field2: string };
  'correlation-matrix': { fields?: string[] };
  'group-by': {
    valueField: string;
    groupField: string;
    fn?: DatasetAggregateFunction;
  };
  'time-series': {
    dateField: string;
    valueField: string;
    period?: 'ME' | 'QE' | 'YE' | 'M' | 'Q' | 'Y' | 'A';
  };
  outliers: { field: string };
  'pivot-table': {
    rowField: string;
    colField: string;
    valueField?: string;
    fn?: DatasetAggregateFunction;
  };
  summary: { [key: string]: never };
  query: {
    joinField?: string;
    filters?: DatasetFilterPayload[];
    select?: string[];
    groupBy?: string;
    fn?: DatasetAggregateFunction;
    chartType?: string;
  };
  chart: {
    chartType?: 'bar' | 'line' | 'pie' | 'scatter';
    xField: string;
    yField?: string;
    aggregation?: DatasetAggregateFunction;
    sortBy?: 'label' | 'value';
    sortOrder?: 'asc' | 'desc';
    limit?: number;
    filters?: DatasetFilterPayload[];
  };
}

export type DatasetAnalysisRequest = {
  [TTaskType in DatasetAnalysisTaskType]: {
    operation: TTaskType;
    params: DatasetAnalysisParamsByTaskType[TTaskType];
  };
}[DatasetAnalysisTaskType];

export function isDatasetAnalysisTaskType(
  value: string,
): value is DatasetAnalysisTaskType {
  return (DATASET_ANALYSIS_TASK_TYPES as readonly string[]).includes(value);
}
