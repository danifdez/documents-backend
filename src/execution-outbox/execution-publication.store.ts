import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ExecutionOutboxStatus } from './execution-outbox.entity';

interface ClaimedOutboxMessage {
  outbox_id: string;
  socket_event: string;
  payload: Record<string, unknown>;
  attempts: number;
  owner_principal: string;
}

const PUBLISH_LEASE_MS = 30_000;
const MAX_PUBLISH_ATTEMPTS = 20;

@Injectable()
export class ExecutionPublicationStore {
  constructor(private readonly dataSource: DataSource) {}

  claimNext(): Promise<ClaimedOutboxMessage | null> {
    return this.dataSource.transaction(async (manager) => {
      const [rows] = (await manager.query(
        `
          WITH exhausted_leases AS (
            UPDATE "execution_outbox"
            SET "status" = '${ExecutionOutboxStatus.FAILED}',
                "lease_expires_at" = NULL,
                "last_error" = 'publication_lease_attempts_exhausted',
                "updated_at" = now()
            WHERE "status" = '${ExecutionOutboxStatus.PUBLISHING}'
              AND "lease_expires_at" <= now()
              AND "attempts" >= $2
          ), candidate AS (
            SELECT "outbox_id"
            FROM "execution_outbox"
            WHERE (
                "status" = '${ExecutionOutboxStatus.PENDING}'
                AND "available_at" <= now()
              ) OR (
                "status" = '${ExecutionOutboxStatus.PUBLISHING}'
                AND "lease_expires_at" <= now()
                AND "attempts" < $2
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
                    message."payload", message."attempts", message."owner_principal"
        `,
        [PUBLISH_LEASE_MS, MAX_PUBLISH_ATTEMPTS],
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
    // An offline owner may reconnect at any time, so keep their message pending.
    const exhausted =
      reason !== 'no_connected_clients' &&
      message.attempts >= MAX_PUBLISH_ATTEMPTS;
    const status = exhausted
      ? ExecutionOutboxStatus.FAILED
      : ExecutionOutboxStatus.PENDING;
    const backoffSeconds = Math.min(60, Math.max(1, message.attempts));
    await this.dataSource.query(
      `
        UPDATE "execution_outbox"
        SET "status" = '${status}',
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
