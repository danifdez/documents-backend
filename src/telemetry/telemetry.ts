import {
  context,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  AlwaysOnSampler,
  TracerProvider,
} from '@opentelemetry/sdk-trace';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import type { Request, Response, NextFunction } from 'express';
import { ExecutionEventSnapshot } from './execution-lifecycle';

export type TraceContext = { traceparent: string };
let provider: TracerProvider | undefined;
let executionsOnly = false;
const w3c = new W3CTraceContextPropagator();

// Only fixed-size W3C identifiers cross the durable queue. Never propagate
// baggage, tracestate, request headers, or product content as telemetry.
export function safeTraceContext(value: unknown): TraceContext | null {
  const parent = (value as TraceContext)?.traceparent;
  if (
    typeof parent !== 'string' ||
    parent.length !== 55 ||
    !/^00-(?!0{32}-)[0-9a-f]{32}-(?!0{16}-)[0-9a-f]{16}-0[01]$/.test(parent)
  )
    return null;
  return { traceparent: parent };
}

export function safeEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      value.length <= 2048 &&
      !/[\s\\]/.test(value) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' &&
          ['127.0.0.1', '[::1]'].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}

export function configureTelemetry(): void {
  try {
    configureTelemetryInternal();
  } finally {
    // The exporter snapshots endpoints, headers and TLS credentials. Do not pass
    // them on to Puppeteer or other child processes.
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('OTEL_EXPORTER_OTLP')) delete process.env[key];
    }
  }
}

function configureTelemetryInternal(): void {
  if (provider || process.env.OTEL_SDK_DISABLED === 'true') return;
  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/$/, '') + '/v1/traces';
  if (
    !process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT &&
    !process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  )
    return;
  const protocol =
    process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL ||
    process.env.OTEL_EXPORTER_OTLP_PROTOCOL;
  if (
    !safeEndpoint(endpoint) ||
    (endpoint.startsWith('https:') &&
      process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') ||
    (protocol && protocol !== 'http/protobuf')
  ) {
    console.warn('OpenTelemetry disabled: invalid endpoint or protocol');
    return;
  }
  executionsOnly = process.env.OTEL_DOCUMENTS_EXECUTIONS_ONLY === 'true';
  provider = new TracerProvider({
    resource: resourceFromAttributes({ 'service.name': 'documents-backend' }),
    sampler: new ParentBasedSampler({ root: new AlwaysOnSampler() }),
    spanLimits: {
      attributeCountLimit: 24,
      attributeValueLengthLimit: 160,
      eventCountLimit: 0,
      linkCountLimit: 0,
    },
    spanProcessors: [
      new BatchSpanProcessor({
        exporter: new OTLPTraceExporter({ url: endpoint, timeoutMillis: 3000 }),
        maxQueueSize: 512,
        maxExportBatchSize: 64,
        scheduledDelayMillis: 1000,
        exportTimeoutMillis: 3000,
      }),
    ],
  });
  trace.setGlobalTracerProvider(provider);
  context.setGlobalContextManager(
    new AsyncLocalStorageContextManager().enable(),
  );
  propagation.setGlobalPropagator(w3c);
}

export async function shutdownTelemetry(): Promise<void> {
  await provider?.shutdown();
}

export function traceRequest(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Durable execution events and model spans still share an execution context.
  if (!provider || executionsOnly) {
    next();
    return;
  }
  const carrier =
    safeTraceContext({ traceparent: req.headers.traceparent }) ?? {};
  const parent = propagation.extract(ROOT_CONTEXT, carrier);
  const method = [
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'HEAD',
    'OPTIONS',
  ].includes(req.method)
    ? req.method
    : '_OTHER';
  const span = trace.getTracer('documents-backend').startSpan(
    'HTTP ' + method,
    {
      kind: SpanKind.SERVER,
      attributes: { 'http.request.method': method },
    },
    parent,
  );
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    span.setAttribute('http.response.status_code', res.statusCode);
    // Route templates contain no resource IDs, query strings, or user input.
    if (typeof req.route?.path === 'string')
      span.setAttribute('http.route', req.route.path);
    if (res.statusCode >= 500 || !res.writableFinished)
      span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
  };
  res.once('finish', end);
  res.once('close', end);
  context.with(trace.setSpan(parent, span), next);
}

export function isTelemetryEnabled(): boolean {
  return Boolean(provider);
}

export function executionTraceContext(
  inherited?: TraceContext | null,
): TraceContext | null {
  if (!provider) return null;
  const parent = safeTraceContext(inherited);
  if (parent) return parent;
  let ctx = context.active();
  if (!trace.getSpanContext(ctx)) {
    const anchor = trace
      .getTracer('documents-backend')
      .startSpan('documents.background');
    ctx = trace.setSpan(ROOT_CONTEXT, anchor);
    anchor.end();
  }
  const carrier: Record<string, string> = {};
  propagation.inject(ctx, carrier);
  return safeTraceContext(carrier);
}

export function recordExecutionEvent(event: ExecutionEventSnapshot): void {
  if (!provider) return;
  const metadata = event.metadata;
  if (
    !metadata ||
    (executionsOnly && metadata.name === 'documents.artifact.expired')
  )
    return;
  const carrier = safeTraceContext(event.traceContext);
  const parent = carrier
    ? propagation.extract(ROOT_CONTEXT, carrier)
    : ROOT_CONTEXT;
  const span = trace.getTracer('documents-backend').startSpan(
    metadata.name,
    {
      attributes: metadata.attributes,
      startTime: metadata.startedAt,
    },
    parent,
  );
  if (metadata.failed) span.setStatus({ code: SpanStatusCode.ERROR });
  span.end(metadata.occurredAt);
}

export function tracedWork(
  work: Record<string, unknown>,
  saved: unknown,
): Record<string, unknown> {
  const rest = { ...work };
  delete rest.traceContext;
  const carrier = safeTraceContext(saved);
  return carrier ? { ...rest, traceContext: carrier } : rest;
}
