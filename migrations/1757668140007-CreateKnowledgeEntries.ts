import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateKnowledgeEntries1757668140007 implements MigrationInterface {
    name = 'CreateKnowledgeEntries1757668140007'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "knowledge_entries" ("id" SERIAL NOT NULL, "title" character varying NOT NULL, "content" text, "summary" text, "tags" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_knowledge_entries" PRIMARY KEY ("id"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "knowledge_entries"`);
    }
}
