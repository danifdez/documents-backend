import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';

const INSECURE_SECRETS = ['change-me-in-production', 'default-dev-secret-change-me', ''];

let fallbackSecret: string | null = null;

export function getJwtSecret(configService: ConfigService): string {
  const secret = configService.get<string>('JWT_SECRET', '');
  const authEnabled = configService.get('AUTH_ENABLED') === 'true';

  if (secret && !INSECURE_SECRETS.includes(secret)) {
    return secret;
  }

  if (authEnabled) {
    throw new Error(
      'AUTH_ENABLED is true but JWT_SECRET is not set or uses an insecure default. ' +
        'Set a strong, unique JWT_SECRET before running in production!',
    );
  }

  // Auth disabled: generate a random ephemeral secret (consistent across module and strategy)
  if (!fallbackSecret) {
    fallbackSecret = randomBytes(64).toString('hex');
  }
  return fallbackSecret;
}
