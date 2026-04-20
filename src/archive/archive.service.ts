import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { ProjectEntity } from '../project/project.entity';
import { ThreadEntity } from '../thread/thread.entity';
import { DocEntity } from '../doc/doc.entity';
import { NoteEntity } from '../note/note.entity';
import { ResourceEntity } from '../resource/resource.entity';
import { FileStorageService } from '../file-storage/file-storage.service';
import { JobService } from '../job/job.service';
import { JobPriority } from '../job/job-priority.enum';
import {
    sourceIdForDoc,
    sourceIdForNote,
    sourceIdForResource,
} from '../vector/vector-source-id.util';

interface CascadeBuckets {
    threadIds: number[];
    docs: DocEntity[];
    notes: NoteEntity[];
    resources: ResourceEntity[];
}

@Injectable()
export class ArchiveService {
    private readonly logger = new Logger(ArchiveService.name);

    constructor(
        @InjectRepository(ProjectEntity) private readonly projectRepo: Repository<ProjectEntity>,
        @InjectRepository(ThreadEntity) private readonly threadRepo: Repository<ThreadEntity>,
        @InjectRepository(DocEntity) private readonly docRepo: Repository<DocEntity>,
        @InjectRepository(NoteEntity) private readonly noteRepo: Repository<NoteEntity>,
        @InjectRepository(ResourceEntity) private readonly resourceRepo: Repository<ResourceEntity>,
        private readonly fileStorageService: FileStorageService,
        private readonly jobService: JobService,
    ) { }

    async archiveProject(projectId: number): Promise<void> {
        const project = await this.projectRepo.findOneBy({ id: projectId });
        if (!project) throw new NotFoundException(`Project ${projectId} not found`);
        if (project.status === 'archived') return;

        const buckets = await this.collectByProject(projectId, /*onlyActive*/ true);

        await this.projectRepo.update(projectId, { status: 'archived' });
        if (buckets.threadIds.length) {
            await this.threadRepo.update({ id: In(buckets.threadIds) }, { status: 'archived' });
        }
        if (buckets.docs.length) {
            await this.docRepo.update({ id: In(buckets.docs.map((d) => d.id)) }, { status: 'archived' });
        }
        if (buckets.notes.length) {
            await this.noteRepo.update({ id: In(buckets.notes.map((n) => n.id)) }, { status: 'archived' });
        }
        if (buckets.resources.length) {
            await this.resourceRepo.update(
                { id: In(buckets.resources.map((r) => r.id)) },
                { archivedAt: new Date() },
            );
        }

        await this.moveResourceFilesToArchive(buckets.resources);
        await this.scheduleVectorDeletion(buckets);
    }

    async unarchiveProject(projectId: number): Promise<void> {
        const project = await this.projectRepo.findOneBy({ id: projectId });
        if (!project) throw new NotFoundException(`Project ${projectId} not found`);
        if (project.status !== 'archived') return;

        const buckets = await this.collectByProject(projectId, /*onlyActive*/ false);

        await this.projectRepo.update(projectId, { status: 'active' });
        if (buckets.threadIds.length) {
            await this.threadRepo.update({ id: In(buckets.threadIds) }, { status: 'active' });
        }
        if (buckets.docs.length) {
            await this.docRepo.update({ id: In(buckets.docs.map((d) => d.id)) }, { status: 'active' });
        }
        if (buckets.notes.length) {
            await this.noteRepo.update({ id: In(buckets.notes.map((n) => n.id)) }, { status: 'active' });
        }
        if (buckets.resources.length) {
            await this.resourceRepo.update(
                { id: In(buckets.resources.map((r) => r.id)) },
                { archivedAt: null },
            );
        }

        await this.moveResourceFilesFromArchive(buckets.resources);
    }

    async archiveThread(threadId: number): Promise<void> {
        const thread = await this.threadRepo.findOneBy({ id: threadId });
        if (!thread) throw new NotFoundException(`Thread ${threadId} not found`);
        if (thread.status === 'archived') return;

        const buckets = await this.collectByThread(threadId, /*onlyActive*/ true);

        await this.threadRepo.update({ id: In(buckets.threadIds) }, { status: 'archived' });
        if (buckets.docs.length) {
            await this.docRepo.update({ id: In(buckets.docs.map((d) => d.id)) }, { status: 'archived' });
        }
        if (buckets.notes.length) {
            await this.noteRepo.update({ id: In(buckets.notes.map((n) => n.id)) }, { status: 'archived' });
        }
        if (buckets.resources.length) {
            await this.resourceRepo.update(
                { id: In(buckets.resources.map((r) => r.id)) },
                { archivedAt: new Date() },
            );
        }

        await this.moveResourceFilesToArchive(buckets.resources);
        await this.scheduleVectorDeletion(buckets);
    }

    async unarchiveThread(threadId: number): Promise<void> {
        const thread = await this.threadRepo.findOneBy({ id: threadId });
        if (!thread) throw new NotFoundException(`Thread ${threadId} not found`);
        if (thread.status !== 'archived') return;

        const buckets = await this.collectByThread(threadId, /*onlyActive*/ false);

        await this.threadRepo.update({ id: In(buckets.threadIds) }, { status: 'active' });
        if (buckets.docs.length) {
            await this.docRepo.update({ id: In(buckets.docs.map((d) => d.id)) }, { status: 'active' });
        }
        if (buckets.notes.length) {
            await this.noteRepo.update({ id: In(buckets.notes.map((n) => n.id)) }, { status: 'active' });
        }
        if (buckets.resources.length) {
            await this.resourceRepo.update(
                { id: In(buckets.resources.map((r) => r.id)) },
                { archivedAt: null },
            );
        }

        await this.moveResourceFilesFromArchive(buckets.resources);
    }

