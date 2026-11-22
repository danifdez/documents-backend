import { Injectable, Logger } from '@nestjs/common';
import { NotificationGateway } from '../notification/notification.gateway';
import { ExecutionPublicationStore } from './execution-publication.store';

@Injectable()
export class ExecutionOutboxService {
  private readonly logger = new Logger(ExecutionOutboxService.name);

  constructor(
    private readonly publications: ExecutionPublicationStore,
    private readonly notificationGateway: NotificationGateway,
  ) {}

  async publishPending(limit = 20): Promise<number> {
    let published = 0;
    for (let processed = 0; processed < limit; processed += 1) {
      const message = await this.publications.claimNext();
      if (!message) break;
      try {
        if (!message.owner_principal) {
          throw new Error('missing_owner_principal');
        }
        const delivered = await this.notificationGateway.publishExecution(
          message.owner_principal,
          {
            outboxId: message.outbox_id,
            socketEvent: message.socket_event,
            payload: message.payload,
          },
        );
        if (!delivered) throw new Error('no_connected_clients');
        await this.publications.markPublished(message);
        published += 1;
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : 'publication_failed';
        await this.publications.releaseForRetry(message, reason);
        this.logger.warn(
          `Execution publication ${message.outbox_id} deferred: ${reason}`,
        );
      }
    }
    return published;
  }
}
