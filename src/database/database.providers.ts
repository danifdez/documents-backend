import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

export const databaseProviders = [
  {
    provide: 'PG_POOL',
    inject: [ConfigService],
    useFactory: async (configService: ConfigService): Promise<Pool> => {
      // Coerce all env values to strings to avoid pg errors when values are non-string
      const host = String(configService.get('POSTGRES_HOST') ?? 'database');
      const port = Number(configService.get('POSTGRES_PORT') ?? 5432);
      const user = String(configService.get('POSTGRES_USER') ?? 'postgres');
      const password = String(configService.get('POSTGRES_PASSWORD') ?? '');
      const database = String(configService.get('POSTGRES_DB') ?? 'documents');

      const pool = new Pool({ host, port, user, password, database });

      await pool.query('SELECT 1');
      return pool;
    },
  },
];
