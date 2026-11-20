import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DataSource } from 'typeorm';

describe('PostgreSQL migrations', () => {
  const database = `documents_migrations_${randomUUID().replaceAll('-', '')}`;
  let admin: DataSource;
  let candidate: DataSource;
  let created = false;

  beforeAll(async () => {
    const {
      POSTGRES_DB,
      POSTGRES_HOST,
      POSTGRES_PORT,
      POSTGRES_USER,
      POSTGRES_PASSWORD,
    } = process.env;
    if (!POSTGRES_DB || !POSTGRES_HOST || !POSTGRES_USER) {
      throw new Error('Set the PostgreSQL environment for the migration tests');
    }
    const connection = {
      type: 'postgres' as const,
      host: POSTGRES_HOST,
      port: Number(POSTGRES_PORT || 5432),
      username: POSTGRES_USER,
      password: POSTGRES_PASSWORD,
      installExtensions: false,
    };
    admin = await new DataSource({
      ...connection,
      database: POSTGRES_DB,
    }).initialize();
    await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
    created = true;
    candidate = await new DataSource({
      ...connection,
      database,
      migrations: [join(__dirname, '../migrations/*.ts')],
    }).initialize();
  });

  afterAll(async () => {
    try {
      if (candidate?.isInitialized) await candidate.destroy();
      if (created) await admin.query(`DROP DATABASE "${database}"`);
    } finally {
      if (admin?.isInitialized) await admin.destroy();
    }
  });

  it('builds the current schema from scratch and does not reapply recorded migrations', async () => {
    const applied = await candidate.runMigrations();
    expect(applied.length).toBeGreaterThan(0);
    expect(await candidate.showMigrations()).toBe(false);
    expect(await candidate.runMigrations()).toEqual([]);

    const [schema] = await candidate.query(`
      SELECT to_regclass('public.executions')::text AS executions,
             to_regclass('public.execution_requests')::text AS requests,
             to_regclass('public.datasets')::text AS datasets,
             to_regclass('public.rag_chunks')::text AS rag,
             to_regclass('documents."Entity"')::text AS graph
    `);
    expect(schema).toEqual({
      executions: 'executions',
      requests: 'execution_requests',
      datasets: 'datasets',
      rag: 'rag_chunks',
      graph: 'documents."Entity"',
    });

    const extensions = await candidate.query(
      "SELECT extname FROM pg_extension WHERE extname IN ('vector', 'age') ORDER BY extname",
    );
    expect(extensions).toEqual([{ extname: 'age' }, { extname: 'vector' }]);

    const latest = applied.at(-1);
    await candidate.undoLastMigration();
    expect(
      await candidate.query('SELECT name FROM migrations WHERE name = $1', [
        latest.name,
      ]),
    ).toEqual([]);
    expect(await candidate.showMigrations()).toBe(true);
    expect((await candidate.runMigrations()).map(({ name }) => name)).toEqual([
      latest.name,
    ]);
  }, 30000);
});
