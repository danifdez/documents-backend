import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePendingEntities1757668140030 implements MigrationInterface {
    name = 'CreatePendingEntities1757668140030'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "pending_entities" (
            "id" SERIAL NOT NULL,
            "resource_id" integer NOT NULL,
            "name" character varying NOT NULL,
            "description" text,
            "language" character varying,
            "translations" jsonb,
            "aliases" jsonb,
            "scope" character varying NOT NULL DEFAULT 'document',
            "status" character varying NOT NULL DEFAULT 'pending',
            "merged_target_type" character varying,
            "merged_target_id" integer,
            "merged_at" timestamp,
            "entity_type_id" integer,
            "created_at" TIMESTAMP NOT NULL DEFAULT now(),
            "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
            CONSTRAINT "PK_pending_entities" PRIMARY KEY ("id")
        )`);
        await queryRunner.query(`ALTER TABLE "pending_entities" ADD CONSTRAINT "FK_pending_entities_resource" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "pending_entities" ADD CONSTRAINT "FK_pending_entities_entity_type" FOREIGN KEY ("entity_type_id") REFERENCES "entity_types"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "pending_entities" DROP CONSTRAINT "FK_pending_entities_entity_type"`);
        await queryRunner.query(`ALTER TABLE "pending_entities" DROP CONSTRAINT "FK_pending_entities_resource"`);
        await queryRunner.query(`DROP TABLE "pending_entities"`);
    }
}
