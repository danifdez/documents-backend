import { BadRequestException } from '@nestjs/common';
import type { IncomingExecutionArtifact } from './execution.types';

const PRIVATE_REASONING_PATTERN = /<think>[\s\S]*?<\/think>/gi;
const BEARER_PATTERN = /\bbearer\s+[a-z0-9._~+/-]+=*/gi;
const SECRET_VALUE_PATTERN =
  /\b(access[_-]?token|api[_-]?key|auth[_-]?token|authorization|cookie|id[_-]?token|password|refresh[_-]?token|session[_-]?token|token)\s*[:=]\s*(?!\[REDACTED\])([^\s,;]+)/gi;
const PRIVATE_REASONING_DETECTOR = /<think>[\s\S]*?<\/think>/i;
const BEARER_DETECTOR = /\bbearer\s+[a-z0-9._~+/-]+=*/i;
const SECRET_VALUE_DETECTOR =
  /\b(access[_-]?token|api[_-]?key|auth[_-]?token|authorization|cookie|id[_-]?token|password|refresh[_-]?token|session[_-]?token|token)\s*[:=]\s*(?!\[REDACTED\])([^\s,;]+)/i;
const REDACTED_VALUE = '[REDACTED]';

const FORBIDDEN_KEYS = new Set([
  'accesstoken',
  'apikey',
  'authtoken',
  'authorization',
  'chainofthought',
  'cookie',
  'credential',
  'idtoken',
  'password',
  'refreshtoken',
  'secret',
  'sessiontoken',
  'thoughts',
]);

export function redactExecutionText(value: string): string {
  return value
    .replace(PRIVATE_REASONING_PATTERN, '')
    .replace(BEARER_PATTERN, 'Bearer [REDACTED]')
    .replace(SECRET_VALUE_PATTERN, '$1=[REDACTED]');
}

export function rejectForbiddenData(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      rejectForbiddenData(child, `${path}[${index}]`),
    );
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (FORBIDDEN_KEYS.has(normalized)) {
      if (child === REDACTED_VALUE) continue;
      throw new BadRequestException(
        `${path}.${key} is forbidden in execution data`,
      );
    }
    rejectForbiddenData(child, `${path}.${key}`);
  }
}

function rejectSensitiveStrings(value: unknown, path = '$'): void {
  if (typeof value === 'string') {
    if (
      PRIVATE_REASONING_DETECTOR.test(value) ||
      BEARER_DETECTOR.test(value) ||
      SECRET_VALUE_DETECTOR.test(value)
    ) {
      throw new BadRequestException(
        `${path} contains unredacted sensitive text`,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      rejectSensitiveStrings(child, `${path}[${index}]`),
    );
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    rejectSensitiveStrings(child, `${path}.${key}`);
  }
}

export function rejectSensitiveArtifactBody(
  artifact: IncomingExecutionArtifact,
  body: Buffer,
): void {
  if (!/^(text\/|application\/(json|[^;]+\+json))/.test(artifact.mediaType)) {
    return;
  }
  const text = body.toString('utf8');
  if (/^application\/(json|[^;]+\+json)/.test(artifact.mediaType)) {
    try {
      const value = JSON.parse(text);
      rejectForbiddenData(value, '$artifact');
      rejectSensitiveStrings(value, '$artifact');
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
    }
    return;
  }
  if (
    PRIVATE_REASONING_DETECTOR.test(text) ||
    BEARER_DETECTOR.test(text) ||
    SECRET_VALUE_DETECTOR.test(text)
  ) {
    throw new BadRequestException(
      `Artifact contains unredacted sensitive text: ${artifact.artifactId}`,
    );
  }
}
