import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWorkerCredentials1757668140380 implements MigrationInterface {
  name = 'AddWorkerCredentials1757668140380';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workers" ADD "credential_hash" varchar(71)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workers" DROP COLUMN "credential_hash"`,
    );
  }
}
