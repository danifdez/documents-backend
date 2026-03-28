import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ResourceEntity } from '../resource/resource.entity';
import { DocEntity } from '../doc/doc.entity';
import { ThreadEntity } from '../thread/thread.entity';
import { CommentEntity } from '../comment/comment.entity';
import { MarkEntity } from '../mark/mark.entity';
import { NoteEntity } from '../note/note.entity';
import { ProjectEntity } from '../project/project.entity';
import { FileStorageService } from '../file-storage/file-storage.service';
import { SyncChangeDto } from './dto/sync-change.dto';
import { getRepositoryToken } from '@nestjs/typeorm';

@Injectable()
export class OfflineService {
  private readonly logger = new Logger(OfflineService.name);
  private readonly fileSizeLimit: number;

  constructor(
    @InjectRepository(ResourceEntity) private readonly resourceRepo: Repository<ResourceEntity>,
    @InjectRepository(DocEntity) private readonly docRepo: Repository<DocEntity>,
    @InjectRepository(ThreadEntity) private readonly threadRepo: Repository<ThreadEntity>,
    @InjectRepository(CommentEntity) private readonly commentRepo: Repository<CommentEntity>,
    @InjectRepository(MarkEntity) private readonly markRepo: Repository<MarkEntity>,
    @Optional() @Inject(getRepositoryToken(NoteEntity)) private readonly noteRepo: Repository<NoteEntity> | null,
    @InjectRepository(ProjectEntity) private readonly projectRepo: Repository<ProjectEntity>,
    private readonly fileStorage: FileStorageService,
    private readonly configService: ConfigService,
  ) {
    this.fileSizeLimit = parseInt(
      this.configService.get('OFFLINE_FILE_SIZE_LIMIT', '10485760'),
      10,
    );
  }

  async bundleResource(id: number) {
    const resource = await this.resourceRepo.findOne({
      where: { id },
      relations: ['project', 'authors'],
    });
    if (!resource) return null;

    const comments = await this.commentRepo.find({ where: { resource: { id } } });
    const marks = await this.markRepo.find({ where: { resource: { id } } });

    const excludedFiles: Array<{ resourceId: number; name: string; fileSize: number; reason: string }> = [];
    let fileBase64: string | null = null;

    if (resource.path && resource.fileSize) {
      if (resource.fileSize <= this.fileSizeLimit) {
        try {
          const buffer = await this.fileStorage.getFile(resource.path);
          fileBase64 = buffer.toString('base64');
        } catch (e) {
          this.logger.warn(`Could not read file for resource ${id}: ${e.message}`);
        }
      } else {
        excludedFiles.push({
          resourceId: resource.id,
          name: resource.originalName || resource.name,
          fileSize: resource.fileSize,
          reason: `File exceeds ${Math.round(this.fileSizeLimit / 1024 / 1024)}MB limit`,
        });
      }
    }

    return {
      project: resource.project || null,
      resources: [resource],
      docs: [],
      threads: [],
      comments,
      marks,
      notes: [],
      files: fileBase64 ? [{ resourceId: resource.id, mimeType: resource.mimeType, base64: fileBase64 }] : [],
      excludedFiles,
    };
  }

  async bundleThread(id: number) {
    const thread = await this.threadRepo.findOne({
      where: { id },
      relations: ['docs', 'project'],
    });
    if (!thread) return null;

    const docs = await this.docRepo.find({
      where: { thread: { id } },
      relations: ['resource', 'project'],
    });

    const docIds = docs.map((d) => d.id);
    const comments = docIds.length > 0
      ? await this.commentRepo.createQueryBuilder('c').where('c.docId IN (:...ids)', { ids: docIds }).getMany()
      : [];
    const marks = docIds.length > 0
      ? await this.markRepo.createQueryBuilder('m').where('m.docId IN (:...ids)', { ids: docIds }).getMany()
      : [];

    // Collect linked resources from docs
    const resourceIds = docs.filter((d) => d.resource).map((d) => d.resource.id);
    const resources = resourceIds.length > 0
      ? await this.resourceRepo.createQueryBuilder('r')
          .leftJoinAndSelect('r.project', 'project')
          .whereInIds(resourceIds)
          .getMany()
      : [];

    const { files, excludedFiles } = await this.collectFiles(resources);

    return {
      project: thread.project || null,
      resources,
      docs,
      threads: [thread],
      comments,
      marks,
      notes: [],
      files,
      excludedFiles,
    };
  }

  async bundleProject(id: number) {
    const project = await this.projectRepo.findOneBy({ id });
    if (!project) return null;

    const threads = await this.threadRepo.find({ where: { project: { id } } });
    const docs = await this.docRepo.find({ where: { project: { id } }, relations: ['resource'] });
    const resources = await this.resourceRepo.find({ where: { project: { id } }, relations: ['authors'] });
    const notes = this.noteRepo ? await this.noteRepo.find({ where: { project: { id } } }) : [];

    const docIds = docs.map((d) => d.id);
    const resourceIds = resources.map((r) => r.id);

    const comments: CommentEntity[] = [];
    const marks: MarkEntity[] = [];

    if (docIds.length > 0) {
      const docComments = await this.commentRepo.createQueryBuilder('c').where('c.docId IN (:...ids)', { ids: docIds }).getMany();
      const docMarks = await this.markRepo.createQueryBuilder('m').where('m.docId IN (:...ids)', { ids: docIds }).getMany();
      comments.push(...docComments);
      marks.push(...docMarks);
    }
    if (resourceIds.length > 0) {
      const resComments = await this.commentRepo.createQueryBuilder('c').where('c.resourceId IN (:...ids)', { ids: resourceIds }).getMany();
      const resMarks = await this.markRepo.createQueryBuilder('m').where('m.resourceId IN (:...ids)', { ids: resourceIds }).getMany();
      comments.push(...resComments);
      marks.push(...resMarks);
    }

    const { files, excludedFiles } = await this.collectFiles(resources);

    return {
      project,
      resources,
      docs,
      threads,
      comments,
      marks,
      notes,
      files,
      excludedFiles,
    };
  }

