import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWorkerIdentityScope1757668140750 implements MigrationInterface {
  name = 'AddWorkerIdentityScope1757668140750';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workers" ADD "worker_kind" varchar(20) NOT NULL DEFAULT 'models'`,
    );
    await queryRunner.query(
      `ALTER TABLE "workers" ADD "owner_principal" varchar(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "workers" ADD "revoked_at" timestamptz`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_workers_browser_owner" ` +
        `ON "workers" ("owner_principal") ` +
        `WHERE "worker_kind" = 'browser' AND "revoked_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_workers_browser_owner"`);
    await queryRunner.query(`ALTER TABLE "workers" DROP COLUMN "revoked_at"`);
    await queryRunner.query(
      `ALTER TABLE "workers" DROP COLUMN "owner_principal"`,
    );
    await queryRunner.query(`ALTER TABLE "workers" DROP COLUMN "worker_kind"`);
  }
}
