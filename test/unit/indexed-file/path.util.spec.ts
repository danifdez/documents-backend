import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ForbiddenException } from '@nestjs/common';
import {
  sanitizeFilename,
  resolveSafePath,
  relativizeToScope,
  detectMimeType,
} from '../../../src/indexed-file/path.util';

describe('path.util', () => {
  describe('sanitizeFilename', () => {
    it('keeps simple names', () => {
      expect(sanitizeFilename('notes.md')).toBe('notes.md');
    });

    it('keeps subfolders', () => {
      expect(sanitizeFilename('recipes/paella.md')).toBe('recipes/paella.md');
    });

    it('normalizes backslashes', () => {
      expect(sanitizeFilename('recipes\\paella.md')).toBe('recipes/paella.md');
    });

    it('strips reserved characters', () => {
      expect(sanitizeFilename('a<b>c:d|e?f*g.md')).toBe('abcdefg.md');
    });

    it('rejects empty/all-dot names', () => {
      expect(() => sanitizeFilename('')).toThrow(ForbiddenException);
      expect(() => sanitizeFilename('..')).toThrow(ForbiddenException);
      expect(() => sanitizeFilename('./..')).toThrow(ForbiddenException);
    });
  });

  describe('resolveSafePath', () => {
    let tmpRoot: string;
    beforeAll(async () => {
      tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-path-test-'));
    });
    afterAll(async () => {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    });

    it('resolves a simple file inside scope', async () => {
      const result = await resolveSafePath(tmpRoot, 'a.md');
      expect(result).toBe(path.join(tmpRoot, 'a.md'));
    });

    it('rejects escape via ..', async () => {
      await expect(resolveSafePath(tmpRoot, '../escape.md')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects symlinks pointing outside scope', async () => {
      const outsideTarget = await fs.mkdtemp(path.join(os.tmpdir(), 'outside-'));
      const link = path.join(tmpRoot, 'leak');
      await fs.symlink(outsideTarget, link, 'dir');
      try {
        await expect(resolveSafePath(tmpRoot, 'leak/file.md')).rejects.toThrow(
          ForbiddenException,
        );
      } finally {
        await fs.unlink(link);
        await fs.rm(outsideTarget, { recursive: true, force: true });
      }
    });
  });

  describe('relativizeToScope', () => {
    it('returns relative POSIX-style path', () => {
      expect(relativizeToScope('/tmp/scope', '/tmp/scope/a/b.md')).toBe('a/b.md');
    });

    it('throws on paths outside scope', () => {
      expect(() => relativizeToScope('/tmp/scope', '/tmp/other/a.md')).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('detectMimeType', () => {
    it('detects markdown', () => {
      expect(detectMimeType('notes.md')).toBe('text/markdown');
    });
    it('falls back to octet-stream', () => {
      expect(detectMimeType('weird.xyz')).toBe('application/octet-stream');
    });
  });
});
