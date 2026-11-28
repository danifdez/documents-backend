import { strict as assert } from 'assert';
import { Controller, Post, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createServer } from 'http';
import { AddressInfo } from 'net';
import { TelemetryModule } from '../../src/telemetry/telemetry.module';
import {
  executionTraceContext,
  recordExecutionEvent,
} from '../../src/telemetry/telemetry';

@Controller('probe')
class ProbeController {
  @Post()
  async probe() {
    await Promise.resolve();
    const traceContext = executionTraceContext();
    const occurredAt = new Date();
    for (const name of [
      'documents.execution.created',
      'documents.artifact.expired',
    ]) {
      recordExecutionEvent({
        traceContext,
        metadata: {
          name,
          occurredAt,
          startedAt: occurredAt,
          attributes: {},
          failed: false,
        },
      });
    }
    return traceContext;
  }
}

async function main(): Promise<void> {
  // Export only to the ephemeral receiver, using no operator credentials.
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('OTEL_EXPORTER_OTLP')) delete process.env[key];
  }
  delete process.env.OTEL_SDK_DISABLED;
  const executionsOnly = process.argv.includes('--executions-only');
  process.env.OTEL_DOCUMENTS_EXECUTIONS_ONLY = String(executionsOnly);
  const chunks: Buffer[] = [];
  const receiver = createServer((req, res) => {
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/x-protobuf');
      res.end();
    });
  });
  await new Promise<void>((resolve) =>
    receiver.listen(0, '127.0.0.1', resolve),
  );
  const port = (receiver.address() as AddressInfo).port;
  process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = `http://127.0.0.1:${port}/v1/traces`;
  let app: INestApplication | undefined;
  try {
    const module = await Test.createTestingModule({
      imports: [TelemetryModule],
      controllers: [ProbeController],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    const lifecycle = app.get(TelemetryModule);
    let shutdownCalls = 0;
    const shutdown = lifecycle.onApplicationShutdown.bind(lifecycle);
    lifecycle.onApplicationShutdown = async () => {
      shutdownCalls++;
      await shutdown();
    };
    await app.listen(0, '127.0.0.1');
    const roots = [
      '0123456789abcdef0123456789abcdef',
      'fedcba9876543210fedcba9876543210',
    ];
    const url = `${await app.getUrl()}/probe?token=PRIVATE_REQUEST_SECRET`;
    const saved = await Promise.all(
      roots.map(async (root) => {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            authorization: 'Bearer PRIVATE_REQUEST_SECRET',
            baggage: 'key=PRIVATE_REQUEST_SECRET',
            traceparent: `00-${root}-0123456789abcdef-01`,
          },
          body: 'PRIVATE_REQUEST_SECRET',
        });
        assert.equal(response.status, 201);
        return response.json();
      }),
    );
    const traceIds = saved.map((item) => item.traceparent.slice(3, 35));
    if (executionsOnly) {
      assert.equal(new Set(traceIds).size, roots.length);
    } else {
      assert.deepEqual(traceIds, roots);
    }
    await app.close();
    app = undefined;
    assert.ok(shutdownCalls > 0);
    const wire = Buffer.concat(chunks);
    assert.ok(wire.length > 0);
    assert.equal(wire.includes(Buffer.from('PRIVATE_REQUEST_SECRET')), false);
    assert.equal(wire.includes(Buffer.from('HTTP POST')), !executionsOnly);
    assert.equal(
      wire.includes(Buffer.from('documents.background')),
      executionsOnly,
    );
    assert.equal(
      wire.includes(Buffer.from('documents.execution.created')),
      true,
    );
    assert.equal(
      wire.includes(Buffer.from('documents.artifact.expired')),
      !executionsOnly,
    );
    console.log(
      JSON.stringify({
        exported: true,
        contextsIsolated: true,
        privateContentAbsent: true,
      }),
    );
  } finally {
    await app?.close();
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
