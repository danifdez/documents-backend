import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

@Injectable()
export class DataSourceEncryptionService {
  private readonly logger = new Logger(DataSourceEncryptionService.name);
  private readonly key: Buffer | null;

  constructor(private readonly configService: ConfigService) {
    const rawKey = this.configService.get<string>('DATASOURCE_ENCRYPTION_KEY');
    if (rawKey) {
      this.key = crypto.createHash('sha256').update(rawKey).digest();
    } else {
      this.key = null;
      this.logger.warn(
        'DATASOURCE_ENCRYPTION_KEY not set — data source credentials cannot be stored or read',
      );
    }
  }

  get isConfigured(): boolean {
    return this.key !== null;
  }

  encrypt(obj: Record<string, any>): string {
    if (!this.key) {
      throw new InternalServerErrorException(
        'DATASOURCE_ENCRYPTION_KEY is required to store data source credentials',
      );
    }

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
    const plaintext = JSON.stringify(obj);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  decrypt(ciphertext: string): Record<string, any> {
    if (!this.key) {
      throw new InternalServerErrorException(
        'DATASOURCE_ENCRYPTION_KEY is required to read data source credentials',
      );
    }

    try {
      const data = Buffer.from(ciphertext, 'base64');
      const iv = data.subarray(0, IV_LENGTH);
      const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
      const encrypted = data.subarray(IV_LENGTH + TAG_LENGTH);

      const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);

      return JSON.parse(decrypted.toString('utf8'));
    } catch (error) {
      this.logger.error(
        `Could not decrypt data source credentials: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      throw new InternalServerErrorException(
        'Data source credentials could not be decrypted',
      );
    }
  }

  mask(obj: Record<string, any>): Record<string, any> {
    const masked: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string' && value.length > 4) {
        masked[key] = '****' + value.slice(-4);
      } else {
        masked[key] = '****';
      }
    }
    return masked;
  }
}
