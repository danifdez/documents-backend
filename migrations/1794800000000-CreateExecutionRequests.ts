import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateExecutionRequests1794800000000 implements MigrationInterface {
  name = 'CreateExecutionRequests1794800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "execution_requests" (
      "owner_principal" varchar(200) NOT NULL,
      "request_id" uuid NOT NULL,
      "input_hash" varchar(71),
      "execution_id" uuid UNIQUE,
      "cancel_requested" boolean NOT NULL DEFAULT false,
      PRIMARY KEY ("owner_principal", "request_id")
    )`);
    // Keep acceptance identities after evidence retention removes an execution.
    // A missing bound execution must never turn a replay into new work.
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "execution_requests"');
  }
}
