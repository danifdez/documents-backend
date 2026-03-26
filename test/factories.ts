import { ResourceEntity } from '../src/resource/resource.entity';
import { ProjectEntity } from '../src/project/project.entity';
import { EntityEntity } from '../src/entity/entity.entity';
import { AuthorEntity } from '../src/author/author.entity';
import { UserEntity } from '../src/auth/user.entity';
import { JobEntity } from '../src/job/job.entity';
import { JobStatus } from '../src/job/job-status.enum';
import { DocEntity } from '../src/doc/doc.entity';
import { CommentEntity } from '../src/comment/comment.entity';
import { NoteEntity } from '../src/note/note.entity';
import { MarkEntity } from '../src/mark/mark.entity';
import { CanvasEntity } from '../src/canvas/canvas.entity';
import { DatasetEntity } from '../src/dataset/dataset.entity';
import { DatasetRecordEntity } from '../src/dataset/dataset-record.entity';
import { BibliographyEntryEntity } from '../src/bibliography/bibliography-entry.entity';
import { CalendarEventEntity } from '../src/calendar-event/calendar-event.entity';
import { TimelineEntity } from '../src/timeline/timeline.entity';
import { UserTaskEntity } from '../src/user-task/user-task.entity';
import { KnowledgeEntryEntity } from '../src/knowledge-base/knowledge-entry.entity';
import { WorkerEntity } from '../src/worker/worker.entity';
import { ThreadEntity } from '../src/thread/thread.entity';
import { PendingEntityEntity } from '../src/pending-entity/pending-entity.entity';
import { EntityTypeEntity } from '../src/entity-type/entity-type.entity';
import { ResourceTypeEntity } from '../src/resource-type/resource-type.entity';

const now = new Date('2025-01-01T00:00:00Z');

