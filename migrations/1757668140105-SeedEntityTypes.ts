import { MigrationInterface, QueryRunner } from "typeorm";

export class SeedEntityTypes1757668140105 implements MigrationInterface {
    name = 'SeedEntityTypes1757668140105'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const entityTypes = [
            { name: 'PERSON', description: 'Person names and proper nouns referring to people' },
            { name: 'ORGANIZATION', description: 'Organizations, companies, institutions' },
            { name: 'LOCATION', description: 'Geographical locations, places, addresses' },
            { name: 'MISC', description: 'Miscellaneous entities that don\'t fit other categories' },
        ];

        for (const entityType of entityTypes) {
            await queryRunner.query(
                `INSERT INTO "entity_types" ("name", "description", "created_at", "updated_at") 
                 VALUES ($1, $2, now(), now())`,
                [entityType.name, entityType.description]
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DELETE FROM "entity_types" WHERE "name" IN ('PERSON', 'ORGANIZATION', 'LOCATION', 'MISC', 'DATE', 'MONEY', 'PERCENT', 'TIME')`);
    }
}