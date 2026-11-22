import { promises as fs } from 'fs';
import * as path from 'path';

export type FolderScopeValidationReason =
  'not_absolute' | 'not_found' | 'not_a_directory' | 'forbidden_path';

export type FolderScopeValidationResult =
  | { ok: true; absolutePath: string }
  | { ok: false; reason: FolderScopeValidationReason };

const POSIX_FORBIDDEN_ROOTS = [
  '/',
  '/etc',
  '/bin',
  '/sbin',
  '/usr',
  '/var',
  '/boot',
  '/sys',
  '/proc',
  '/dev',
  '/lib',
  '/lib64',
];

const WINDOWS_FORBIDDEN_ROOTS = [
  'C:\\',
  String.raw`C:\Windows`,
  'C:\\Program Files',
  String.raw`C:\Program Files (x86)`,
];

const SENSITIVE_SEGMENTS = new Set([
  '.ssh',
  '.aws',
  '.gnupg',
  '.docker',
  '.kube',
  '.pki',
  '.config',
  '.npm',
  '.netrc',
  '.env',
  '.git',
  'node_modules',
]);

function isInside(root: string, candidate: string): boolean {
  const normalizedRoot = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return candidate === root || candidate.startsWith(normalizedRoot);
}

function isSensitivePath(resolved: string): boolean {
  const segments = resolved.split(path.sep).filter(Boolean);
  if (segments.some((segment) => SENSITIVE_SEGMENTS.has(segment))) {
    return true;
  }

  // Never index the backend checkout itself (it contains .env, source, keys).
  const appRoot = path.resolve(process.cwd());
  return isInside(appRoot, resolved);
}

function isInsideConfiguredRoots(resolved: string): boolean {
  const configured = (process.env.INDEXED_FILE_ALLOWED_ROOTS ?? '')
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => path.resolve(value));

  if (configured.length === 0) return true;
  return configured.some((root) => isInside(root, resolved));
}

function isForbiddenPath(resolved: string): boolean {
  if (resolved === '~') return true;

  if (process.platform === 'win32') {
    const normalized = resolved.replace(/\//g, '\\');
    const lower = normalized.toLowerCase();
    return WINDOWS_FORBIDDEN_ROOTS.some((root) => lower === root.toLowerCase());
  }

  return POSIX_FORBIDDEN_ROOTS.includes(resolved);
}

export async function validateFolderScope(
  input: string,
): Promise<FolderScopeValidationResult> {
  if (input === '~') {
    return { ok: false, reason: 'forbidden_path' };
  }

  if (!path.isAbsolute(input)) {
    return { ok: false, reason: 'not_absolute' };
  }

  let resolved: string;
  try {
    resolved = await fs.realpath(input);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return { ok: false, reason: 'not_found' };
    throw err;
  }

  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return { ok: false, reason: 'not_found' };
    throw err;
  }

  if (!stat.isDirectory()) {
    return { ok: false, reason: 'not_a_directory' };
  }

  if (
    isForbiddenPath(resolved) ||
    isSensitivePath(resolved) ||
    !isInsideConfiguredRoots(resolved)
  ) {
    return { ok: false, reason: 'forbidden_path' };
  }

  return { ok: true, absolutePath: resolved };
}

export function folderScopeReasonToMessage(
  reason: FolderScopeValidationReason,
): string {
  switch (reason) {
    case 'not_absolute':
      return 'Folder path must be absolute.';
    case 'not_found':
      return 'Folder does not exist.';
    case 'not_a_directory':
      return 'Path points to a file, not a folder.';
    case 'forbidden_path':
      return 'That folder is not allowed (system paths are blocked).';
  }
}
