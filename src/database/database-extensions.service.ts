import { forEachSequential } from '../utils/for-each-sequential';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

const REQUIRED_EXTENSIONS = ['pg_trgm', 'unaccent', 'vector', 'age'] as const;

@Injectable()
export class DatabaseExtensionsService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseExtensionsService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    await forEachSequential(REQUIRED_EXTENSIONS, async (extension) => {
      await this.dataSource.query(
        `CREATE EXTENSION IF NOT EXISTS ${extension}`,
      );
    });
    this.logger.log(
      `PostgreSQL extensions ready (${REQUIRED_EXTENSIONS.join(', ')})`,
    );
  }
}
