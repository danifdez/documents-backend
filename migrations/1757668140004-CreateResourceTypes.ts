import { MigrationInterface, QueryRunner } from 'typeorm';
import * as fs from 'node:fs';
import * as path from 'node:path';

export class CreateResourceTypes1757668140004 implements MigrationInterface {
  name = 'CreateResourceTypes1757668140004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "resource_types" ("id" SERIAL NOT NULL, "abbreviation" character varying NOT NULL, "name" character varying NOT NULL, "description" character varying, "example" character varying, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_d3bca389a6c56e445c7487b245e" PRIMARY KEY ("id"))`,
    );

    await this.seedResourceTypes(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "resource_types"`);
  }

  private async seedResourceTypes(queryRunner: QueryRunner): Promise<void> {
    // Resolve the seed CSV independently of the current working directory:
    // migrations now run on backend boot (compiled, from any CWD), not only
    // via the TypeORM CLI. __dirname is backend/migrations under ts-node and
    // backend/dist/migrations once compiled.
    const candidates = [
      path.join(__dirname, '..', 'data', 'resource-type.csv'), // ts-node: backend/data
      path.join(__dirname, '..', '..', 'data', 'resource-type.csv'), // compiled: backend/data
      path.join(process.cwd(), 'data', 'resource-type.csv'), // CWD = backend
      path.join(process.cwd(), 'backend', 'data', 'resource-type.csv'), // CWD = repo root
    ];
    const resolvedPath = candidates.find((p) => fs.existsSync(p));
    if (!resolvedPath) {
      throw new Error(
        `resource-type.csv not found (looked in: ${candidates.join(', ')})`,
      );
    }

    const content = fs.readFileSync(resolvedPath, 'utf8');
    const lines = content.split(/\r?\n/).filter(Boolean);
    const rows = lines.slice(1).map((l) => {
      const parts: string[] = [];
      let cur = '';
      let inQuotes = false;
      for (const ch of l) {
        if (ch === '"') {
          inQuotes = !inQuotes;
          continue;
        }
        if (ch === ',' && !inQuotes) {
          parts.push(cur);
          cur = '';
          continue;
        }
        cur += ch;
      }
      parts.push(cur);
      return parts.map((p) => (p === '' ? null : p));
    });

    await queryRunner.startTransaction();
    try {
      if (rows.length) {
        const resourceTypes = rows.map(
          ([id, abbreviation, name, description, example]) => ({
            id: Number.parseInt(id, 10),
            abbreviation,
            name,
            description,
            example,
          }),
        );
        await queryRunner.query(
          `INSERT INTO "resource_types" ("id", "abbreviation", "name", "description", "example")
           SELECT id, abbreviation, name, description, example
           FROM jsonb_to_recordset($1::jsonb) AS seed(
             id integer, abbreviation text, name text, description text, example text
           )`,
          [JSON.stringify(resourceTypes)],
        );
      }

      const maxIdResult = await queryRunner.query(
        `SELECT MAX(id) as max FROM "resource_types"`,
      );
      const maxId = maxIdResult?.[0]?.max
        ? Number.parseInt(maxIdResult[0].max, 10)
        : 0;
      if (maxId > 0) {
        await queryRunner.query(
          `ALTER SEQUENCE "resource_types_id_seq" RESTART WITH ${maxId + 1}`,
        );
      }

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    }
  }
}
