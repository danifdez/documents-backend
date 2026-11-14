import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExecutionTraceContext1794650000000 implements MigrationInterface {
  name = 'AddExecutionTraceContext1794650000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "executions" ADD COLUMN "trace_context" jsonb',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "executions" DROP COLUMN "trace_context"',
    );
  }
}
