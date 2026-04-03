import { Injectable, Logger } from '@nestjs/common';
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
            this.logger.warn('DATASOURCE_ENCRYPTION_KEY not set — credentials will be stored as plain JSON');
        }
    }

    encrypt(obj: Record<string, any>): string {
        if (!this.key) {
            return JSON.stringify(obj);
        }

        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
        const plaintext = JSON.stringify(obj);
        const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();

        return Buffer.concat([iv, tag, encrypted]).toString('base64');
    }

    decrypt(ciphertext: string): Record<string, any> {
        if (!this.key) {
            return JSON.parse(ciphertext);
        }

        const data = Buffer.from(ciphertext, 'base64');
        const iv = data.subarray(0, IV_LENGTH);
        const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
        const encrypted = data.subarray(IV_LENGTH + TAG_LENGTH);

        const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
        decipher.setAuthTag(tag);
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

        return JSON.parse(decrypted.toString('utf8'));
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
