import { FileStorageService } from '../../../src/file-storage/file-storage.service';

describe('FileStorageService', () => {
  let service: FileStorageService;

  beforeEach(() => {
    const mockConfigService = { get: jest.fn().mockReturnValue(undefined) } as any;
    service = new FileStorageService(mockConfigService);
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
});
