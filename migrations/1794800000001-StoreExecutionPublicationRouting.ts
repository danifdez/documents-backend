import { MigrationInterface, QueryRunner } from 'typeorm';

export class StoreExecutionPublicationRouting1794800000001 implements MigrationInterface {
  name = 'StoreExecutionPublicationRouting1794800000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "execution_outbox" ADD COLUMN "owner_principal" varchar(200);
      UPDATE "execution_outbox" AS publication
      SET "owner_principal" = execution."owner_principal"
      FROM "executions" AS execution
      WHERE publication."execution_id" = execution."execution_id";
      ALTER TABLE "execution_outbox"
        ALTER COLUMN "owner_principal" SET NOT NULL,
        DROP CONSTRAINT "CHK_execution_outbox_status",
        ADD CONSTRAINT "CHK_execution_outbox_status"
          CHECK ("status" IN ('pending', 'publishing', 'published', 'failed'));
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "execution_outbox"
      SET "status" = 'pending', "available_at" = now()
      WHERE "status" = 'failed';
      ALTER TABLE "execution_outbox"
        DROP COLUMN "owner_principal",
        DROP CONSTRAINT "CHK_execution_outbox_status",
        ADD CONSTRAINT "CHK_execution_outbox_status"
          CHECK ("status" IN ('pending', 'publishing', 'published'));
    `);
  }
}
