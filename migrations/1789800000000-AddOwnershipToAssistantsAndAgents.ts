import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOwnershipToAssistantsAndAgents1789800000000 implements MigrationInterface {
  name = 'AddOwnershipToAssistantsAndAgents1789800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Assistants were a single-row table. Multi-user servers need one
    // assistant per principal, so replace the singleton constraint with a
    // sequence and an owner column.
    await queryRunner.query(
      `ALTER TABLE "assistants" DROP CONSTRAINT IF EXISTS "CHK_assistants_singleton"`,
    );
    await queryRunner.query(
      `CREATE SEQUENCE IF NOT EXISTS "assistants_id_seq"`,
    );
    await queryRunner.query(
      `ALTER TABLE "assistants" ALTER COLUMN "id" SET DEFAULT nextval('assistants_id_seq')`,
    );
    await queryRunner.query(
      `ALTER SEQUENCE "assistants_id_seq" OWNED BY "assistants"."id"`,
    );
    await queryRunner.query(
      `SELECT setval('assistants_id_seq', COALESCE((SELECT MAX("id") FROM "assistants"), 0) + 1, false)`,
    );

    await queryRunner.query(
      `ALTER TABLE "assistants" ADD COLUMN "owner_principal" character varying(200)`,
    );
    await queryRunner.query(
      `UPDATE "assistants" SET "owner_principal" = 'standalone' WHERE "owner_principal" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "assistants" ALTER COLUMN "owner_principal" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_assistants_owner" ON "assistants" ("owner_principal")`,
    );

    await queryRunner.query(
      `ALTER TABLE "agents" ADD COLUMN "owner_principal" character varying(200)`,
    );
    await queryRunner.query(
      `UPDATE "agents" SET "owner_principal" = 'standalone' WHERE "owner_principal" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "agents" ALTER COLUMN "owner_principal" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_agents_owner" ON "agents" ("owner_principal")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_agents_owner"`);
    await queryRunner.query(
      `ALTER TABLE "agents" DROP COLUMN "owner_principal"`,
    );

    await queryRunner.query(`DROP INDEX "UQ_assistants_owner"`);
    await queryRunner.query(
      `ALTER TABLE "assistants" DROP COLUMN "owner_principal"`,
    );
    await queryRunner.query(
      `ALTER TABLE "assistants" ALTER COLUMN "id" DROP DEFAULT`,
    );
    await queryRunner.query(`DROP SEQUENCE IF EXISTS "assistants_id_seq"`);
    await queryRunner.query(`DELETE FROM "assistants" WHERE "id" <> 1`);
    await queryRunner.query(
      `ALTER TABLE "assistants" ADD CONSTRAINT "CHK_assistants_singleton" CHECK ("id" = 1)`,
    );
  }
}
