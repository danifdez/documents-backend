import { ExecutionTelemetrySubscriber } from '../../../src/telemetry/execution-telemetry.subscriber';
import { ExecutionEntity } from '../../../src/execution/execution.entity';
import * as telemetry from '../../../src/telemetry/telemetry';

describe('execution-event commit observer', () => {
  const traceparent = '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01';
  let subscriber: ExecutionTelemetrySubscriber;
  let queryRunner: any;
  let manager: any;
  let publish: jest.SpyInstance;
  const row = (eventType = 'execution.state_changed', to = 'running') => ({
    executionId: '01234567-89ab-4def-8123-456789abcdef',
    eventType,
    envelope: {
      eventType,
      occurredAt: '2026-11-14T12:00:01Z',
      payload: { to, result: 'PRIVATE' },
    },
  });
  beforeEach(() => {
    subscriber = new ExecutionTelemetrySubscriber();
    queryRunner = { data: {}, isTransactionActive: true };
    const executionRepo = {
      findOne: jest.fn().mockResolvedValue({
        traceContext: { traceparent },
        createdAt: new Date('2026-11-14T12:00:00Z'),
      }),
    };
    const eventRepo = { findOne: jest.fn().mockResolvedValue(null) };
    manager = {
      getRepository: jest.fn((entity) =>
        entity === ExecutionEntity ? executionRepo : eventRepo,
      ),
    };
    jest.spyOn(telemetry, 'isTelemetryEnabled').mockReturnValue(true);
    publish = jest
      .spyOn(telemetry, 'recordExecutionEvent')
      .mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());
  const tx = () => ({ queryRunner }) as any;
  const insert = (entity = row()) =>
    subscriber.afterInsert({ queryRunner, manager, entity } as any);

  it('emits once after commit and never retains raw product content', async () => {
    subscriber.afterTransactionStart(tx());
    await insert();
    expect(publish).not.toHaveBeenCalled();
    expect(JSON.stringify(queryRunner.data)).not.toContain('PRIVATE');
    queryRunner.isTransactionActive = false;
    subscriber.afterTransactionCommit(tx());
    subscriber.afterTransactionCommit(tx());
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0].traceContext).toEqual({ traceparent });
  });
  it('discards rolled-back events', async () => {
    subscriber.afterTransactionStart(tx());
    await insert();
    queryRunner.isTransactionActive = false;
    subscriber.afterTransactionRollback(tx());
    subscriber.afterTransactionCommit(tx());
    expect(publish).not.toHaveBeenCalled();
  });
  it('keeps savepoint events private and drops nested rollbacks', async () => {
    subscriber.afterTransactionStart(tx());
    await insert();
    subscriber.afterTransactionStart(tx());
    await insert(row('execution.state_changed', 'failed'));
    subscriber.afterTransactionRollback(tx());
    subscriber.afterTransactionStart(tx());
    await insert(row('execution.state_changed', 'completed'));
    subscriber.afterTransactionCommit(tx());
    expect(publish).not.toHaveBeenCalled();
    queryRunner.isTransactionActive = false;
    subscriber.afterTransactionCommit(tx());
    expect(
      publish.mock.calls.map(
        ([event]) => event.metadata.attributes['execution.to'],
      ),
    ).toEqual(['running', 'completed']);
  });
  it('does not query or observe when disabled', async () => {
    jest.mocked(telemetry.isTelemetryEnabled).mockReturnValue(false);
    subscriber.afterTransactionStart(tx());
    await insert();
    expect(manager.getRepository).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
  it('observer errors never fail the product commit', async () => {
    subscriber.afterTransactionStart(tx());
    await insert();
    publish.mockImplementation(() => {
      throw new Error('observer unavailable');
    });
    queryRunner.isTransactionActive = false;
    expect(() => subscriber.afterTransactionCommit(tx())).not.toThrow();
  });
  it('observes autocommitted inserts without a synthetic transaction', async () => {
    queryRunner.isTransactionActive = false;
    await insert();
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
