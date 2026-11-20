import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStorageService } from '../../../src/file-storage/file-storage.service';

describe('FileStorageService', () => {
  let service: FileStorageService;

  let fixture: string;
  let storage: string;
  let archive: string;

  beforeEach(async () => {
    fixture = await mkdtemp(join(tmpdir(), 'documents-file-storage-'));
    storage = join(fixture, 'active');
    archive = join(fixture, 'archive');
    await Promise.all([mkdir(storage), mkdir(archive)]);
    const directories = {
      DOCUMENTS_STORAGE_DIR: storage,
      DOCUMENTS_ARCHIVE_DIR: archive,
    };
    service = new FileStorageService({
      get: (key: string) => directories[key],
    } as any);
  });

  afterEach(async () => {
    await rm(fixture, { recursive: true, force: true });
  });

  describe('calculateHash', () => {
    it('should return consistent SHA256 hash for same input', () => {
      const buf = Buffer.from('hello world');
      const hash1 = service.calculateHash(buf);
      const hash2 = service.calculateHash(buf);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it('should return different hashes for different inputs', () => {
      const hash1 = service.calculateHash(Buffer.from('hello'));
      const hash2 = service.calculateHash(Buffer.from('world'));
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('getRelativePath', () => {
    it('should build path from hash prefix directories', () => {
      const hash = 'abcdef1234567890';
      const result = service.getRelativePath(hash, '.pdf');
      expect(result).toContain('abc');
      expect(result).toContain('def');
      expect(result).toContain(`${hash}.pdf`);
    });
  });

  it('stores and reads a file by its sharded hash path', async () => {
    const payload = Buffer.from('document content');
    const hash = service.calculateHash(payload);
    const relativePath = join(
      hash.slice(0, 3),
      hash.slice(3, 6),
      `${hash}.txt`,
    );
    await expect(
      service.storeFile(hash, payload, 'source.txt'),
    ).resolves.toEqual({
      hash,
      relativePath,
      extension: '.txt',
    });
    expect(service.getFullPath(hash, '.txt')).toBe(join(storage, relativePath));
    expect(service.getFilePath(relativePath)).toBe(join(storage, relativePath));
    await expect(readFile(join(storage, relativePath))).resolves.toEqual(
      payload,
    );
    await expect(service.getFile(relativePath)).resolves.toEqual(payload);
    await expect(service.deleteFile(relativePath)).resolves.toBe(true);
    await expect(service.getFile(relativePath)).resolves.toBeNull();
    await expect(service.deleteFile(relativePath)).resolves.toBe(false);
  });

  it('moves content to archive and restores it to the same storage path', async () => {
    const payload = Buffer.from('archive fixture');
    const { relativePath } = await service.storeFile(
      service.calculateHash(payload),
      payload,
      'README',
    );
    expect(service.getArchiveFilePath(relativePath)).toBe(
      join(archive, relativePath),
    );
    await expect(service.archivedFileExists(relativePath)).resolves.toBe(false);
    await expect(service.getFileFromArchive(relativePath)).resolves.toBeNull();
    await service.moveToArchive(relativePath);
    await expect(service.getFile(relativePath)).resolves.toBeNull();
    await expect(service.archivedFileExists(relativePath)).resolves.toBe(true);
    await expect(service.getFileFromArchive(relativePath)).resolves.toEqual(
      payload,
    );
    await service.moveFromArchive(relativePath);
    await expect(service.getFile(relativePath)).resolves.toEqual(payload);
    await expect(service.getFileFromArchive(relativePath)).resolves.toBeNull();
  });
});
