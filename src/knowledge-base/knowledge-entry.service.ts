import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KnowledgeEntryEntity } from './knowledge-entry.entity';
import { CreateKnowledgeEntryDto, UpdateKnowledgeEntryDto } from './dto/knowledge-entry.dto';
import { JobService } from '../job/job.service';
import { JobPriority } from '../job/job-priority.enum';

@Injectable()
export class KnowledgeEntryService {
    private readonly logger = new Logger(KnowledgeEntryService.name);

    constructor(
        @InjectRepository(KnowledgeEntryEntity)
        private readonly repository: Repository<KnowledgeEntryEntity>,
        private readonly jobService: JobService,
    ) { }

    async findAll(): Promise<KnowledgeEntryEntity[]> {
        return await this.repository.find({ order: { updatedAt: 'DESC' } });
    }

    async findOne(id: number): Promise<KnowledgeEntryEntity | null> {
        return await this.repository.findOneBy({ id });
    }

    async search(searchTerm: string): Promise<KnowledgeEntryEntity[]> {
        if (!searchTerm || searchTerm.trim() === '') return [];
        const like = `%${searchTerm}%`;
        return await this.repository
            .createQueryBuilder('k')
            .where('k.title ILIKE :q OR k.content ILIKE :q OR k.summary ILIKE :q', { q: like })
            .orderBy('k.updated_at', 'DESC')
            .limit(50)
            .getMany();
    }

    async globalSearch(searchTerm: string): Promise<any[]> {
        if (!searchTerm || searchTerm.trim() === '') return [];
        const like = `%${searchTerm}%`;
        return await this.repository
            .createQueryBuilder('k')
            .select(['k.id', 'k.title', 'k.content', 'k.summary'])
            .addSelect('similarity(unaccent(k.title), unaccent(:s))', 'score')
            .where('unaccent(k.title) ILIKE unaccent(:q) OR unaccent(k.content) ILIKE unaccent(:q) OR unaccent(k.summary) ILIKE unaccent(:q)', { q: like })
            .setParameter('s', searchTerm)
            .orderBy('score', 'DESC')
            .limit(50)
            .getRawMany();
    }

    async create(dto: CreateKnowledgeEntryDto): Promise<KnowledgeEntryEntity> {
        const entry = this.repository.create(dto);
        const saved = await this.repository.save(entry);
        await this.scheduleIngest(saved);
        return saved;
    }

    async update(id: number, dto: UpdateKnowledgeEntryDto): Promise<KnowledgeEntryEntity | null> {
        const entry = await this.repository.preload({ id, ...dto });
        if (!entry) return null;
        const saved = await this.repository.save(entry);
        if (dto.content !== undefined || dto.title !== undefined || dto.summary !== undefined) {
            await this.scheduleIngest(saved);
        }
        return saved;
    }

    async remove(id: number): Promise<{ deleted: boolean }> {
        const entry = await this.repository.findOneBy({ id });
        if (!entry) return { deleted: false };
        await this.repository.remove(entry);
        await this.scheduleDeleteVectors(id);
        return { deleted: true };
    }

    private async scheduleIngest(entry: KnowledgeEntryEntity) {
        const content = [
            entry.title ? `<h1>${entry.title}</h1>` : '',
            entry.summary ? `<p>${entry.summary}</p>` : '',
            entry.content || '',
        ].filter(Boolean).join('\n');

        if (!content.trim()) return;

        try {
            await this.jobService.create('ingest-content', JobPriority.BACKGROUND, {
                knowledgeEntryId: entry.id,
                content,
                sourceType: 'knowledge',
            });
            this.logger.log(`Scheduled ingest for knowledge entry ${entry.id}`);
        } catch (error) {
            this.logger.error(`Failed to schedule ingest for knowledge entry ${entry.id}: ${error.message}`);
        }
    }

    private async scheduleDeleteVectors(entryId: number) {
        try {
            await this.jobService.create('delete-vectors', JobPriority.BACKGROUND, {
                sourceId: `knowledge_${entryId}`,
            });
            this.logger.log(`Scheduled vector deletion for knowledge entry ${entryId}`);
        } catch (error) {
            this.logger.error(`Failed to schedule vector deletion for knowledge entry ${entryId}: ${error.message}`);
        }
    }
}
