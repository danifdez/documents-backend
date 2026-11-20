import type { DataSourceEntity } from '../../../src/data-source/data-source.entity';
import { DataSourceService } from '../../../src/data-source/data-source.service';
import { createMockRepository } from '../../test-utils';

describe('DataSourceService management and secret handling', () => {
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

  it('validates provider configuration before creating or updating a feed', async () => {
    const dto = { name: 'Feed', providerType: 'rest_api', config: {} };
    factory.getProvider.mockReturnValueOnce(undefined);
    await expect(service.create(dto)).rejects.toThrow(
      'Unknown provider type: rest_api',
    );
    const validateConfig = jest
      .fn()
      .mockReturnValue(['URL is required', 'Data path is required']);
    factory.getProvider.mockReturnValue({ validateConfig });
    await expect(service.create(dto)).rejects.toThrow(
      'Invalid config: URL is required, Data path is required',
    );
    repo.findOne.mockResolvedValue(entity());
    await expect(service.update(1, { config: { url: '' } })).rejects.toThrow(
      'Invalid config',
    );
    expect(validateConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({ url: '' }),
    );
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('applies defaults on create and encrypts and masks supplied credentials', async () => {
    repo.create.mockImplementation((value) => value);
    repo.save.mockImplementation(async (value) => value);
    const dto = {
      name: 'Feed',
      providerType: 'rest_api',
      config: { url: 'https://example.org/feed' },
    };
    await expect(service.create(dto)).resolves.toMatchObject({
      ...dto,
      description: null,
      credentials: null,
      schemaMapping: null,
      syncSchedule: null,
      syncStrategy: 'full',
      incrementalKey: null,
      enabled: true,
      rateLimitRpm: null,
      hasCredentials: false,
    });
    const details = {
      description: 'Daily feed',
      credentials: { apiKey: 'fixture' },
      schemaMapping: [
        {
          sourceField: 'day',
          targetFieldKey: 'date',
          targetFieldName: 'Date',
          targetFieldType: 'date' as const,
        },
      ],
      syncSchedule: '0 8 * * *',
      syncStrategy: 'incremental' as const,
      incrementalKey: 'date',
      enabled: false,
      rateLimitRpm: 6,
    };
    await expect(
      service.create({ ...dto, ...details, projectId: 7 }),
    ).resolves.toMatchObject({
      ...details,
      credentials: { apiKey: '****cret' },
      project: { id: 7 },
      hasCredentials: true,
    });
    expect(encryption.encrypt).toHaveBeenCalledWith(details.credentials);
    expect(repo.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ credentials: 'encrypted' }),
    );
  });

  it('supports clearing nullable settings and replacing credentials through update', async () => {
    const ds = entity();
    repo.findOne.mockResolvedValue(ds);
    repo.save.mockImplementation(async (value) => value);
    const modified = {
      name: 'Updated feed',
      description: '',
      schemaMapping: null,
      syncSchedule: '',
      syncStrategy: 'incremental' as const,
      incrementalKey: '',
      enabled: false,
      rateLimitRpm: 0,
      projectId: 7,
      credentials: { apiKey: 'fixture' },
    };
    await expect(service.update(1, modified)).resolves.toMatchObject({
      name: 'Updated feed',
      description: null,
      syncSchedule: null,
      schemaMapping: null,
      syncStrategy: 'incremental',
      incrementalKey: null,
      enabled: false,
      rateLimitRpm: null,
      project: { id: 7 },
      hasCredentials: true,
    });
    expect(encryption.encrypt).toHaveBeenCalledWith(modified.credentials);
    await expect(
      service.update(1, { credentials: null, projectId: null }),
    ).resolves.toMatchObject({
      project: null,
      credentials: null,
      hasCredentials: false,
    });
    expect(
      service.getDecryptedCredentials(ds as unknown as DataSourceEntity),
    ).toBeNull();
  });

  it('masks nested and serialized settings and handles an unavailable encryption key', async () => {
    const ds = {
      ...entity(),
      config: {
        json: '[{"apiKey":"fixture","name":"show"}]',
        nested: [{ accessToken: 'fixture', visible: 1 }],
        invalidJson: '{not-json',
        nullField: null,
      },
    };
    const qb = repo.createQueryBuilder();
    qb.getMany.mockResolvedValue([ds]);
    encryption.decrypt.mockImplementationOnce(() => {
      throw new Error('key unavailable');
    });
    await expect(service.findAll(5)).resolves.toMatchObject([
      {
        config: {
          json: '[{"apiKey":"****","name":"show"}]',
          nested: [{ accessToken: '****', visible: 1 }],
          invalidJson: '{not-json',
          nullField: null,
        },
        credentials: { status: 'encrypted' },
        hasCredentials: true,
      },
    ]);
    expect(qb.where).toHaveBeenCalledWith('ds.project.id = :projectId', {
      projectId: 5,
    });
    qb.where.mockClear();
    await service.findAll();
    expect(qb.where).not.toHaveBeenCalled();
    expect(
      service.getDecryptedCredentials(ds as unknown as DataSourceEntity),
    ).toEqual({ apiKey: 'super-secret' });
  });

  it('preserves masked values across nested and serialized arrays', async () => {
    const ds = {
      ...entity(),
      config: {
        parts: [{ name: 'first', apiKey: 'fixture' }],
        json: '[{"apiKey":"fixture","id":1}]',
        invalid: '{original',
      },
    };
    factory.getProvider.mockReturnValue(undefined);
    repo.findOne.mockResolvedValue(ds);
    repo.save.mockImplementation(async (value) => value);
    await service.update(1, {
      config: {
        parts: [{ apiKey: '****', after: true }, { type: 'new' }],
        json: '[{"apiKey":"****","id":2}]',
        invalid: '{replacement',
      },
    });
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        config: {
          parts: [
            { name: 'first', apiKey: 'fixture', after: true },
            { type: 'new' },
          ],
          json: '[{"apiKey":"fixture","id":2}]',
          invalid: '{replacement',
        },
      }),
    );
  });

  it('loads recent sync logs within the data source and deletes only existing sources', async () => {
    const ds = entity();
    syncLogRepo.find.mockResolvedValue([{ id: 10 }]);
    await expect(service.getSyncLogs(1)).resolves.toEqual([{ id: 10 }]);
    expect(syncLogRepo.find).toHaveBeenCalledWith({
      where: { dataSource: { id: 1 } },
      order: { startedAt: 'DESC' },
      take: 20,
    });
    repo.find.mockResolvedValue([ds]);
    await expect(service.findAllWithSchedule()).resolves.toEqual([ds]);
    expect(repo.find).toHaveBeenCalledWith({
      where: { enabled: true },
      relations: ['dataset'],
    });
    await expect(service.remove(999)).rejects.toThrow(
      'Data source 999 not found',
    );
    expect(repo.remove).not.toHaveBeenCalled();
    repo.findOne.mockResolvedValue(ds);
    await service.remove(1);
    expect(repo.remove).toHaveBeenCalledWith(ds);
  });
});
