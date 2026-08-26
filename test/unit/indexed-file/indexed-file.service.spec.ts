import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException } from '@nestjs/common';
import {
  IndexedFileService,
  OwnerRef,
} from '../../../src/indexed-file/indexed-file.service';
import { IndexedFileEntity } from '../../../src/indexed-file/indexed-file.entity';
import { AgentEntity } from '../../../src/agent/agent.entity';
import { ExecutionService } from '../../../src/execution/execution.service';
import { VectorStoreService } from '../../../src/vector/vector-store.service';

function createMockRepo() {
  const store = new Map<number, any>();
  let nextId = 1;
  return {
    store,
    findOne: jest.fn(async ({ where }: any) => {
      for (const row of store.values()) {
        const match = Object.entries(where).every(([k, v]) => row[k] === v);
        if (match) return row;
      }
      return null;
    }),
    find: jest.fn(async ({ where }: any = {}) => {
      const list: any[] = [];
      for (const row of store.values()) {
        if (!where) {
          list.push(row);
          continue;
        }
        const match = Object.entries(where).every(([k, v]) => row[k] === v);
        if (match) list.push(row);
      }
      return list;
    }),
    create: jest.fn((data: any) => ({ ...data })),
    save: jest.fn(async (data: any) => {
      if (data.id == null) data.id = nextId++;
      store.set(data.id, data);
      return data;
    }),
    delete: jest.fn(async (criteria: any) => {
      if (criteria.id != null) {
        store.delete(criteria.id);
        return { affected: 1 };
      }
      // Multi-key match (ownerType + ownerId).
      const matchEntries = Object.entries(criteria);
      for (const [k, v] of store.entries()) {
        const m = matchEntries.every(([ck, cv]) => v[ck] === cv);
        if (m) store.delete(k);
      }
      return { affected: 1 };
    }),
  };
}

const OWNER_TYPE = 'agent' as const;

