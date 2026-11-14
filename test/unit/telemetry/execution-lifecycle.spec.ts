import { executionEventMetadata } from '../../../src/telemetry/execution-lifecycle';
import { EXECUTION_EVENT_PAYLOADS } from '../../../src/execution/execution.constants';

const uuid = '01234567-89ab-4def-8123-456789abcdef';
describe('canonical execution telemetry projection', () => {
  it('covers every canonical event family using fixed event names', () => {
    for (const type of Object.keys(EXECUTION_EVENT_PAYLOADS)) {
      expect(
        executionEventMetadata({
          traceContext: null,
          envelope: {
            eventType: type,
            occurredAt: '2026-11-14T12:00:01Z',
            eventId: uuid,
            executionId: uuid,
            payload: { initialStatus: 'queued' },
          },
        }),
      ).not.toBeNull();
    }
  });
  it.each(['running', 'waiting', 'completed', 'failed', 'cancelled'])(
    'projects the canonical %s transition',
    (state) => {
      const event = executionEventMetadata({
        traceContext: null,
        startedAt: new Date('2026-11-14T12:00:00Z'),
        envelope: {
          eventType: 'execution.state_changed',
          occurredAt: '2026-11-14T12:00:01Z',
          payload: { from: 'running', to: state },
        },
      })!;
      expect(event.attributes['execution.to']).toBe(state);
      expect(event.failed).toBe(state === 'failed');
      expect(event.occurredAt.getTime() - event.startedAt.getTime()).toBe(1000);
    },
  );
  it('keeps attempts and retryability while excluding product content and arbitrary enums', () => {
    const event = executionEventMetadata({
      traceContext: null,
      envelope: {
        eventType: 'operation.finished',
        occurredAt: '2026-11-14T12:00:01Z',
        eventId: uuid,
        operationId: uuid,
        attemptId: uuid,
        actor: { token: 'PRIVATE' },
        payload: {
          status: 'failed',
          from: 'PRIVATE',
          operationKind: 'PRIVATE',
          result: 'PRIVATE',
          error: { message: 'PRIVATE', retryable: true },
        },
      },
    })!;
    expect(event.attributes['execution.attemptId']).toBe(uuid);
    expect(event.attributes['execution.retryable']).toBe(true);
    expect(JSON.stringify(event)).not.toContain('PRIVATE');
    expect(
      executionEventMetadata({
        traceContext: null,
        envelope: { eventType: 'PRIVATE', occurredAt: '2026-11-14T12:00:01Z' },
      }),
    ).toBeNull();
  });
});
