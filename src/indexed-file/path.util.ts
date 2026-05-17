import { promises as fs } from 'fs';
import * as path from 'path';
import { ForbiddenException } from '@nestjs/common';

const MIME_MAP: Record<string, string> = {
  // Documents
  '.pdf': 'application/pdf',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.log': 'text/plain',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Data / config
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.toml': 'application/toml',
  '.ini': 'text/plain',
  // Source code (served as text/plain so editors don't try to render)
  '.py': 'text/x-python',
  '.js': 'application/javascript',
  '.ts': 'application/typescript',
  '.tsx': 'application/typescript',
  '.jsx': 'application/javascript',
  '.sh': 'application/x-sh',
  '.bash': 'application/x-sh',
  '.sql': 'application/sql',
  '.css': 'text/css',
  '.scss': 'text/x-scss',
  '.less': 'text/x-less',
  '.go': 'text/x-go',
  '.rs': 'text/x-rust',
  '.rb': 'text/x-ruby',
  '.java': 'text/x-java',
  '.c': 'text/x-c',
  '.cpp': 'text/x-c++',
  '.h': 'text/x-c',
  '.hpp': 'text/x-c++',
  '.cs': 'text/x-csharp',
  '.php': 'application/x-httpd-php',
  '.r': 'text/x-r',
  '.kt': 'text/x-kotlin',
  '.swift': 'text/x-swift',
  '.dockerfile': 'text/x-dockerfile',
  // Images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  // Mail
  '.eml': 'message/rfc822',
  // Audio / video
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.opus': 'audio/opus',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
};

export function detectMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

// eslint-disable-next-line no-control-regex
const RESERVED_CHARS = /[<>:"|?*\x00-\x1f]/g;

export function sanitizeFilename(name: string): string {
  if (!name) throw new ForbiddenException('invalid_filename');
  const normalized = name.replace(/\\/g, '/');
  const segments = normalized.split('/').filter((s) => s.length > 0 && s !== '.');
  if (segments.length === 0) throw new ForbiddenException('invalid_filename');
  if (segments.some((s) => s === '..')) {
    throw new ForbiddenException('path_outside_scope');
  }
  const cleaned = segments
    .map((segment) => segment.replace(RESERVED_CHARS, '').trim())
    .filter((segment) => segment.length > 0)
    .join('/');
  if (!cleaned) throw new ForbiddenException('invalid_filename');
  return cleaned;
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function realpathOfNearestExistingAncestor(p: string): Promise<string> {
  let current = p;
  while (true) {
    try {
      return await fs.realpath(current);
    } catch (err: any) {
      if (err?.code !== 'ENOENT') throw err;
      const parent = path.dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
}

export async function resolveSafePath(
  folderScope: string,
  relativeName: string,
): Promise<string> {
  const sanitized = sanitizeFilename(relativeName);
  const scopeReal = await fs.realpath(folderScope);
  const absolute = path.resolve(scopeReal, sanitized);

  if (!isInside(scopeReal, absolute)) {
    throw new ForbiddenException('path_outside_scope');
  }

  const ancestorReal = await realpathOfNearestExistingAncestor(absolute);
  if (!isInside(scopeReal, ancestorReal)) {
    throw new ForbiddenException('path_outside_scope');
  }

  try {
    const real = await fs.realpath(absolute);
    if (!isInside(scopeReal, real)) {
      throw new ForbiddenException('path_outside_scope');
    }
    return real;
  } catch (err: any) {
    if (err?.code === 'ENOENT') return absolute;
    if (err instanceof ForbiddenException) throw err;
    throw err;
  }
}

export function relativizeToScope(folderScope: string, absolute: string): string {
  const rel = path.relative(folderScope, absolute);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new ForbiddenException('path_outside_scope');
  }
  return rel.split(path.sep).join('/');
}
