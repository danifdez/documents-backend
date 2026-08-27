import { BadRequestException } from '@nestjs/common';
import {
  DatasetAggregateFunction,
  DatasetAnalysisRequest,
  DatasetAnalysisTaskType,
  DatasetFilterPayload,
  isDatasetAnalysisTaskType,
} from './dataset-analysis.types';

const AGGREGATE_FUNCTIONS = new Set<DatasetAggregateFunction>([
  'mean',
  'sum',
  'count',
  'min',
  'max',
  'median',
]);

export function parseDatasetAnalysisRequest(
  operationValue: unknown,
  paramsValue: unknown,
  defaultOperation: DatasetAnalysisTaskType,
): DatasetAnalysisRequest {
  const operation =
    typeof operationValue === 'string' && operationValue
      ? operationValue
      : defaultOperation;
  if (!isDatasetAnalysisTaskType(operation)) {
    throw new BadRequestException('Unsupported dataset analysis operation');
  }
  const params = objectValue(paramsValue);
  switch (operation) {
    case 'distribution':
      return {
        operation,
        params: {
          field: requiredString(params, 'field'),
          ...optionalBins(params),
        },
      };
    case 'correlation':
      return {
        operation,
        params: {
          field1: requiredString(params, 'field1'),
          field2: requiredString(params, 'field2'),
        },
      };
    case 'correlation-matrix':
      return {
        operation,
        params: optionalStringArray(params, 'fields'),
      };
    case 'group-by':
      return {
        operation,
        params: {
          valueField: requiredString(params, 'valueField'),
          groupField: requiredString(params, 'groupField'),
          ...optionalAggregate(params, 'fn'),
        },
      };
    case 'time-series':
      return {
        operation,
        params: {
          dateField: requiredString(params, 'dateField'),
          valueField: requiredString(params, 'valueField'),
          ...optionalEnum(params, 'period', [
            'ME',
            'QE',
            'YE',
            'M',
            'Q',
            'Y',
            'A',
          ] as const),
        },
      };
    case 'outliers':
      return {
        operation,
        params: { field: requiredString(params, 'field') },
      };
    case 'pivot-table':
      return {
        operation,
        params: {
          rowField: requiredString(params, 'rowField'),
          colField: requiredString(params, 'colField'),
          ...optionalString(params, 'valueField'),
          ...optionalAggregate(params, 'fn'),
        },
      };
    case 'summary':
      return { operation, params: {} };
    case 'query':
      return {
        operation,
        params: {
          ...optionalString(params, 'joinField'),
          ...optionalFilters(params),
          ...optionalStringArray(params, 'select'),
          ...optionalString(params, 'groupBy'),
          ...optionalAggregate(params, 'fn'),
          ...optionalString(params, 'chartType'),
        },
      };
    case 'chart':
      return {
        operation,
        params: {
          xField: requiredString(params, 'xField'),
          ...optionalString(params, 'yField'),
          ...optionalEnum(params, 'chartType', [
            'bar',
            'line',
            'pie',
            'scatter',
          ] as const),
          ...optionalAggregate(params, 'aggregation'),
          ...optionalEnum(params, 'sortBy', ['label', 'value'] as const),
          ...optionalEnum(params, 'sortOrder', ['asc', 'desc'] as const),
          ...optionalPositiveInteger(params, 'limit'),
          ...optionalFilters(params),
        },
      };
  }
}

function objectValue(value: unknown): { [key: string]: unknown } {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Dataset analysis params must be an object');
  }
  return value as { [key: string]: unknown };
}

function requiredString(
  params: { [key: string]: unknown },
  key: string,
): string {
  const value = params[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException(`Dataset analysis ${key} is required`);
  }
  return value;
}

function optionalString(
  params: { [key: string]: unknown },
  key: string,
): { [key: string]: string } | { [key: string]: never } {
  const value = params[key];
  if (value === undefined || value === null || value === '') return {};
  if (typeof value !== 'string') {
    throw new BadRequestException(`Dataset analysis ${key} must be a string`);
  }
  return { [key]: value };
}

function optionalStringArray(
  params: { [key: string]: unknown },
  key: string,
): { [key: string]: string[] } | { [key: string]: never } {
  const value = params[key];
  if (value === undefined || value === null) return {};
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new BadRequestException(
      `Dataset analysis ${key} must be an array of strings`,
    );
  }
  return { [key]: value };
}

function optionalAggregate(
  params: { [key: string]: unknown },
  key: string,
): { [key: string]: DatasetAggregateFunction } | { [key: string]: never } {
  const value = params[key];
  if (value === undefined || value === null || value === '') return {};
  if (
    typeof value !== 'string' ||
    !AGGREGATE_FUNCTIONS.has(value as DatasetAggregateFunction)
  ) {
    throw new BadRequestException(
      `Dataset analysis ${key} has an unsupported value`,
    );
  }
  return { [key]: value as DatasetAggregateFunction };
}

function optionalEnum<TValue extends string>(
  params: { [key: string]: unknown },
  key: string,
  values: readonly TValue[],
): { [key: string]: TValue } | { [key: string]: never } {
  const value = params[key];
  if (value === undefined || value === null || value === '') return {};
  if (typeof value !== 'string' || !values.includes(value as TValue)) {
    throw new BadRequestException(
      `Dataset analysis ${key} has an unsupported value`,
    );
  }
  return { [key]: value as TValue };
}

function optionalBins(params: {
  [key: string]: unknown;
}): { bins: number | 'auto' } | { [key: string]: never } {
  const value = params.bins;
  if (value === undefined || value === null || value === '') return {};
  if (value === 'auto') return { bins: value };
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new BadRequestException(
      'Dataset analysis bins must be auto or a positive integer',
    );
  }
  return { bins: value };
}

function optionalPositiveInteger(
  params: { [key: string]: unknown },
  key: string,
): { [key: string]: number } | { [key: string]: never } {
  const value = params[key];
  if (value === undefined || value === null || value === '') return {};
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new BadRequestException(
      `Dataset analysis ${key} must be a positive integer`,
    );
  }
  return { [key]: value };
}

function optionalFilters(params: {
  [key: string]: unknown;
}): { filters: DatasetFilterPayload[] } | { [key: string]: never } {
  const value = params.filters;
  if (value === undefined || value === null) return {};
  if (!Array.isArray(value)) {
    throw new BadRequestException('Dataset analysis filters must be an array');
  }
  const filters = value.map((entry) => {
    const filter = objectValue(entry);
    const operator = filter.operator ?? 'eq';
    if (
      typeof operator !== 'string' ||
      !['eq', 'gt', 'gte', 'lt', 'lte', 'contains'].includes(operator)
    ) {
      throw new BadRequestException(
        'Dataset analysis filter operator is unsupported',
      );
    }
    if (!['string', 'number', 'boolean'].includes(typeof filter.value)) {
      throw new BadRequestException(
        'Dataset analysis filter value must be scalar',
      );
    }
    return {
      field: requiredString(filter, 'field'),
      operator: operator as DatasetFilterPayload['operator'],
      value: filter.value as DatasetFilterPayload['value'],
    };
  });
  return { filters };
}