  private async collectFiles(resources: ResourceEntity[]) {
    const files: Array<{ resourceId: number; mimeType: string; base64: string }> = [];
    const excludedFiles: Array<{ resourceId: number; name: string; fileSize: number; reason: string }> = [];

    for (const r of resources) {
      if (!r.path || !r.fileSize) continue;
      if (r.fileSize > this.fileSizeLimit) {
        excludedFiles.push({
          resourceId: r.id,
          name: r.originalName || r.name,
          fileSize: r.fileSize,
          reason: `File exceeds ${Math.round(this.fileSizeLimit / 1024 / 1024)}MB limit`,
        });
        continue;
      }
      try {
        const buffer = await this.fileStorage.getFile(r.path);
        files.push({ resourceId: r.id, mimeType: r.mimeType, base64: buffer.toString('base64') });
      } catch (e) {
        this.logger.warn(`Could not read file for resource ${r.id}: ${e.message}`);
      }
    }

    return { files, excludedFiles };
  }

  async applySync(changes: SyncChangeDto[]) {
    const results: Array<{ entityType: string; entityId: number; status: string; serverData?: any }> = [];

    for (const change of changes) {
      const repo = this.getRepo(change.entityType);
      if (!repo) {
        results.push({ entityType: change.entityType, entityId: change.entityId, status: 'error' });
        continue;
      }

      if (change.method === 'DELETE') {
        try {
          await repo.delete(change.entityId);
          results.push({ entityType: change.entityType, entityId: change.entityId, status: 'applied' });
        } catch {
          results.push({ entityType: change.entityType, entityId: change.entityId, status: 'error' });
        }
        continue;
      }

      const entity = await repo.findOneBy({ id: change.entityId } as any);

      if (change.method === 'PATCH' && entity) {
        const serverUpdated = new Date((entity as any).updatedAt).getTime();
        const clientUpdated = new Date(change.updatedAt).getTime();

        if (clientUpdated >= serverUpdated) {
          Object.assign(entity, change.payload);
          const saved = await repo.save(entity);
          results.push({ entityType: change.entityType, entityId: change.entityId, status: 'applied', serverData: saved });
        } else {
          results.push({ entityType: change.entityType, entityId: change.entityId, status: 'conflict', serverData: entity });
        }
      } else if (change.method === 'POST') {
        const newEntity = repo.create(change.payload as any);
        const saved = await repo.save(newEntity);
        results.push({ entityType: change.entityType, entityId: (saved as any).id, status: 'applied', serverData: saved });
      } else {
        results.push({ entityType: change.entityType, entityId: change.entityId, status: 'error' });
      }
    }

    return { results };
  }

  async getChangesSince(since: string, projectId: number) {
    const sinceDate = new Date(since);

    const resources = await this.resourceRepo.find({
      where: { project: { id: projectId }, updatedAt: MoreThan(sinceDate) },
    });
    const docs = await this.docRepo.find({
      where: { project: { id: projectId }, updatedAt: MoreThan(sinceDate) },
    });
    const threads = await this.threadRepo.find({
      where: { project: { id: projectId }, updatedAt: MoreThan(sinceDate) },
    });
    const notes = this.noteRepo ? await this.noteRepo.find({
      where: { project: { id: projectId }, updatedAt: MoreThan(sinceDate) },
    }) : [];

    // Comments and marks don't have direct project relation, query via docs/resources
    const comments: CommentEntity[] = [];
    const marks: MarkEntity[] = [];

    const docIds = docs.map((d) => d.id);
    const resourceIds = resources.map((r) => r.id);

    if (docIds.length > 0) {
      const dc = await this.commentRepo.createQueryBuilder('c')
        .where('c.docId IN (:...ids)', { ids: docIds })
        .andWhere('c.updatedAt > :since', { since: sinceDate })
        .getMany();
      comments.push(...dc);

      const dm = await this.markRepo.createQueryBuilder('m')
        .where('m.docId IN (:...ids)', { ids: docIds })
        .andWhere('m.updatedAt > :since', { since: sinceDate })
        .getMany();
      marks.push(...dm);
    }

    if (resourceIds.length > 0) {
      const rc = await this.commentRepo.createQueryBuilder('c')
        .where('c.resourceId IN (:...ids)', { ids: resourceIds })
        .andWhere('c.updatedAt > :since', { since: sinceDate })
        .getMany();
      comments.push(...rc);

      const rm = await this.markRepo.createQueryBuilder('m')
        .where('m.resourceId IN (:...ids)', { ids: resourceIds })
        .andWhere('m.updatedAt > :since', { since: sinceDate })
        .getMany();
      marks.push(...rm);
    }

    return { resources, docs, threads, comments, marks, notes };
  }

  private getRepo(entityType: string): Repository<any> | null {
    switch (entityType) {
      case 'doc': return this.docRepo;
      case 'comment': return this.commentRepo;
      case 'mark': return this.markRepo;
      case 'note': return this.noteRepo;
      case 'resource': return this.resourceRepo;
      default: return null;
    }
  }
}
