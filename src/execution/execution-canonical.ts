import { compareStrings } from '../utils/compare-strings';
import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => compareStrings(left, right))
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
        .sort(([left], [right]) => compareStrings(left, right))
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

// Event payloads use the v1 canonical profile. Encode finite fractional
// numbers as strings and normalize missing array slots to JSON nulls.
export function canonicalProfileValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return Array.from(value, (child) => canonicalProfileValue(child) ?? null);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, child]) => [key, canonicalProfileValue(child)] as const)
        .filter(([, child]) => child !== undefined),
    );
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    if (!Number.isInteger(value)) return String(value);
  }
  if (typeof value === 'function' || typeof value === 'symbol')
    return undefined;
  return value;
}

export function canonicalDomainHash(value: unknown): string {
  return contentHash(JSON.stringify(canonicalizeDomainValue(value)));
}
