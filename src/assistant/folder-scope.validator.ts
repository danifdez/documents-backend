import { promises as fs } from 'fs';
import * as path from 'path';

export type FolderScopeValidationReason =
  | 'not_absolute'
  | 'not_found'
  | 'not_a_directory'
  | 'forbidden_path';

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
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
];

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

  if (isForbiddenPath(resolved)) {
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

export const _internals = { POSIX_FORBIDDEN_ROOTS, WINDOWS_FORBIDDEN_ROOTS };
