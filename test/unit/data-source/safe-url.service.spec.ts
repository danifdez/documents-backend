import { BadRequestException } from '@nestjs/common';
import { SafeUrlService } from '../../../src/data-source/safe-url.service';

function service(overrides: Record<string, string> = {}) {
  return new SafeUrlService({
    get: (key: string) => overrides[key],
  } as any);
}

describe('SafeUrlService', () => {
  it.each([
    'file:///etc/passwd',
    'ftp://example.com/data.csv',
    'http://localhost:3000/admin',
    'http://metadata.google.internal/computeMetadata/v1',
    'http://127.0.0.1:5432',
    'http://10.1.2.3/data',
    'http://172.16.0.1/data',
    'http://192.168.1.1/data',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/data',
    'http://[fd00::1]/data',
  ])('rejects %s', async (url) => {
    await expect(service().assertSafe(url)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('accepts a public http URL', async () => {
    await expect(
      service().assertSafe('https://8.8.8.8/data.json'),
    ).resolves.toBeInstanceOf(URL);
  });

  it('can be explicitly relaxed for local development', async () => {
    await expect(
      service({ DATA_SOURCE_ALLOW_PRIVATE_HOSTS: 'true' }).assertSafe(
        'http://127.0.0.1:9000/data',
      ),
    ).resolves.toBeInstanceOf(URL);
  });
});
