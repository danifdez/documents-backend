import { BadRequestException } from '@nestjs/common';
import { parseDatasetAnalysisRequest } from '../../../src/dataset/dataset-analysis-request';

describe('parseDatasetAnalysisRequest', () => {
  it('builds only the payload fields accepted by the selected operation', () => {
    expect(
      parseDatasetAnalysisRequest(
        'distribution',
        { field: 'amount', bins: 12, ignored: 'value' },
        'summary',
      ),
    ).toEqual({
      operation: 'distribution',
      params: { field: 'amount', bins: 12 },
    });
  });

  it('uses the endpoint default operation when none is provided', () => {
    expect(parseDatasetAnalysisRequest(undefined, {}, 'summary')).toEqual({
      operation: 'summary',
      params: {},
    });
  });

  it('normalizes chart filters and optional controls', () => {
    expect(
      parseDatasetAnalysisRequest(
        'chart',
        {
          xField: 'month',
          yField: 'total',
          chartType: 'line',
          aggregation: 'sum',
          sortBy: 'label',
          sortOrder: 'asc',
          limit: 20,
          filters: [{ field: 'active', value: true }],
        },
        'summary',
      ),
    ).toEqual({
      operation: 'chart',
      params: {
        xField: 'month',
        yField: 'total',
        chartType: 'line',
        aggregation: 'sum',
        sortBy: 'label',
        sortOrder: 'asc',
        limit: 20,
        filters: [{ field: 'active', operator: 'eq', value: true }],
      },
    });
  });

  it.each([
    ['unsupported operation', 'other', {}],
    ['missing required field', 'correlation', { field1: 'amount' }],
    ['invalid bins', 'distribution', { field: 'amount', bins: 0 }],
    [
      'invalid filter value',
      'query',
      { filters: [{ field: 'owner', value: { id: 1 } }] },
    ],
  ])('rejects %s', (_case, operation, params) => {
    expect(() =>
      parseDatasetAnalysisRequest(operation, params, 'summary'),
    ).toThrow(BadRequestException);
  });
});
