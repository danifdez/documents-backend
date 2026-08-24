import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateExecutionOutbox1757668140400 implements MigrationInterface {
  name = 'CreateExecutionOutbox1757668140400';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "execution_outbox" (
        "outbox_id" uuid NOT NULL,
        "execution_id" uuid NOT NULL,
        "event_id" uuid NOT NULL,
        "schema_version" varchar(50) NOT NULL,
        "socket_event" varchar(80) NOT NULL,
        "payload" jsonb NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'pending',
        "attempts" integer NOT NULL DEFAULT 0,
        "available_at" timestamptz NOT NULL DEFAULT now(),
        "lease_expires_at" timestamptz,
        "published_at" timestamptz,
        "last_error" varchar(1000),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_execution_outbox" PRIMARY KEY ("outbox_id"),
        CONSTRAINT "UQ_execution_outbox_event" UNIQUE ("event_id"),
        CONSTRAINT "CHK_execution_outbox_status"
          CHECK ("status" IN ('pending', 'publishing', 'published')),
        CONSTRAINT "FK_execution_outbox_execution"
          FOREIGN KEY ("execution_id") REFERENCES "executions"("execution_id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_execution_outbox_event"
          FOREIGN KEY ("event_id") REFERENCES "execution_events"("event_id")
          ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_execution_outbox_pending" ON "execution_outbox" ("status", "available_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "execution_outbox"`);
  }
}
