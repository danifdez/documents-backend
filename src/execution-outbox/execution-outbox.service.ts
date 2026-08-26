import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { NotificationGateway } from '../notification/notification.gateway';

interface ClaimedOutboxMessage {
  outbox_id: string;
  socket_event: string;
  payload: Record<string, unknown>;
  attempts: number;
}

const PUBLISH_LEASE_MS = 30_000;

@Injectable()
export class ExecutionOutboxService {
  private readonly logger = new Logger(ExecutionOutboxService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly notificationGateway: NotificationGateway,
  ) {}

  async publishPending(limit = 20): Promise<number> {
    let published = 0;
    while (published < limit) {
      const message = await this.claimNext();
      if (!message) break;
      try {
        const delivered = await this.notificationGateway.publishExecution({
          outboxId: message.outbox_id,
          socketEvent: message.socket_event,
          payload: message.payload,
        });
        if (!delivered) throw new Error('no_connected_clients');
        await this.markPublished(message);
        published += 1;
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : 'publication_failed';
        await this.releaseForRetry(message, reason);
        this.logger.warn(
          `Execution publication ${message.outbox_id} deferred: ${reason}`,
        );
        break;
      }
    }
    return published;
  }

  private claimNext(): Promise<ClaimedOutboxMessage | null> {
    return this.dataSource.transaction(async (manager) => {
      const [rows] = (await manager.query(
        `
          WITH candidate AS (
            SELECT "outbox_id"
            FROM "execution_outbox"
            WHERE (
                "status" = 'pending'
                AND "available_at" <= now()
              ) OR (
                "status" = 'publishing'
                AND "lease_expires_at" <= now()
              )
            ORDER BY "available_at", "created_at"
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          )
          UPDATE "execution_outbox" message
          SET "status" = 'publishing',
              "attempts" = message."attempts" + 1,
              "lease_expires_at" = now() + ($1 * interval '1 millisecond'),
              "updated_at" = now()
          FROM candidate
          WHERE message."outbox_id" = candidate."outbox_id"
          RETURNING message."outbox_id", message."socket_event",
                    message."payload", message."attempts"
        `,
        [PUBLISH_LEASE_MS],
      )) as [ClaimedOutboxMessage[], number];
      return rows[0] ?? null;
    });
  }

  private async markPublished(message: ClaimedOutboxMessage): Promise<void> {
    await this.dataSource.query(
      `
        UPDATE "execution_outbox"
        SET "status" = 'published',
            "published_at" = now(),
            "lease_expires_at" = NULL,
            "last_error" = NULL,
            "updated_at" = now()
        WHERE "outbox_id" = $1
          AND "status" = 'publishing'
          AND "attempts" = $2
      `,
      [message.outbox_id, message.attempts],
    );
  }

  private async releaseForRetry(
    message: ClaimedOutboxMessage,
    reason: string,
  ): Promise<void> {
    const backoffSeconds = Math.min(60, Math.max(1, message.attempts));
    await this.dataSource.query(
      `
        UPDATE "execution_outbox"
        SET "status" = 'pending',
            "available_at" = now() + ($3 * interval '1 second'),
            "lease_expires_at" = NULL,
            "last_error" = $4,
            "updated_at" = now()
        WHERE "outbox_id" = $1
          AND "status" = 'publishing'
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
