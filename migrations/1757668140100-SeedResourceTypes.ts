import { MigrationInterface, QueryRunner } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

export class SeedResourceTypes1757668140100 implements MigrationInterface {
    name = 'SeedResourceTypes1757668140100'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const csvPath = path.join(__dirname, '..', 'data', 'resource-type.csv');
        // __dirname in compiled migrations points to dist/migrations; adjust if necessary
        let resolvedPath = csvPath;
        if (!fs.existsSync(resolvedPath)) {
            // Try relative to project root (backend/)
            resolvedPath = path.join(process.cwd(), 'backend', 'data', 'resource-type.csv');
        }

        const content = fs.readFileSync(resolvedPath, 'utf8');
        const lines = content.split(/\r?\n/).filter(Boolean);
        // Expect header then rows
        const rows = lines.slice(1).map((l) => {
            // Simple CSV split that handles quoted fields with commas
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
                // r = [id, abbreviation, name, description, example]
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

            // Ensure sequence for id is set after manual inserts
            const maxIdResult = await queryRunner.query(`SELECT MAX(id) as max FROM "resource_types"`);
            const maxId = maxIdResult && maxIdResult[0] && maxIdResult[0].max ? parseInt(maxIdResult[0].max, 10) : 0;
            if (maxId > 0) {
                // Set the sequence to max(id)
                await queryRunner.query(`ALTER SEQUENCE "resource_types_id_seq" RESTART WITH ${maxId + 1}`);
            }

            await queryRunner.commitTransaction();
        } catch (err) {
            await queryRunner.rollbackTransaction();
            throw err;
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.startTransaction();
        try {
            // Delete seeded ids (1..1000 range safe assumption)
            await queryRunner.query(`DELETE FROM "resource_types" WHERE id >= 1 AND id <= 1000`);
            // Reset sequence to 1
            await queryRunner.query(`ALTER SEQUENCE "resource_types_id_seq" RESTART WITH 1`);
            await queryRunner.commitTransaction();
        } catch (err) {
            await queryRunner.rollbackTransaction();
            throw err;
        }
    }

}
