import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  if (
    typeof value === 'number' &&
    (!Number.isFinite(value) || !Number.isInteger(value))
  ) {
    throw new BadRequestException(
      'Canonical execution values must use finite integers',
    );
  }
  return value;
}

function canonicalizeDomainValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeDomainValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalizeDomainValue(child)]),
    );
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new BadRequestException('Canonical domain values must be finite');
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function contentHash(value: Buffer | string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function canonicalHash(value: unknown): string {
  return contentHash(canonicalJson(value));
}

export function canonicalDomainHash(value: unknown): string {
  return contentHash(JSON.stringify(canonicalizeDomainValue(value)));
}
