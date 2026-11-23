import { claimAvailable } from '../utils/claim-available';
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
    for await (const message of claimAvailable(
      () => this.publications.claimNext(),
      limit,
    )) {
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
        if (delivered) {
          await this.publications.markPublished(message);
          published += 1;
          continue;
        }
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : 'publication_failed';
        await this.publications.releaseForRetry(message, reason);
        this.logger.warn(
          `Execution publication ${message.outbox_id} deferred: ${reason}`,
        );
        continue;
      }
      await this.publications.releaseForRetry(message, 'no_connected_clients');
    }
    return published;
  }
}
