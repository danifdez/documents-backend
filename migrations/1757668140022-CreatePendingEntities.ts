import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePendingEntities1757668140022 implements MigrationInterface {
    name = 'CreatePendingEntities1757668140022'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "pending_entities" ("id" SERIAL NOT NULL, "resource_id" integer NOT NULL, "name" character varying NOT NULL, "description" text, "translations" jsonb, "aliases" jsonb, "entity_type_id" integer, "language" character varying, "status" character varying NOT NULL DEFAULT 'pending', "merged_target_type" character varying, "merged_target_id" integer, "merged_at" TIMESTAMP, "scope" VARCHAR NOT NULL DEFAULT 'document', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_pending_entities_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`COMMENT ON COLUMN "pending_entities"."description" IS 'Optional description of the pending entity'`);
        await queryRunner.query(`ALTER TABLE "pending_entities" ADD CONSTRAINT "FK_pending_entities_entity_type_id" FOREIGN KEY ("entity_type_id") REFERENCES "entity_types"("id") ON DELETE SET NULL ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "pending_entities" ADD CONSTRAINT "FK_pending_entities_resource_id" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`CREATE INDEX "IDX_pending_entities_resource_id" ON "pending_entities" ("resource_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_pending_entities_name" ON "pending_entities" ("name")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_pending_entities_name"`);
        await queryRunner.query(`DROP INDEX "IDX_pending_entities_resource_id"`);
        await queryRunner.query(`ALTER TABLE "pending_entities" DROP CONSTRAINT "FK_pending_entities_resource_id"`);
        await queryRunner.query(`ALTER TABLE "pending_entities" DROP CONSTRAINT "FK_pending_entities_entity_type_id"`);
        await queryRunner.query(`DROP TABLE "pending_entities"`);
    }
}