export function buildProject(overrides: Partial<ProjectEntity> = {}): ProjectEntity {
  return {
    id: 1,
    name: 'Test Project',
    description: null,
    docs: [],
    resources: [],
    threads: [],
    datasets: [],
    notes: [],
    calendarEvents: [],
    timelines: [],
    userTasks: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as ProjectEntity;
}

export function buildResource(overrides: Partial<ResourceEntity> = {}): ResourceEntity {
  return {
    id: 1,
    name: 'Test Resource',
    hash: 'abc123',
    relatedTo: null,
    type: null,
    mimeType: 'application/pdf',
    originalName: 'test.pdf',
    uploadDate: now,
    fileSize: 1024,
    pages: null,
    path: 'abc123/test.pdf',
    url: null,
    title: null,
    publicationDate: null,
    content: null,
    translatedContent: null,
    workingContent: null,
    summary: null,
    keyPoints: null,
    keywords: null,
    language: null,
    license: null,
    status: 'extracting',
    project: null,
    authors: [],
    entities: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as ResourceEntity;
}

export function buildEntityType(overrides: Partial<EntityTypeEntity> = {}): EntityTypeEntity {
  return {
    id: 1,
    name: 'Person',
    description: null,
    entities: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as EntityTypeEntity;
}

export function buildEntity(overrides: Partial<EntityEntity> = {}): EntityEntity {
  return {
    id: 1,
    name: 'Test Entity',
    description: null,
    global: false,
    translations: null,
    aliases: null,
    entityType: buildEntityType(),
    resources: [],
    projects: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as EntityEntity;
}

export function buildAuthor(overrides: Partial<AuthorEntity> = {}): AuthorEntity {
  return {
    id: 1,
    name: 'Test Author',
    resources: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as AuthorEntity;
}

export function buildUser(overrides: Partial<UserEntity> = {}): UserEntity {
  return {
    id: 1,
    username: 'testuser',
    passwordHash: '$2b$10$hashedpassword',
    displayName: 'Test User',
    role: 'user',
    permissions: {},
    active: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as UserEntity;
}

export function buildJob(overrides: Partial<JobEntity> = {}): JobEntity {
  return {
    id: 1,
    type: 'document-extraction',
    priority: 'normal',
    payload: {},
    status: JobStatus.PENDING,
    result: null,
    claimedBy: null,
    retryCount: 0,
    startedAt: null,
    expiresAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as JobEntity;
}

export function buildThread(overrides: Partial<ThreadEntity> = {}): ThreadEntity {
  return {
    id: 1,
    name: 'Test Thread',
    description: null,
    project: null,
    parent: null,
    docs: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as ThreadEntity;
}

export function buildDoc(overrides: Partial<DocEntity> = {}): DocEntity {
  return {
    id: 1,
    name: 'Test Doc',
    content: null,
    citationFormat: 'apa',
    thread: null,
    project: null,
    resource: null,
    comments: [],
    marks: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as DocEntity;
}

export function buildComment(overrides: Partial<CommentEntity> = {}): CommentEntity {
  return {
    id: 1,
    content: 'Test comment',
    doc: null,
    resource: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as CommentEntity;
}

export function buildNote(overrides: Partial<NoteEntity> = {}): NoteEntity {
  return {
    id: 1,
    title: 'Test Note',
    content: null,
    project: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as NoteEntity;
}

export function buildMark(overrides: Partial<MarkEntity> = {}): MarkEntity {
  return {
    id: 1,
    content: 'Test mark',
    doc: null,
    resource: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as MarkEntity;
}

export function buildCanvas(overrides: Partial<CanvasEntity> = {}): CanvasEntity {
  return {
    id: 1,
    name: 'Test Canvas',
    canvasData: null,
    content: null,
    thread: null,
    project: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as CanvasEntity;
}

export function buildDataset(overrides: Partial<DatasetEntity> = {}): DatasetEntity {
  return {
    id: 1,
    name: 'Test Dataset',
    description: null,
    project: null,
    schema: [],
    records: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as DatasetEntity;
}

export function buildDatasetRecord(overrides: Partial<DatasetRecordEntity> = {}): DatasetRecordEntity {
  return {
    id: 1,
    dataset: buildDataset(),
    data: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as DatasetRecordEntity;
}

export function buildBibliographyEntry(overrides: Partial<BibliographyEntryEntity> = {}): BibliographyEntryEntity {
  return {
    id: 1,
    project: null,
    entryType: 'article',
    citeKey: 'test2025',
    title: 'Test Article',
    shortTitle: null,
    creators: null,
    year: '2025',
    abstract: null,
    journal: null,
    journalAbbreviation: null,
    booktitle: null,
    conferenceName: null,
    volume: null,
    number: null,
    pages: null,
    publisher: null,
    place: null,
    edition: null,
    series: null,
    seriesNumber: null,
    numberOfVolumes: null,
    numberOfPages: null,
    doi: null,
    isbn: null,
    issn: null,
    url: null,
    accessDate: null,
    websiteTitle: null,
    websiteType: null,
    institution: null,
    university: null,
    thesisType: null,
    reportNumber: null,
    reportType: null,
    archive: null,
    archiveLocation: null,
    callNumber: null,
    language: null,
    rights: null,
    note: null,
    extra: null,
    extraFields: null,
    sourceResource: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as BibliographyEntryEntity;
}

export function buildCalendarEvent(overrides: Partial<CalendarEventEntity> = {}): CalendarEventEntity {
  return {
    id: 1,
    title: 'Test Event',
    description: null,
    startDate: now,
    endDate: null,
    color: '#3b82f6',
    allDay: false,
    project: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as CalendarEventEntity;
}

export function buildTimeline(overrides: Partial<TimelineEntity> = {}): TimelineEntity {
  return {
    id: 1,
    name: 'Test Timeline',
    timelineData: null,
    project: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as TimelineEntity;
}

export function buildUserTask(overrides: Partial<UserTaskEntity> = {}): UserTaskEntity {
  return {
    id: 1,
    title: 'Test Task',
    description: null,
    status: 'pending',
    project: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as UserTaskEntity;
}

export function buildKnowledgeEntry(overrides: Partial<KnowledgeEntryEntity> = {}): KnowledgeEntryEntity {
  return {
    id: 1,
    title: 'Test Knowledge Entry',
    content: null,
    summary: null,
    tags: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as KnowledgeEntryEntity;
}

export function buildWorker(overrides: Partial<WorkerEntity> = {}): WorkerEntity {
  return {
    id: 'test-worker-uuid',
    name: 'test-worker',
    capabilities: ['document-extraction'],
    status: 'online',
    lastHeartbeat: now,
    startedAt: now,
    metadata: null,
    ...overrides,
  } as WorkerEntity;
}

export function buildPendingEntity(overrides: Partial<PendingEntityEntity> = {}): PendingEntityEntity {
  return {
    id: 1,
    resourceId: 1,
    resource: buildResource(),
    name: 'Pending Entity',
    description: null,
    language: null,
    translations: null,
    aliases: null,
    scope: 'document',
    status: 'pending',
    mergedTargetType: null,
    mergedTargetId: null,
    mergedAt: null,
    entityType: buildEntityType(),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as PendingEntityEntity;
}

export function buildResourceType(overrides: Partial<ResourceTypeEntity> = {}): ResourceTypeEntity {
  return {
    id: 1,
    abbreviation: 'ART',
    name: 'Article',
    description: null,
    example: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as ResourceTypeEntity;
}
