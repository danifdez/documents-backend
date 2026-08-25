import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropObsoleteExecutionCheckpoint1757668140450 implements MigrationInterface {
  name = 'DropObsoleteExecutionCheckpoint1757668140450';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "executions" DROP COLUMN IF EXISTS "checkpoint"`,
    );
  }

  // Reverting must not restore an unused execution-state channel.
  public async down(): Promise<void> {}
}