describe('IndexedFileService', () => {
  let service: IndexedFileService;
  let tmpScope: string;
  const agentId = 42;
  const owner: OwnerRef = { ownerType: OWNER_TYPE, ownerId: agentId };
  let indexedRepo: ReturnType<typeof createMockRepo>;
  let agentRepo: ReturnType<typeof createMockRepo>;
  let executionService: { create: jest.Mock };
  let vectorStore: Record<string, jest.Mock>;

  beforeEach(async () => {
    tmpScope = await fs.mkdtemp(path.join(os.tmpdir(), 'indexed-file-test-'));
    indexedRepo = createMockRepo();
    agentRepo = createMockRepo();
    agentRepo.store.set(agentId, {
      id: agentId,
      folderScope: tmpScope,
    });

    executionService = { create: jest.fn(async () => ({ id: 1 })) };
    vectorStore = {
      indexedFileCandidates: jest.fn().mockResolvedValue([]),
      vectorCandidatesArtifact: jest.fn().mockReturnValue({
        role: 'vector_candidates',
        kind: 'vector_candidates',
        mediaType: 'application/json',
        body: Buffer.from('{"candidates":[]}'),
      }),
      deleteIndexedFile: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IndexedFileService,
        {
          provide: getRepositoryToken(IndexedFileEntity),
          useValue: indexedRepo,
        },
        { provide: getRepositoryToken(AgentEntity), useValue: agentRepo },
        { provide: ExecutionService, useValue: executionService },
        { provide: VectorStoreService, useValue: vectorStore },
      ],
    }).compile();
    service = module.get(IndexedFileService);
  });

  afterEach(async () => {
    await fs.rm(tmpScope, { recursive: true, force: true });
  });

  it('writeFile creates file on disk and row in DB', async () => {
    const entity = await service.writeFile(owner, 'notes.md', '# Hello', {
      overwrite: false,
    });
    expect(entity.filename).toBe('notes.md');
    expect(entity.ownerType).toBe(OWNER_TYPE);
    expect(entity.ownerId).toBe(agentId);
    expect(entity.mimeType).toBe('text/markdown');
    expect(entity.size).toBe(7);
    expect(entity.checksum).toMatch(/^[0-9a-f]{64}$/);
    const content = await fs.readFile(path.join(tmpScope, 'notes.md'), 'utf-8');
    expect(content).toBe('# Hello');
  });

  it('writeFile throws ConflictException when file exists without overwrite', async () => {
    await service.writeFile(owner, 'lista.md', 'one', { overwrite: false });
    await expect(
      service.writeFile(owner, 'lista.md', 'two', { overwrite: false }),
    ).rejects.toThrow(ConflictException);
  });

  it('writeFile with overwrite updates existing row', async () => {
    const first = await service.writeFile(owner, 'lista.md', 'one', {
      overwrite: false,
    });
    const second = await service.writeFile(owner, 'lista.md', 'two', {
      overwrite: true,
    });
    expect(second.id).toBe(first.id);
    expect(second.size).toBe(3);
    expect(indexedRepo.store.size).toBe(1);
  });

  it('writeFile accepts a Buffer for binary content', async () => {
    const buf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0xff, 0xfe, 0x00, 0x01]);
    const entity = await service.writeFile(owner, 'report.pdf', buf, {
      overwrite: false,
    });
    expect(entity.filename).toBe('report.pdf');
    expect(entity.mimeType).toBe('application/pdf');
    expect(entity.size).toBe(8);
    const onDisk = await fs.readFile(path.join(tmpScope, 'report.pdf'));
    expect(onDisk.equals(buf)).toBe(true);
  });

  it('writeFile uses MIME from filename, not from content (xlsx case)', async () => {
    const xlsxLike = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
    const entity = await service.writeFile(owner, 'data.xlsx', xlsxLike, {
      overwrite: false,
    });
    expect(entity.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  it('deleteFile is idempotent', async () => {
    const e = await service.writeFile(owner, 'borrar.md', 'x', {
      overwrite: false,
    });
    await service.deleteFile(e.id, {
      ownerType: OWNER_TYPE,
      ownerId: agentId,
    });
    await service.deleteFile(e.id, {
      ownerType: OWNER_TYPE,
      ownerId: agentId,
    });
    expect(indexedRepo.store.size).toBe(0);
  });

  it('clearAllForOwner removes all rows for the owner', async () => {
    await service.writeFile(owner, 'a.md', 'a', { overwrite: false });
    await service.writeFile(owner, 'b.md', 'b', { overwrite: false });
    await service.clearAllForOwner(owner);
    expect(indexedRepo.store.size).toBe(0);
  });

  describe('scanFolder', () => {
    it('returns no_folder when owner has no folderScope', async () => {
      agentRepo.store.set(agentId, {
        id: agentId,
        folderScope: null,
      });
      const result = await service.scanFolder(owner);
      expect(result).toEqual({ status: 'no_folder' });
    });

    it('detects added files', async () => {
      await fs.writeFile(path.join(tmpScope, 'a.md'), 'A');
      await fs.writeFile(path.join(tmpScope, 'b.md'), 'B');
      const result = await service.scanFolder(owner);
      expect(result).toEqual({
        status: 'done',
        added: 2,
        updated: 0,
        removed: 0,
      });
      expect(indexedRepo.store.size).toBe(2);
    });

    it('detects modified files and resets extracted fields', async () => {
      await service.writeFile(owner, 'a.md', 'first', { overwrite: false });
      const row: any = [...indexedRepo.store.values()][0];
      row.extractedText = 'old';
      row.embeddingId = 'old-embed';
      await fs.writeFile(path.join(tmpScope, 'a.md'), 'second-longer-content');
      const futureMtime = new Date(Date.now() + 5000);
      await fs.utimes(path.join(tmpScope, 'a.md'), futureMtime, futureMtime);

      const result = await service.scanFolder(owner);
      expect(result).toEqual({
        status: 'done',
        added: 0,
        updated: 1,
        removed: 0,
      });
      const updated: any = [...indexedRepo.store.values()][0];
      expect(updated.extractedText).toBeNull();
      expect(updated.embeddingId).toBeNull();
    });

    it('detects removed files', async () => {
      await service.writeFile(owner, 'a.md', 'x', { overwrite: false });
      await fs.unlink(path.join(tmpScope, 'a.md'));
      const result = await service.scanFolder(owner);
      expect(result).toEqual({
        status: 'done',
        added: 0,
        updated: 0,
        removed: 1,
      });
      expect(indexedRepo.store.size).toBe(0);
    });

    it('returns folder_missing when folder does not exist', async () => {
      await fs.rm(tmpScope, { recursive: true, force: true });
      const result = await service.scanFolder(owner);
      expect(result.status).toBe('folder_missing');
    });

    it('serializes concurrent scans for the same owner', async () => {
      await fs.writeFile(path.join(tmpScope, 'a.md'), 'A');
      const [r1, r2] = await Promise.all([
        service.scanFolder(owner),
        service.scanFolder(owner),
      ]);
      expect(r1).toBe(r2);
    });

    it('enqueues an extraction execution per new file', async () => {
      await fs.writeFile(path.join(tmpScope, 'a.md'), 'A');
      await fs.writeFile(path.join(tmpScope, 'b.txt'), 'B');
      await service.scanFolder(owner);
      expect(executionService.create).toHaveBeenCalledTimes(2);
      const types = executionService.create.mock.calls.map((c) => c[0]);
      expect(types).toEqual([
        'indexed-file-extraction',
        'indexed-file-extraction',
      ]);
    });
  });

  describe('readWithSync', () => {
    it('returns content of an indexed text file', async () => {
      const f = await service.writeFile(owner, 'a.md', 'hello', {
        overwrite: false,
      });
      const result = await service.readWithSync(owner, { indexedFileId: f.id });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.content).toBe('hello');
        expect(result.mimeType).toBe('text/markdown');
        expect(result.filename).toBe('a.md');
      }
    });

    it('returns not_found when the file is missing on disk and clears the index', async () => {
      const f = await service.writeFile(owner, 'a.md', 'hello', {
        overwrite: false,
      });
      await fs.unlink(path.join(tmpScope, 'a.md'));
      const result = await service.readWithSync(owner, { indexedFileId: f.id });
      expect(result).toMatchObject({ ok: false, error: 'not_found' });
      expect(indexedRepo.store.size).toBe(0);
    });

    it('detects ambiguous filenames', async () => {
      await service.writeFile(owner, 'recipes/paella.md', 'x', {
        overwrite: false,
      });
      await service.writeFile(owner, 'archive/paella.md', 'y', {
        overwrite: false,
      });
      const result = await service.readWithSync(owner, {
        filename: 'paella.md',
      });
      expect(result.ok).toBe(false);
      const r = result as any;
      expect(r.error).toBe('ambiguous');
      expect(r.candidates).toHaveLength(2);
    });

    it('reads via basename when only one match exists', async () => {
      await service.writeFile(owner, 'recipes/paella.md', 'rice', {
        overwrite: false,
      });
      const result = await service.readWithSync(owner, {
        filename: 'paella.md',
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.filename).toBe('recipes/paella.md');
    });

    it('reindexes when the file changed on disk', async () => {
      const f = await service.writeFile(owner, 'a.md', 'first', {
        overwrite: false,
      });
      const originalChecksum = (await service.getById(f.id)).checksum;
      await new Promise((r) => setTimeout(r, 10));
      await fs.writeFile(path.join(tmpScope, 'a.md'), 'second longer content');
      const future = new Date(Date.now() + 5000);
      await fs.utimes(path.join(tmpScope, 'a.md'), future, future);

      const result = await service.readWithSync(owner, { indexedFileId: f.id });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.content).toBe('second longer content');
      const refreshed = await service.getById(f.id);
      expect(refreshed.checksum).not.toBe(originalChecksum);
      expect(refreshed.extractedText).toBeNull();
      expect(refreshed.embeddingId).toBeNull();
    });

    it('adopts a file that exists on disk but not in the index', async () => {
      await fs.writeFile(path.join(tmpScope, 'orphan.md'), 'orphan');
      const result = await service.readWithSync(owner, {
        filename: 'orphan.md',
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.content).toBe('orphan');
      expect(indexedRepo.store.size).toBe(1);
    });
  });

  it('writeFile enqueues an extraction execution', async () => {
    await service.writeFile(owner, 'a.md', 'hello', { overwrite: false });
    expect(executionService.create).toHaveBeenCalledTimes(1);
    const [type, , payload] = executionService.create.mock.calls[0];
    expect(type).toBe('indexed-file-extraction');
    expect(payload).toMatchObject({ extension: '.md' });
  });

  // Vector chunks are removed by the indexed_file_chunks.indexed_file_id FK
  // (ON DELETE CASCADE), so deleting the row is enough and needs no cleanup execution.
  describe('vector cleanup (ON DELETE CASCADE)', () => {
    it('deleteFile relies on the foreign-key cascade', async () => {
      const e = await service.writeFile(owner, 'a.md', 'x', {
        overwrite: false,
      });
      executionService.create.mockClear();
      await service.deleteFile(e.id, {
        ownerType: OWNER_TYPE,
        ownerId: agentId,
      });
      expect(indexedRepo.store.size).toBe(0);
      expect(executionService.create).not.toHaveBeenCalled();
    });

    it('clearAllForOwner relies on the foreign-key cascade', async () => {
      await service.writeFile(owner, 'a.md', 'x', { overwrite: false });
      executionService.create.mockClear();
      await service.clearAllForOwner(owner);
      expect(indexedRepo.store.size).toBe(0);
      expect(executionService.create).not.toHaveBeenCalled();
    });
  });
});
