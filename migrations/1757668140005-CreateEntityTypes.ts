import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEntityTypes1757668140005 implements MigrationInterface {
    name = 'CreateEntityTypes1757668140005'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "entity_types" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "description" character varying, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_entity_types_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_entity_types_name" ON "entity_types" ("name")`);

        const entityTypes = [
            { name: 'GEOPOLITICAL', description: 'Countries, cities, states' },
            { name: 'LOCATION', description: 'Non-GPE locations, mountain ranges, bodies of water' },
            { name: 'NATIONALITY', description: 'Nationalities or religious or political groups' },
            { name: 'PERSON', description: 'People, including fictional' },
            { name: 'ORGANIZATION', description: 'Companies, agencies, institutions, etc.' },
            { name: 'EVENT', description: 'Named hurricanes, battles, wars, sports events, etc.' },
            { name: 'FACILITY', description: 'Buildings, airports, highways, bridges, etc.' },
            { name: 'PRODUCT', description: 'Objects, vehicles, foods, etc. (not services)' },
            { name: 'WORK_OF_ART', description: 'Titles of books, songs, etc.' },
            { name: 'LANGUAGE', description: 'Any named language' },
            { name: 'LAW', description: 'Named documents made into laws' },
        ];

        for (const entityType of entityTypes) {
            await queryRunner.query(
                `INSERT INTO "entity_types" ("name", "description", "created_at", "updated_at") VALUES ($1, $2, now(), now())`,
                [entityType.name, entityType.description]
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_entity_types_name"`);
        await queryRunner.query(`DROP TABLE "entity_types"`);
    }
}
