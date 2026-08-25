import { MigrationInterface, QueryRunner } from 'typeorm';

// Entity graph + GraphRAG live in PostgreSQL via Apache AGE.
export class CreateAgeExtension1757668140330 implements MigrationInterface {
  name = 'CreateAgeExtension1757668140330';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS age`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP EXTENSION IF EXISTS age CASCADE`);
  }
}
