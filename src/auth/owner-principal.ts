import { UnauthorizedException } from '@nestjs/common';

export function ownerPrincipalFromUser(
  user: unknown,
  fallback = 'standalone',
): string {
  if (!user || typeof user !== 'object') return fallback;
  const record = user as Record<string, unknown>;
  const principal = record.userId ?? record.sub;
  if (principal == null) return fallback;
  if (typeof principal === 'string' && principal.trim()) return principal;
  if (typeof principal === 'number' && Number.isSafeInteger(principal)) {
    return principal.toString();
  }
  throw new UnauthorizedException('Invalid user principal');
}
