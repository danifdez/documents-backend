import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull } from 'typeorm';
import { AssistantEntity } from '../assistant/assistant.entity';
import { IndexedFileService } from './indexed-file.service';

@Injectable()
export class IndexedFileBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(IndexedFileBootstrapService.name);

  constructor(
    @InjectRepository(AssistantEntity)
    private readonly assistantRepository: Repository<AssistantEntity>,
    private readonly indexedFileService: IndexedFileService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const assistants = await this.assistantRepository.find({
      where: { folderScope: Not(IsNull()) },
    });
    for (const a of assistants) {
      void this.indexedFileService
        .scanFolder(a.id)
        .catch((e) =>
          this.logger.error(
            `Failed to reconcile assistant ${a.id}: ${e?.message ?? e}`,
          ),
        );
    }
  }
}
