import { InternalServerErrorException } from '@nestjs/common';
import { DataSourceEncryptionService } from '../../../src/data-source/data-source-encryption.service';

function service(key?: string) {
  return new DataSourceEncryptionService({
    get: () => key,
  } as any);
}

describe('DataSourceEncryptionService', () => {
  it('round-trips credentials when a key is configured', () => {
    const encryption = service('test-key');
    const encrypted = encryption.encrypt({ apiKey: 'secret-value' });

    expect(encrypted).not.toContain('secret-value');
    expect(encryption.decrypt(encrypted)).toEqual({ apiKey: 'secret-value' });
  });

  it('fails closed when encrypting without a key', () => {
    expect(() => service().encrypt({ apiKey: 'secret' })).toThrow(
      InternalServerErrorException,
    );
  });

  it('fails closed when decrypting without a key', () => {
    expect(() => service().decrypt('not-encrypted')).toThrow(
      InternalServerErrorException,
    );
  });

  it('masks credential values', () => {
    expect(service('test-key').mask({ apiKey: 'abcdefgh' })).toEqual({
      apiKey: '****efgh',
    });
  });
});
