import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { validateFolderScope } from '../../../src/assistant/folder-scope.validator';

describe('validateFolderScope', () => {
  let tmpRoot: string;

  beforeAll(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'folder-scope-test-'));
  });

  afterAll(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('rejects relative paths', async () => {
    const result = await validateFolderScope('relative/path');
    expect(result).toEqual({ ok: false, reason: 'not_absolute' });
  });

  it('rejects non-existing paths', async () => {
    const result = await validateFolderScope(path.join(tmpRoot, 'does-not-exist'));
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('rejects when path points to a file', async () => {
    const filePath = path.join(tmpRoot, 'a-file.txt');
    await fs.writeFile(filePath, 'hi');
    const result = await validateFolderScope(filePath);
    expect(result).toEqual({ ok: false, reason: 'not_a_directory' });
  });

  it('rejects forbidden system roots', async () => {
    const targets = ['/', '/etc', '/usr'];
    for (const t of targets) {
      const result = await validateFolderScope(t);
      expect(result).toEqual({ ok: false, reason: 'forbidden_path' });
    }
  });

  it('rejects bare tilde as forbidden_path', async () => {
    const result = await validateFolderScope('~');
    expect(result).toEqual({ ok: false, reason: 'forbidden_path' });
  });

  it('accepts a real user-owned directory', async () => {
    const folder = path.join(tmpRoot, 'workspace');
    await fs.mkdir(folder);
    const result = await validateFolderScope(folder);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.absolutePath).toBe(await fs.realpath(folder));
  });

  it('resolves symlinks and returns the realpath', async () => {
    const target = path.join(tmpRoot, 'target-folder');
    await fs.mkdir(target);
    const link = path.join(tmpRoot, 'link-to-folder');
    await fs.symlink(target, link, 'dir');

    const result = await validateFolderScope(link);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.absolutePath).toBe(await fs.realpath(target));
      expect(result.absolutePath).not.toBe(link);
    }
  });
});
