import { Permission } from '../auth/permission.enum';
import { canonicalHash } from './execution-canonical';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ExecutionEntity } from './execution.entity';
import { ExecutionStepEntity } from './execution-step.entity';
import { ExecutionStepKind } from './execution-step-kind.enum';

// Consent is an explicit header; neither permissions nor ownership come from a DTO.
export function authorizeInferenceCapture(
  user: unknown,
  consent?: string,
): boolean {
  if (consent !== 'granted') return false;
  const authenticated = user as
    { userId?: unknown; permissions?: Record<string, boolean> } | undefined;
  if (
    !authenticated?.userId ||
    authenticated.permissions?.[Permission.EXPORT] !== true
  ) {
    throw new ForbiddenException(
      'Authenticated export permission is required to capture inference evidence',
    );
  }
  return true;
}

export const INFERENCE_EXCHANGE_KIND = 'inference_exchange';
export function inferenceCaptureAuthorization(ownerPrincipal?: string) {
  if (
    !ownerPrincipal ||
    ['standalone', 'system'].includes(ownerPrincipal) ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(ownerPrincipal)
  ) {
    throw new ForbiddenException(
      'Inference capture requires an authenticated owner',
    );
  }
  return {
    schemaVersion: 'inference-capture/1',
    purpose: 'evaluation',
    authorizedBy: ownerPrincipal,
  };
}

export function inferenceCaptureAuthorized(
  execution: ExecutionEntity,
  step: ExecutionStepEntity,
): boolean {
  const grant = step.work?.inferenceCapture as
    Record<string, unknown> | undefined;
  return (
    step.stepKind === ExecutionStepKind.INFERENCE &&
    !['standalone', 'system'].includes(execution.ownerPrincipal) &&
    grant?.schemaVersion === 'inference-capture/1' &&
    grant.purpose === 'evaluation' &&
    grant.authorizedBy === execution.ownerPrincipal
  );
}

export function assertInferenceExchange(
  body: Buffer,
  execution: ExecutionEntity,
  step: ExecutionStepEntity,
  attemptId: string,
): void {
  const reject = () => {
    throw new BadRequestException('invalid_inference_exchange');
  };
  if (!inferenceCaptureAuthorized(execution, step)) reject();
  let value: Record<string, any>;
  try {
    value = JSON.parse(body.toString('utf8'));
  } catch {
    reject();
  }
  if (
    value?.schemaVersion !== 'inference-exchange/1' ||
    value.executionId !== execution.executionId ||
    value.stepId !== step.stepId ||
    value.operationId !== step.operationId ||
    value.attemptId !== attemptId ||
    !Number.isInteger(value.callIndex) ||
    value.callIndex < 1 ||
    value.callIndex > 4 ||
    value.request?.method !== 'POST' ||
    !['/completion', '/v1/chat/completions'].includes(value.request?.path) ||
    ![
      'started',
      'completed',
      'http_error',
      'transport_error',
      'invalid_response',
      'response_too_large',
    ].includes(value.status)
  )
    reject();
  const keys = (object: unknown, allowed: string[]) => {
    if (
      !object ||
      typeof object !== 'object' ||
      Array.isArray(object) ||
      Object.keys(object).some((key) => !allowed.includes(key))
    )
      reject();
  };
  keys(value, [
    'schemaVersion',
    'executionId',
    'stepId',
    'operationId',
    'attemptId',
    'callIndex',
    'startedAt',
    'finishedAt',
    'durationMs',
    'status',
    'request',
    'response',
  ]);
  keys(value.request, ['method', 'path', 'mediaType', 'bodyBase64']);
  if (value.response !== null)
    keys(value.response, ['status', 'bodyBase64', 'omissionReason']);
  const base64 = (encoded: unknown) => {
    if (typeof encoded !== 'string' || encoded.length > 2_796_204) reject();
    const decoded = Buffer.from(encoded as string, 'base64');
    if (
      decoded.length > 2 * 1024 * 1024 ||
      decoded.toString('base64') !== encoded
    )
      reject();
  };
  base64(value.request.bodyBase64);
  if (value.response !== null) {
    if (
      !Number.isInteger(value.response?.status) ||
      value.response.status < 100 ||
      value.response.status > 599
    )
      reject();
    if (value.response.bodyBase64 !== null) base64(value.response.bodyBase64);
    else if (
      value.status !== 'response_too_large' ||
      value.response.omissionReason !== 'size_limit'
    )
      reject();
  }
  if (
    value.status === 'completed' &&
    (value.response === null ||
      typeof value.response?.bodyBase64 !== 'string' ||
      value.response.status < 200 ||
      value.response.status >= 300)
  )
    reject();
}

export const INFERENCE_RUNTIME_KIND = 'inference_runtime';

export function assertInferenceRuntimeCapture(
  body: Buffer,
  execution: ExecutionEntity,
  step: ExecutionStepEntity,
  attemptId: string,
): boolean {
  let value: Record<string, any>;
  try {
    value = JSON.parse(body.toString('utf8'));
  } catch {
    rejectInvalidInferenceRuntime();
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    rejectInvalidInferenceRuntime();
  if (!Object.hasOwn(value, 'templates')) return false;
  const pool = value.templates;
  if (!pool || typeof pool !== 'object' || Array.isArray(pool))
    rejectInvalidInferenceRuntime();
  if (Object.keys(pool).length === 0) return false;
  if (
    !inferenceCaptureAuthorized(execution, step) ||
    value.schemaVersion !== 'inference-runtime/1' ||
    value.executionId !== execution.executionId ||
    value.stepId !== step.stepId ||
    value.operationId !== step.operationId ||
    value.attemptId !== attemptId ||
    !Array.isArray(value.calls) ||
    value.calls.length > 128 ||
    Object.keys(pool).length > 256
  )
    rejectInvalidInferenceRuntime();
  const references = inferenceRuntimeTemplateReferences(value.calls);
  for (const [hash, template] of Object.entries(pool)) {
    if (
      typeof template !== 'string' ||
      template.length === 0 ||
      template.length > 256 * 1024 ||
      Buffer.from(template, 'utf8').toString('utf8') !== template ||
      !references.has(hash) ||
      canonicalHash(template) !== hash
    )
      rejectInvalidInferenceRuntime();
  }
  if (Buffer.byteLength(JSON.stringify(pool), 'utf8') > 256 * 1024)
    rejectInvalidInferenceRuntime();
  return true;
}

function inferenceRuntimeTemplateReferences(
  calls: Array<{
    callIndex: number;
    engine?: { properties?: Record<string, unknown> };
  }>,
): Set<string> {
  const references = new Set<string>();
  for (const [index, call] of calls.entries()) {
    if (call?.callIndex !== index + 1) rejectInvalidInferenceRuntime();
    const properties = call.engine?.properties ?? {};
    for (const name of ['chatTemplateHash', 'toolTemplateHash']) {
      if (Object.hasOwn(properties, name)) {
        const hash = properties[name];
        if (typeof hash !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(hash))
          rejectInvalidInferenceRuntime();
        references.add(hash);
      }
    }
  }
  return references;
}

function rejectInvalidInferenceRuntime(): never {
  throw new BadRequestException('invalid_inference_runtime');
}
