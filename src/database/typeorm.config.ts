import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DATABASE_ENTITIES } from './database-entities';

export const getTypeOrmConfig = async (
  configService: ConfigService,
): Promise<TypeOrmModuleOptions> => {
  return {
    type: 'postgres',
    host: String(configService.get('POSTGRES_HOST') ?? '127.0.0.1'),
    port: Number(configService.get('POSTGRES_PORT') ?? 5432),
    username: String(configService.get('POSTGRES_USER') ?? 'postgres'),
    password: String(configService.get('POSTGRES_PASSWORD') ?? ''),
    database: String(configService.get('POSTGRES_DB') ?? 'documents'),
    entities: [...DATABASE_ENTITIES],
    synchronize: false,
    // Apply pending migrations on every boot so that updates ship their schema
    // automatically (a new release with a new migration runs it on first start).
    // Idempotent: TypeORM only runs migrations not yet recorded in the
    // `migrations` table. Set RUN_MIGRATIONS=false to opt out (e.g. when driving
    // `migration:run` manually).
    migrations: [__dirname + '/../../migrations/*.js'],
    migrationsRun: configService.get('RUN_MIGRATIONS') !== 'false',
    logging: false,
    // Apache AGE stores each graph in a schema named after the graph, and the
    // default `"$user", public` search_path lets that schema shadow `public`
    // when the database role is also named `documents` (the standalone install
    // does exactly that). Pinning the connection to `public` keeps TypeORM's
    // unqualified migration bookkeeping and DDL out of the graph schema. AGE
    // queries opt back in with their own `SET search_path`.
    extra: {
      options: '-c search_path=public',
    },
  };
};
