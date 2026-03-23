import { Repository, ObjectLiteral, SelectQueryBuilder } from 'typeorm';

export type MockRepository<T extends ObjectLiteral = any> = Partial<
  Record<keyof Repository<T>, jest.Mock>
>;

export function createMockRepository<T extends ObjectLiteral = any>(): MockRepository<T> {
  const qb = createMockQueryBuilder<T>();
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    remove: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
    preload: jest.fn(),
    query: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue(qb),
    manager: { getRepository: jest.fn() } as any,
  };
}

export function createMockQueryBuilder<T extends ObjectLiteral = any>(): Partial<
  Record<keyof SelectQueryBuilder<T>, jest.Mock>
> {
  const qb: any = {};
  const chainMethods = [
    'select', 'addSelect', 'where', 'andWhere', 'orWhere',
    'leftJoin', 'leftJoinAndSelect', 'innerJoin', 'innerJoinAndSelect',
    'orderBy', 'addOrderBy', 'limit', 'offset', 'skip', 'take',
    'groupBy', 'having', 'setParameter', 'insert', 'into', 'values',
    'update', 'set', 'delete', 'from',
  ];
  for (const method of chainMethods) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  qb.getOne = jest.fn();
  qb.getMany = jest.fn().mockResolvedValue([]);
  qb.getRawOne = jest.fn();
  qb.getRawMany = jest.fn().mockResolvedValue([]);
  qb.getCount = jest.fn().mockResolvedValue(0);
  qb.execute = jest.fn().mockResolvedValue({ affected: 0 });
  return qb;
}

export function createMockService<T>(methods: string[]): Record<string, jest.Mock> {
  const mock: Record<string, jest.Mock> = {};
  for (const method of methods) {
    mock[method] = jest.fn();
  }
  return mock;
}

export const mockConfigService = {
  get: jest.fn((key: string, defaultValue?: any) => {
    const defaults: Record<string, string> = {
      JWT_SECRET: 'test-secret',
      AUTH_ENABLED: 'false',
      OFFLINE_ENABLED: 'false',
      CORS_ORIGIN: 'http://localhost:5173',
      BODY_LIMIT: '50mb',
      POSTGRES_HOST: 'localhost',
      POSTGRES_PORT: '5432',
      POSTGRES_USER: 'postgres',
      POSTGRES_PASSWORD: 'example',
      POSTGRES_DB: 'documents_test',
      DOCUMENTS_STORAGE_DIR: '/tmp/test-storage',
      OFFLINE_FILE_SIZE_LIMIT: '10485760',
    };
    return defaults[key] ?? defaultValue;
  }),
};
