import { DataSourceService } from '../../../src/data-source/data-source.service';
import { createMockRepository } from '../../test-utils';

describe('DataSourceService secret handling', () => {
  let repo: ReturnType<typeof createMockRepository>;
  let syncLogRepo: ReturnType<typeof createMockRepository>;
  let encryption: {
    encrypt: jest.Mock;
    decrypt: jest.Mock;
    mask: jest.Mock;
  };
  let factory: { getProvider: jest.Mock };
  let service: DataSourceService;

  const entity = () => ({
    id: 1,
    name: 'Feed',
    providerType: 'rest_api',
    config: {
      url: 'https://example.com/data',
      apiKey: 'super-secret',
      headers: '{"Authorization":"Bearer super-secret"}',
    },
    credentials: 'encrypted',
    schemaMapping: null,
    syncSchedule: null,
    syncStrategy: 'full',
    incrementalKey: null,
    enabled: true,
    rateLimitRpm: null,
    project: null,
    dataset: null,
  });

  beforeEach(() => {
    repo = createMockRepository();
    syncLogRepo = createMockRepository();
    encryption = {
      encrypt: jest.fn(() => 'encrypted'),
      decrypt: jest.fn(() => ({ apiKey: 'super-secret' })),
      mask: jest.fn(() => ({ apiKey: '****cret' })),
    };
    factory = {
      getProvider: jest.fn(() => ({ validateConfig: () => [] })),
    };
    service = new DataSourceService(
      repo as any,
      syncLogRepo as any,
      encryption as any,
      factory as any,
    );
  });

  it('masks secret-looking config values in public responses', async () => {
    repo.findOne.mockResolvedValue(entity());

    const result = await service.findOnePublic(1);

    expect(result.config.apiKey).toBe('****');
    expect(JSON.parse(result.config.headers)).toEqual({
      Authorization: '****',
    });
    expect(result.credentials).toEqual({ apiKey: '****cret' });
  });

  it('keeps masked secrets when updating unrelated config fields', async () => {
    repo.findOne.mockResolvedValue(entity());
    repo.save.mockImplementation(async (value: any) => value);

    await service.update(1, {
      config: {
        url: 'https://example.com/v2',
        headers: '{"Authorization":"****"}',
        apiKey: '****',
      },
    });

    const saved = (repo.save as jest.Mock).mock.calls[0][0];
    expect(saved.config.url).toBe('https://example.com/v2');
    expect(saved.config.apiKey).toBe('super-secret');
    expect(JSON.parse(saved.config.headers)).toEqual({
      Authorization: 'Bearer super-secret',
    });
  });
});
