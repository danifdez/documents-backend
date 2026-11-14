import { strict as assert } from 'assert';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { AddressInfo } from 'net';
import { DataSource, DataSourceOptions, EntityManager } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { getTypeOrmConfig } from '../../src/database/typeorm.config';
import { ExecutionEntity } from '../../src/execution/execution.entity';
import { appendBackendExecutionEvent } from '../../src/execution/execution-event.writer';
import {
  configureTelemetry,
  executionTraceContext,
  shutdownTelemetry,
} from '../../src/telemetry/telemetry';

async function main(): Promise<void> {
  assert.equal(process.env.OTEL_TEST_DATABASE, 'isolated');
  assert.equal(process.env.POSTGRES_HOST, '127.0.0.1');
  assert.equal(process.env.POSTGRES_PORT, '5434');
  for (const key of Object.keys(process.env))
    if (key.startsWith('OTEL_EXPORTER_OTLP')) delete process.env[key];
  delete process.env.OTEL_SDK_DISABLED;
  const wire: Buffer[] = [];
  const receiver = createServer((req, res) => {
    req.on('data', (chunk: Buffer) => wire.push(chunk));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/x-protobuf');
      res.end();
    });
  });
  await new Promise<void>((resolve) =>
    receiver.listen(0, '127.0.0.1', resolve),
  );
  process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/v1/traces`;
  configureTelemetry();
  const source = new DataSource(
    (await getTypeOrmConfig(
      new ConfigService({ RUN_MIGRATIONS: 'false' }),
    )) as DataSourceOptions,
  );
  const ids: string[] = [];
  const rolledBack: string[] = [];
  try {
    await source.initialize();
    const executionId = randomUUID();
    const root = await source.getRepository(ExecutionEntity).save({
      executionId,
      rootExecutionId: executionId,
      ownerPrincipal: 'telemetry-test',
      schemaVersion: 'execution/1',
      taskType: 'summarize-map',
      traceContext: executionTraceContext(),
    });
    let sequence = 0;
    const append = async (
      manager: EntityManager,
      type: string,
      payload: Record<string, unknown>,
      extra: Record<string, string> = {},
    ) => {
      const row = await appendBackendExecutionEvent(
        manager,
        root,
        ++sequence,
        {
          eventType: type,
          payloadSchema: type + '/1',
          payload,
          actor: { type: 'system' },
          executionId,
          ...extra,
        },
        sequence,
      );
      return row.eventId;
    };
    await source.transaction(async (manager) => {
      ids.push(
        await append(manager, 'execution.created', {
          initialStatus: 'queued',
          content: 'PRIVATE_LIFECYCLE_CONTENT',
        }),
      );
      ids.push(
        await append(manager, 'execution.state_changed', {
          from: 'queued',
          to: 'running',
        }),
      );
      const operationId = randomUUID();
      for (const status of ['failed', 'succeeded']) {
        const attemptId = randomUUID();
        const start = await append(
          manager,
          'operation.started',
          { operationKind: 'inference', status: 'dispatched' },
          { operationId, attemptId },
        );
        ids.push(start);
        ids.push(
          await append(
            manager,
            'operation.finished',
            {
              operationKind: 'inference',
              status,
              error: {
                message: 'PRIVATE_LIFECYCLE_CONTENT',
                retryable: status === 'failed',
              },
            },
            { operationId, attemptId, causedByEventId: start },
          ),
        );
      }
      const sentinel = new Error('savepoint rollback');
      try {
        await manager.transaction(async (nested) => {
          rolledBack.push(
            await append(nested, 'execution.state_changed', {
              from: 'running',
              to: 'failed',
            }),
          );
          throw sentinel;
        });
      } catch (error) {
        if (error !== sentinel) throw error;
      }
      ids.push(
        await append(manager, 'execution.state_changed', {
          from: 'running',
          to: 'waiting',
        }),
      );
      ids.push(
        await append(manager, 'execution.state_changed', {
          from: 'waiting',
          to: 'running',
        }),
      );
      ids.push(
        await append(manager, 'execution.state_changed', {
          from: 'running',
          to: 'completed',
        }),
      );
    });
    const sentinel = new Error('outer rollback');
    try {
      await source.transaction(async (manager) => {
        rolledBack.push(
          await append(manager, 'execution.state_changed', {
            from: 'running',
            to: 'cancelled',
          }),
        );
        throw sentinel;
      });
    } catch (error) {
      if (error !== sentinel) throw error;
    }
    // A fresh observer instance after a simulated restart uses the persisted
    // context, not an in-memory state machine.
    await source.destroy();
    await source.initialize();
    await source.transaction(async (manager) => {
      ids.push(
        await append(manager, 'execution.state_changed', {
          from: 'running',
          to: 'cancelled',
        }),
      );
      ids.push(
        await append(manager, 'execution.state_changed', {
          from: 'running',
          to: 'failed',
        }),
      );
    });
    await shutdownTelemetry();
    const body = Buffer.concat(wire);
    for (const id of ids)
      assert.ok(body.includes(Buffer.from(id)), 'committed event missing');
    for (const id of rolledBack)
      assert.equal(
        body.includes(Buffer.from(id)),
        false,
        'rollback was exported',
      );
    assert.equal(
      body.includes(Buffer.from('PRIVATE_LIFECYCLE_CONTENT')),
      false,
    );
    console.log(
      JSON.stringify({
        committed: ids.length,
        rolledBack: rolledBack.length,
        attempts: 2,
        restartContext: true,
        privateContentAbsent: true,
      }),
    );
  } finally {
    if (source.isInitialized) await source.destroy();
    await shutdownTelemetry();
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
