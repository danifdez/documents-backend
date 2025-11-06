import { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePendingEntities1760000010000 implements MigrationInterface {
    name = 'CreatePendingEntities1760000010000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "pending_entities" (
            "id" SERIAL NOT NULL, 
            "resource_id" integer NOT NULL,
            "name" character varying NOT NULL, 
            "description" text,
            "translations" jsonb,
            "aliases" jsonb,
            "entity_type_id" integer,
            "language" character varying,
            "status" character varying NOT NULL DEFAULT 'pending',
            "merged_target_type" character varying,
            "merged_target_id" integer,
            "merged_at" TIMESTAMP,
            "scope" VARCHAR NOT NULL DEFAULT 'document',
            "created_at" TIMESTAMP NOT NULL DEFAULT now(), 
            "updated_at" TIMESTAMP NOT NULL DEFAULT now(), 
            CONSTRAINT "PK_pending_entities_id" PRIMARY KEY ("id")
        )`);

        // Add comment for description column
        await queryRunner.query(`COMMENT ON COLUMN "pending_entities"."description" IS 'Optional description of the pending entity'`);

        // The FK to resources is applied in a separate migration to ensure resources table exists first.

        // Create foreign key constraint to entity_types (nullable)
        await queryRunner.query(`ALTER TABLE "pending_entities" ADD CONSTRAINT "FK_pending_entities_entity_type_id" FOREIGN KEY ("entity_type_id") REFERENCES "entity_types"("id") ON DELETE SET NULL ON UPDATE CASCADE`);

        // Create foreign key constraint to resources
        await queryRunner.query(`ALTER TABLE "pending_entities" ADD CONSTRAINT "FK_pending_entities_resource_id" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE`);

        // Create indexes for better performance
        await queryRunner.query(`CREATE INDEX "IDX_pending_entities_resource_id" ON "pending_entities" ("resource_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_pending_entities_name" ON "pending_entities" ("name")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_pending_entities_name"`);
        await queryRunner.query(`DROP INDEX "IDX_pending_entities_resource_id"`);
        await queryRunner.query(`ALTER TABLE "pending_entities" DROP CONSTRAINT "FK_pending_entities_entity_type_id"`);
        // FK is managed in a separate migration; nothing to drop here for it.
        // Drop consolidated columns created in this migration
        await queryRunner.query(`ALTER TABLE "pending_entities" DROP COLUMN "merged_at"`);
        await queryRunner.query(`ALTER TABLE "pending_entities" DROP COLUMN "merged_target_id"`);
        await queryRunner.query(`ALTER TABLE "pending_entities" DROP COLUMN "merged_target_type"`);
        await queryRunner.query(`ALTER TABLE "pending_entities" DROP COLUMN "status"`);
        // Drop FK to resources (managed here now)
        await queryRunner.query(`ALTER TABLE "pending_entities" DROP CONSTRAINT "FK_pending_entities_resource_id"`);
        await queryRunner.query(`ALTER TABLE "pending_entities" DROP COLUMN "description"`);
        await queryRunner.query(`ALTER TABLE "pending_entities" DROP COLUMN "language"`);
        await queryRunner.query(`ALTER TABLE "pending_entities" DROP COLUMN "translations"`);
        await queryRunner.query(`DROP TABLE "pending_entities"`);
    }
}
