export function ownerPrincipalFromUser(user: unknown): string {
  if (!user || typeof user !== 'object') return 'standalone';
  const record = user as Record<string, unknown>;
  return String(record.userId ?? record.sub ?? 'standalone');
}