    private async collectByProject(projectId: number, onlyActive: boolean): Promise<CascadeBuckets> {
        const threadIds = await this.collectThreadIdsForProject(projectId);

        const docs = await this.findDocs(projectId, threadIds, onlyActive);
        const notes = await this.findNotes(projectId, threadIds, onlyActive);
        const resources = await this.findResources(projectId, threadIds, onlyActive);

        return { threadIds, docs, notes, resources };
    }

    private async collectByThread(threadId: number, onlyActive: boolean): Promise<CascadeBuckets> {
        const threadIds = await this.collectDescendantThreadIds(threadId);

        const docs = await this.findDocs(null, threadIds, onlyActive);
        const notes = await this.findNotes(null, threadIds, onlyActive);
        const resources = await this.findResources(null, threadIds, onlyActive);

        return { threadIds, docs, notes, resources };
    }

    private async collectThreadIdsForProject(projectId: number): Promise<number[]> {
        const rows = await this.threadRepo
            .createQueryBuilder('t')
            .select('t.id', 'id')
            .where('t."projectId" = :projectId', { projectId })
            .getRawMany<{ id: number }>();
        return rows.map((r) => r.id);
    }

    private async collectDescendantThreadIds(rootId: number): Promise<number[]> {
        const result: number[] = [rootId];
        let frontier: number[] = [rootId];
        while (frontier.length) {
            const rows = await this.threadRepo
                .createQueryBuilder('t')
                .select('t.id', 'id')
                .where('t."parentId" IN (:...parents)', { parents: frontier })
                .getRawMany<{ id: number }>();
            const next = rows.map((r) => r.id);
            result.push(...next);
            frontier = next;
        }
        return result;
    }

    private async findDocs(projectId: number | null, threadIds: number[], onlyActive: boolean): Promise<DocEntity[]> {
        const qb = this.docRepo.createQueryBuilder('d');
        const conditions: string[] = [];
        const params: Record<string, any> = {};
        if (projectId !== null) {
            conditions.push('d."projectId" = :projectId');
            params.projectId = projectId;
        }
        if (threadIds.length) {
            conditions.push('d."threadId" IN (:...threadIds)');
            params.threadIds = threadIds;
        }
        if (!conditions.length) return [];
        qb.where(`(${conditions.join(' OR ')})`, params);
        if (onlyActive) qb.andWhere(`d.status = 'active'`);
        else qb.andWhere(`d.status = 'archived'`);
        return qb.getMany();
    }

    private async findNotes(projectId: number | null, threadIds: number[], onlyActive: boolean): Promise<NoteEntity[]> {
        const qb = this.noteRepo.createQueryBuilder('n');
        const conditions: string[] = [];
        const params: Record<string, any> = {};
        if (projectId !== null) {
            conditions.push('n."projectId" = :projectId');
            params.projectId = projectId;
        }
        if (threadIds.length) {
            conditions.push('n."threadId" IN (:...threadIds)');
            params.threadIds = threadIds;
        }
        if (!conditions.length) return [];
        qb.where(`(${conditions.join(' OR ')})`, params);
        if (onlyActive) qb.andWhere(`n.status = 'active'`);
        else qb.andWhere(`n.status = 'archived'`);
        return qb.getMany();
    }

    private async findResources(projectId: number | null, threadIds: number[], onlyActive: boolean): Promise<ResourceEntity[]> {
        const qb = this.resourceRepo.createQueryBuilder('r');
        const conditions: string[] = [];
        const params: Record<string, any> = {};
        if (projectId !== null) {
            conditions.push('r."projectId" = :projectId');
            params.projectId = projectId;
        }
        if (threadIds.length) {
            conditions.push('r."threadId" IN (:...threadIds)');
            params.threadIds = threadIds;
        }
        if (!conditions.length) return [];
        qb.where(`(${conditions.join(' OR ')})`, params);
        if (onlyActive) qb.andWhere('r.archived_at IS NULL');
        else qb.andWhere('r.archived_at IS NOT NULL');
        return qb.getMany();
    }

    private async moveResourceFilesToArchive(resources: ResourceEntity[]): Promise<void> {
        for (const r of resources) {
            if (!r.path || !r.hash) continue;
            const otherActive = await this.resourceRepo.count({
                where: { hash: r.hash, archivedAt: IsNull(), id: Not(r.id) },
            });
            if (otherActive > 0) continue;
            try {
                await this.fileStorageService.moveToArchive(r.path);
            } catch (err) {
                this.logger.error(`Failed to move file to archive for resource ${r.id} (${r.path}): ${err.message}`);
            }
        }
    }

    private async moveResourceFilesFromArchive(resources: ResourceEntity[]): Promise<void> {
        for (const r of resources) {
            if (!r.path) continue;
            const archived = await this.fileStorageService.archivedFileExists(r.path);
            if (!archived) continue;
            try {
                await this.fileStorageService.moveFromArchive(r.path);
            } catch (err) {
                this.logger.error(`Failed to restore file from archive for resource ${r.id} (${r.path}): ${err.message}`);
            }
        }
    }

    private async scheduleVectorDeletion(buckets: CascadeBuckets): Promise<void> {
        const sourceIds = [
            ...buckets.resources.map((r) => sourceIdForResource(r.id)),
            ...buckets.docs.map((d) => sourceIdForDoc(d.id)),
            ...buckets.notes.map((n) => sourceIdForNote(n.id)),
        ];
        for (const sourceId of sourceIds) {
            try {
                await this.jobService.create('delete-vectors', JobPriority.BACKGROUND, { sourceId });
            } catch (err) {
                this.logger.error(`Failed to schedule vector deletion for ${sourceId}: ${err.message}`);
            }
        }
    }
}
