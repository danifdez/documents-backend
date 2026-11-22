import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ExecutionOutboxStatus } from './execution-outbox.entity';

interface ClaimedOutboxMessage {
  outbox_id: string;
  socket_event: string;
  payload: Record<string, unknown>;
  attempts: number;
  owner_principal: string | null;
}

const PUBLISH_LEASE_MS = 30_000;

@Injectable()
export class ExecutionPublicationStore {
  constructor(private readonly dataSource: DataSource) {}

  claimNext(): Promise<ClaimedOutboxMessage | null> {
    return this.dataSource.transaction(async (manager) => {
      const [rows] = (await manager.query(
        `
          WITH candidate AS (
            SELECT "outbox_id"
            FROM "execution_outbox"
            WHERE (
                "status" = '${ExecutionOutboxStatus.PENDING}'
                AND "available_at" <= now()
              ) OR (
                "status" = '${ExecutionOutboxStatus.PUBLISHING}'
                AND "lease_expires_at" <= now()
              )
            ORDER BY "available_at", "created_at"
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          )
          UPDATE "execution_outbox" message
          SET "status" = '${ExecutionOutboxStatus.PUBLISHING}',
              "attempts" = message."attempts" + 1,
              "lease_expires_at" = now() + ($1 * interval '1 millisecond'),
              "updated_at" = now()
          FROM candidate
          WHERE message."outbox_id" = candidate."outbox_id"
          RETURNING message."outbox_id", message."socket_event",
                    message."payload", message."attempts",
                    (SELECT "owner_principal" FROM "executions"
                     WHERE "execution_id" = message."execution_id") AS "owner_principal"
        `,
        [PUBLISH_LEASE_MS],
      )) as [ClaimedOutboxMessage[], number];
      return rows[0] ?? null;
    });
  }

  async markPublished(message: ClaimedOutboxMessage): Promise<void> {
    await this.dataSource.query(
      `
        UPDATE "execution_outbox"
        SET "status" = '${ExecutionOutboxStatus.PUBLISHED}',
            "published_at" = now(),
            "lease_expires_at" = NULL,
            "last_error" = NULL,
            "updated_at" = now()
        WHERE "outbox_id" = $1
          AND "status" = '${ExecutionOutboxStatus.PUBLISHING}'
          AND "attempts" = $2
      `,
      [message.outbox_id, message.attempts],
    );
  }

  async releaseForRetry(
    message: ClaimedOutboxMessage,
    reason: string,
  ): Promise<void> {
    const backoffSeconds = Math.min(60, Math.max(1, message.attempts));
    await this.dataSource.query(
      `
        UPDATE "execution_outbox"
        SET "status" = '${ExecutionOutboxStatus.PENDING}',
            "available_at" = now() + ($3 * interval '1 second'),
            "lease_expires_at" = NULL,
            "last_error" = $4,
            "updated_at" = now()
        WHERE "outbox_id" = $1
          AND "status" = '${ExecutionOutboxStatus.PUBLISHING}'
          AND "attempts" = $2
      `,
      [
        message.outbox_id,
        message.attempts,
        backoffSeconds,
        reason.slice(0, 1000),
      ],
    );
  }
}
