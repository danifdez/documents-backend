import { MigrationInterface, QueryRunner } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

export class CreateResourceTypes1757668140004 implements MigrationInterface {
    name = 'CreateResourceTypes1757668140004'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "resource_types" ("id" SERIAL NOT NULL, "abbreviation" character varying NOT NULL, "name" character varying NOT NULL, "description" character varying, "example" character varying, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_d3bca389a6c56e445c7487b245e" PRIMARY KEY ("id"))`);

        await this.seedResourceTypes(queryRunner);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "resource_types"`);
    }

    private async seedResourceTypes(queryRunner: QueryRunner): Promise<void> {
        const csvPath = path.join(__dirname, '..', 'data', 'resource-type.csv');
        let resolvedPath = csvPath;
        if (!fs.existsSync(resolvedPath)) {
            resolvedPath = path.join(process.cwd(), 'backend', 'data', 'resource-type.csv');
        }

        const content = fs.readFileSync(resolvedPath, 'utf8');
        const lines = content.split(/\r?\n/).filter(Boolean);
        const rows = lines.slice(1).map((l) => {
            const parts: string[] = [];
            let cur = '';
            let inQuotes = false;
            for (let i = 0; i < l.length; i++) {
                const ch = l[i];
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
            return parts.map((p) => p === '' ? null : p);
        });

        await queryRunner.startTransaction();
        try {
            for (const r of rows) {
                const id = parseInt(r[0] as string, 10);
                const abbreviation = r[1] as string;
                const name = r[2] as string;
                const description = r[3] as string | null;
                const example = r[4] as string | null;

                await queryRunner.query(
                    `INSERT INTO "resource_types" ("id","abbreviation","name","description","example","created_at","updated_at") VALUES ($1,$2,$3,$4,$5, now(), now())`,
                    [id, abbreviation, name, description, example]
                );
            }

            const maxIdResult = await queryRunner.query(`SELECT MAX(id) as max FROM "resource_types"`);
            const maxId = maxIdResult && maxIdResult[0] && maxIdResult[0].max ? parseInt(maxIdResult[0].max, 10) : 0;
            if (maxId > 0) {
                await queryRunner.query(`ALTER SEQUENCE "resource_types_id_seq" RESTART WITH ${maxId + 1}`);
            }

            await queryRunner.commitTransaction();
        } catch (err) {
            await queryRunner.rollbackTransaction();
            throw err;
        }
    }
}
