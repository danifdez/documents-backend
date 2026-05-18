import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull } from 'typeorm';
import { AgentEntity } from './agent.entity';
import { AgentService } from './agent.service';

@Injectable()
export class AgentExpirationService {
  private readonly logger = new Logger(AgentExpirationService.name);

  constructor(
    @InjectRepository(AgentEntity)
    private readonly agentRepo: Repository<AgentEntity>,
    private readonly agentService: AgentService,
  ) {}

  // 04:00 server time, fuera de horas de uso típico.
  @Cron('0 4 * * *')
  async runDailyCleanup(): Promise<void> {
    const now = new Date();
    const candidates = await this.agentRepo.find({
      where: { expiresAt: Not(IsNull()) },
      select: ['id', 'name', 'expiresAt'],
    });
    const expired = candidates.filter(
      (a) => a.expiresAt !== null && a.expiresAt < now,
    );

    if (expired.length === 0) {
      this.logger.log('agent-expiration: nothing to clean up');
      return;
    }

    const removed: Array<{ id: number; name: string }> = [];
    for (const a of expired) {
      try {
        await this.agentService.remove(a.id);
        removed.push({ id: a.id, name: a.name });
      } catch (e: any) {
        this.logger.error(
          `agent-expiration: failed to remove agent ${a.id} (${a.name}): ${e?.message ?? e}`,
        );
      }
    }
    this.logger.log(
      `agent-expiration: removed ${removed.length} expired agents: ${JSON.stringify(removed)}`,
    );
  }
}
