import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateKnowledgeEntries1757668140017 implements MigrationInterface {
    name = 'CreateKnowledgeEntries1757668140017'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "knowledge_entries" ("id" SERIAL NOT NULL, "title" character varying NOT NULL, "content" text, "summary" text, "tags" jsonb, "is_definition" boolean NOT NULL DEFAULT false, "entity_id" integer, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_knowledge_entries" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "knowledge_entries" ADD CONSTRAINT "FK_knowledge_entries_entity" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "knowledge_entries" DROP CONSTRAINT "FK_knowledge_entries_entity"`);
        await queryRunner.query(`DROP TABLE "knowledge_entries"`);
    }
}
