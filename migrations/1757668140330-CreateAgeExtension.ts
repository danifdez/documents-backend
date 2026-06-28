import { MigrationInterface, QueryRunner } from 'typeorm';

// Entity graph + GraphRAG live in PostgreSQL via Apache AGE (replacing Neo4j).
// This migration only ensures the extension exists; the worker
// (models/database/graph_db.py) creates the graph itself on first use.
export class CreateAgeExtension1757668140330 implements MigrationInterface {
    name = 'CreateAgeExtension1757668140330'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS age`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP EXTENSION IF EXISTS age CASCADE`);
    }
}
