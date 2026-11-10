import { BadRequestException, Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, MoreThan, ObjectLiteral } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ResourceEntity } from '../resource/resource.entity';
import { DocEntity } from '../doc/doc.entity';
import { ThreadEntity } from '../thread/thread.entity';
import { CommentEntity } from '../comment/comment.entity';
import { MarkEntity } from '../mark/mark.entity';
import { ReadingPointEntity } from '../reading-point/reading-point.entity';
import { NoteEntity } from '../note/note.entity';
import { ProjectEntity } from '../project/project.entity';
import { FileStorageService } from '../file-storage/file-storage.service';
import { SyncChangeDto } from './dto/sync-change.dto';
import { getRepositoryToken } from '@nestjs/typeorm';

@Injectable()
export class OfflineService {
  private readonly logger = new Logger(OfflineService.name);
  private readonly fileSizeLimit: number;
  private readonly repoByEntityType: Map<string, Repository<any> | null>;

  private static readonly CREATE_FIELDS: Record<string, string[]> = {
    doc: ['name', 'content', 'citationFormat', 'status'],
    comment: ['content', 'quote', 'prefix', 'suffix', 'position'],
    mark: ['content', 'prefix', 'suffix', 'position', 'type'],
    'reading-point': ['kind', 'label', 'fragmentId', 'exact', 'prefix', 'suffix', 'position', 'ratio'],
    note: ['title', 'content', 'status'],
    resource: [
      'name',
      'title',
      'url',
      'content',
      'status',
      'language',
      'summary',
      'keyPoints',
      'keywords',
      'type',
      'license',
      'publicationDate',
      'pages',
    ],
  };

  private static readonly UPDATE_FIELDS: Record<string, string[]> = {
    doc: ['name', 'content', 'citationFormat', 'status'],
    comment: ['content', 'quote', 'prefix', 'suffix', 'position'],
    mark: ['content', 'prefix', 'suffix', 'position', 'type'],
    'reading-point': ['kind', 'label', 'fragmentId', 'exact', 'prefix', 'suffix', 'position', 'ratio'],
    note: ['title', 'content', 'status'],
    resource: [
      'name',
      'title',
      'url',
      'content',
      'status',
      'language',
      'summary',
      'keyPoints',
      'keywords',
      'type',
      'license',
      'publicationDate',
      'pages',
    ],
  };

  private static readonly RELATION_FIELDS: Record<string, Record<string, string>> = {
    doc: { projectId: 'project', threadId: 'thread', resourceId: 'resource' },
    comment: { docId: 'doc', resourceId: 'resource' },
    mark: { docId: 'doc', resourceId: 'resource' },
    'reading-point': { docId: 'doc', resourceId: 'resource' },
    note: { projectId: 'project', threadId: 'thread' },
    resource: { projectId: 'project' },
  };

