import {
  safeEndpoint,
  safeTraceContext,
  tracedWork,
} from '../../../src/telemetry/telemetry';

describe('metadata-only telemetry boundary', () => {
  const traceparent = '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01';
  it('keeps only validated W3C identifiers', () => {
    expect(
      safeTraceContext({
        traceparent,
        baggage: 'secret',
        tracestate: 'secret',
      }),
    ).toEqual({ traceparent });
    for (const value of [
      null,
      {},
      { traceparent: 'secret' },
      { traceparent: traceparent + '\n' },
      {
        traceparent: traceparent.replace(
          '0123456789abcdef0123456789abcdef',
          '0'.repeat(32),
        ),
      },
    ]) {
      expect(safeTraceContext(value)).toBeNull();
    }
  });
  it('requires TLS remotely and rejects URL credentials and query strings', () => {
    expect(safeEndpoint('https://collector.example/v1/traces')).toBe(true);
    expect(safeEndpoint('http://127.0.0.1:4318/v1/traces')).toBe(true);
    for (const url of [
      'http://collector.example',
      'https://user:password@host',
      'https://host?token=secret',
      'https://host/#fragment',
      'file:///tmp/traces',
    ]) {
      expect(safeEndpoint(url)).toBe(false);
    }
  });
  it('uses persisted server context instead of a supplied work context', () => {
    const work = {
      taskType: 'test',
      payload: { content: 'private' },
      traceContext: { traceparent: 'forged' },
    };
    expect(tracedWork(work, { traceparent })).toEqual({
      taskType: 'test',
      payload: work.payload,
      traceContext: { traceparent },
    });
    expect(tracedWork(work, null)).toEqual({
      taskType: 'test',
      payload: work.payload,
    });
    expect(work.traceContext.traceparent).toBe('forged');
  });
});
