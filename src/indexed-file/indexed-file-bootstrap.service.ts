import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull } from 'typeorm';
import { AgentEntity } from '../agent/agent.entity';
import { AssistantEntity } from '../assistant/assistant.entity';
import { IndexedFileService } from './indexed-file.service';

@Injectable()
export class IndexedFileBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(IndexedFileBootstrapService.name);

  constructor(
    @InjectRepository(AssistantEntity)
    private readonly assistantRepository: Repository<AssistantEntity>,
    @InjectRepository(AgentEntity)
    private readonly agentRepository: Repository<AgentEntity>,
    private readonly indexedFileService: IndexedFileService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const assistants = await this.assistantRepository.find({
      where: { folderScope: Not(IsNull()) },
    });
    for (const assistant of assistants) {
      void this.indexedFileService
        .scanFolder({ ownerType: 'assistant', ownerId: assistant.id })
        .catch((e) =>
          this.logger.error(
            `Failed to reconcile assistant ${assistant.id}: ${e?.message ?? e}`,
          ),
        );
    }
    const agents = await this.agentRepository.find({
      where: { folderScope: Not(IsNull()) },
    });
    for (const a of agents) {
      void this.indexedFileService
        .scanFolder({ ownerType: 'agent', ownerId: a.id })
        .catch((e) =>
          this.logger.error(
            `Failed to reconcile agent ${a.id}: ${e?.message ?? e}`,
          ),
        );
    }
  }
}