  constructor(
    @InjectRepository(ResourceEntity) private readonly resourceRepo: Repository<ResourceEntity>,
    @InjectRepository(DocEntity) private readonly docRepo: Repository<DocEntity>,
    @InjectRepository(ThreadEntity) private readonly threadRepo: Repository<ThreadEntity>,
    @InjectRepository(CommentEntity) private readonly commentRepo: Repository<CommentEntity>,
    @InjectRepository(MarkEntity) private readonly markRepo: Repository<MarkEntity>,
    @InjectRepository(ReadingPointEntity) private readonly readingPointRepo: Repository<ReadingPointEntity>,
    @Optional() @Inject(getRepositoryToken(NoteEntity)) private readonly noteRepo: Repository<NoteEntity> | null,
    @InjectRepository(ProjectEntity) private readonly projectRepo: Repository<ProjectEntity>,
    private readonly fileStorage: FileStorageService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {
    this.fileSizeLimit = parseInt(
      this.configService.get('OFFLINE_FILE_SIZE_LIMIT', '10485760'),
      10,
    );
    this.repoByEntityType = new Map<string, Repository<any> | null>([
      ['doc', this.docRepo],
      ['comment', this.commentRepo],
      ['mark', this.markRepo],
      ['reading-point', this.readingPointRepo],
      ['note', this.noteRepo],
      ['resource', this.resourceRepo],
    ]);
  }

  async bundleResource(id: number) {
    const resource = await this.resourceRepo.findOne({
      where: { id },
      relations: ['project', 'authors'],
    });
    if (!resource) return null;

    const comments = await this.commentRepo.find({ where: { resource: { id } } });
    const marks = await this.markRepo.find({ where: { resource: { id } } });
    const readingPoints = await this.readingPointRepo.find({ where: { resource: { id } } });

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
      readingPoints,
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
    const readingPoints = docIds.length > 0
      ? await this.readingPointRepo.createQueryBuilder('rp').where('rp.docId IN (:...ids)', { ids: docIds }).getMany()
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
      readingPoints,
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
    const readingPoints: ReadingPointEntity[] = [];

    if (docIds.length > 0) {
      const docComments = await this.commentRepo.createQueryBuilder('c').where('c.docId IN (:...ids)', { ids: docIds }).getMany();
      const docMarks = await this.markRepo.createQueryBuilder('m').where('m.docId IN (:...ids)', { ids: docIds }).getMany();
      const docReadingPoints = await this.readingPointRepo.createQueryBuilder('rp').where('rp.docId IN (:...ids)', { ids: docIds }).getMany();
      comments.push(...docComments);
      marks.push(...docMarks);
      readingPoints.push(...docReadingPoints);
    }
    if (resourceIds.length > 0) {
      const resComments = await this.commentRepo.createQueryBuilder('c').where('c.resourceId IN (:...ids)', { ids: resourceIds }).getMany();
      const resMarks = await this.markRepo.createQueryBuilder('m').where('m.resourceId IN (:...ids)', { ids: resourceIds }).getMany();
      const resReadingPoints = await this.readingPointRepo.createQueryBuilder('rp').where('rp.resourceId IN (:...ids)', { ids: resourceIds }).getMany();
      comments.push(...resComments);
      marks.push(...resMarks);
      readingPoints.push(...resReadingPoints);
    }

    const { files, excludedFiles } = await this.collectFiles(resources);

    return {
      project,
      resources,
      docs,
      threads,
      comments,
      marks,
      readingPoints,
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
    return this.dataSource.transaction(async (manager) => {
      const results: Array<{
        entityType: string;
        entityId: number;
        status: string;
        serverData?: any;
      }> = [];

      for (const change of changes) {
        const repo = this.getRepo(change.entityType);
        if (!repo) {
          results.push({
            entityType: change.entityType,
            entityId: change.entityId,
            status: 'error',
          });
          continue;
        }

        const txRepo = manager.withRepository(repo);

        if (change.method === 'DELETE') {
          try {
            await txRepo.delete(change.entityId);
            results.push({
              entityType: change.entityType,
              entityId: change.entityId,
              status: 'applied',
            });
          } catch {
            results.push({
              entityType: change.entityType,
              entityId: change.entityId,
              status: 'error',
            });
          }
          continue;
        }

        if (change.method === 'PATCH') {
          const entity = await txRepo.findOneBy({ id: change.entityId } as any);
          if (!entity) {
            results.push({
              entityType: change.entityType,
              entityId: change.entityId,
              status: 'error',
            });
            continue;
          }

          const serverUpdated = new Date((entity as any).updatedAt).getTime();
          const clientUpdated = new Date(change.updatedAt).getTime();

          if (clientUpdated >= serverUpdated) {
            Object.assign(
              entity,
              this.pickFields(
                change.entityType,
                change.payload,
                OfflineService.UPDATE_FIELDS,
              ),
            );
            const saved = await txRepo.save(entity);
            results.push({
              entityType: change.entityType,
              entityId: change.entityId,
              status: 'applied',
              serverData: saved,
            });
          } else {
            results.push({
              entityType: change.entityType,
              entityId: change.entityId,
              status: 'conflict',
              serverData: entity,
            });
          }
          continue;
        }

        if (change.method === 'POST') {
          const data = this.buildCreateData(change.entityType, change.payload);
          const newEntity = txRepo.create(data);
          const saved = await txRepo.save(newEntity);
          results.push({
            entityType: change.entityType,
            entityId: (saved as any).id,
            status: 'applied',
            serverData: saved,
          });
          continue;
        }

        results.push({
          entityType: change.entityType,
          entityId: change.entityId,
          status: 'error',
        });
      }

      return { results };
    });
  }

  private pickFields(
    entityType: string,
    payload: Record<string, any>,
    fieldMap: Record<string, string[]>,
  ): Record<string, any> {
    const allowed = fieldMap[entityType] ?? [];
    const picked: Record<string, any> = {};
    for (const field of allowed) {
      if (payload[field] !== undefined) {
        picked[field] = payload[field];
      }
    }
    return picked;
  }

  private buildCreateData(
    entityType: string,
    payload: Record<string, any>,
  ): Record<string, any> {
    const data = this.pickFields(
      entityType,
      payload,
      OfflineService.CREATE_FIELDS,
    );
    const relations = OfflineService.RELATION_FIELDS[entityType] ?? {};
    for (const [sourceField, relation] of Object.entries(relations)) {
      const value = payload[sourceField];
      if (value !== undefined && value !== null) {
        data[relation] = { id: value };
      }
    }
    return data;
  }

  async getChangesSince(since: string, projectId: number) {
    const sinceDate = new Date(since);
    if (Number.isNaN(sinceDate.getTime())) {
      throw new BadRequestException('Invalid since date');
    }
    if (!Number.isInteger(projectId) || projectId <= 0) {
      throw new BadRequestException('Invalid projectId');
    }

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

    // Comments, marks and reading points don't have direct project relation,
    // query via docs/resources
    const comments: CommentEntity[] = [];
    const marks: MarkEntity[] = [];
    const readingPoints: ReadingPointEntity[] = [];

    const docIds = docs.map((d) => d.id);
    const resourceIds = resources.map((r) => r.id);

    if (docIds.length > 0) {
      comments.push(...(await this.findChangedSince(this.commentRepo, 'c', 'docId', docIds, sinceDate)));
      marks.push(...(await this.findChangedSince(this.markRepo, 'm', 'docId', docIds, sinceDate)));
      readingPoints.push(...(await this.findChangedSince(this.readingPointRepo, 'rp', 'docId', docIds, sinceDate)));
    }

    if (resourceIds.length > 0) {
      comments.push(...(await this.findChangedSince(this.commentRepo, 'c', 'resourceId', resourceIds, sinceDate)));
      marks.push(...(await this.findChangedSince(this.markRepo, 'm', 'resourceId', resourceIds, sinceDate)));
      readingPoints.push(...(await this.findChangedSince(this.readingPointRepo, 'rp', 'resourceId', resourceIds, sinceDate)));
    }

    return { resources, docs, threads, comments, marks, readingPoints, notes };
  }

  private findChangedSince<T extends ObjectLiteral>(
    repo: Repository<T>,
    alias: string,
    fkColumn: 'docId' | 'resourceId',
    ids: number[],
    since: Date,
  ): Promise<T[]> {
    return repo.createQueryBuilder(alias)
      .where(`${alias}.${fkColumn} IN (:...ids)`, { ids })
      .andWhere(`${alias}.updatedAt > :since`, { since })
      .getMany();
  }

  private getRepo(entityType: string): Repository<any> | null {
    return this.repoByEntityType.get(entityType) ?? null;
  }
}
