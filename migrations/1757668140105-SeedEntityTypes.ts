import { MigrationInterface, QueryRunner } from "typeorm";

export class SeedEntityTypes1757668140105 implements MigrationInterface {
    name = 'SeedEntityTypes1757668140105'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const entityTypes = [
            // Geographic and political entities
            { name: 'GEOPOLITICAL', description: 'Countries, cities, states' },
            { name: 'LOCATION', description: 'Non-GPE locations, mountain ranges, bodies of water' },
            { name: 'NATIONALITY', description: 'Nationalities or religious or political groups' },

            // Human and organizational entities
            { name: 'PERSON', description: 'People, including fictional' },
            { name: 'ORGANIZATION', description: 'Companies, agencies, institutions, etc.' },

            // Cultural and creative entities
            { name: 'EVENT', description: 'Named hurricanes, battles, wars, sports events, etc.' },
            { name: 'FACILITY', description: 'Buildings, airports, highways, bridges, etc.' },
            { name: 'PRODUCT', description: 'Objects, vehicles, foods, etc. (not services)' },
            { name: 'WORK_OF_ART', description: 'Titles of books, songs, etc.' },
            { name: 'LANGUAGE', description: 'Any named language' },
            { name: 'LAW', description: 'Named documents made into laws' },
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
        await queryRunner.query(`DELETE FROM "entity_types" WHERE "name" IN (
            'GEOPOLITICAL', 'LOCATION', 'NATIONALITY', 
            'PERSON', 'ORGANIZATION', 
            'EVENT', 'FACILITY', 'PRODUCT', 'WORK_OF_ART', 'LANGUAGE', 'LAW'
        )`);
    }
}