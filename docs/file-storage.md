# File Storage

The backend uses a content-addressed file storage system with SHA256 hash-based deduplication.

## Overview

When a file is uploaded, its SHA256 hash is computed. If a file with the same hash already exists in the database, the upload is rejected (HTTP 409). Otherwise, the file is stored on disk using its hash as the filename.

## Storage Path Structure

Files are stored under `/app/documents_storage` with a two-level directory structure based on the hash prefix:

```
/app/documents_storage/{hash[0:3]}/{hash[3:6]}/{hash}{extension}
```

**Example:** A file with hash `a1b2c3d4e5f6...` and extension `.pdf`:

```
/app/documents_storage/a1b/2c3/a1b2c3d4e5f6...pdf
```

This prevents any single directory from containing too many files.

## FileStorageService API

Located at `src/file-storage/file-storage.service.ts`.

| Method | Parameters | Returns | Description |
|--------|-----------|---------|-------------|
| `calculateHash` | `buffer: Buffer` | `string` | Compute SHA256 hex digest of a buffer |
| `storeFile` | `hash: string, file: Buffer, originalFilename: string` | `{ hash, relativePath, extension }` | Store a file on disk |
| `getFile` | `relativePath: string` | `Buffer \| null` | Read a file from storage |
| `deleteFile` | `relativePath: string` | `boolean` | Delete a file from storage |
| `fileExists` | `hash: string, extension: string` | `boolean` | Check if a file exists by hash |
| `getRelativePath` | `hash: string, extension: string` | `string` | Get relative path for a hash |
| `getFullPath` | `hash: string, extension: string` | `string` | Get absolute path for a hash |
| `getFilePath` | `relativePath: string` | `string` | Convert relative path to absolute |

## Deduplication

Duplicate detection happens at the controller level in `ResourceController.uploadFile()`:

1. The SHA256 hash is calculated from the uploaded file buffer
2. The database is queried for an existing resource with the same hash
3. If found, an `AlreadyExistException` is thrown (HTTP 409 Conflict)
4. If not found, the file is stored and a new resource record is created

## File Deletion

When a resource is deleted via `DELETE /resources/:id`, the controller:

1. Removes the resource record from the database
2. Calls `fileStorageService.deleteFile()` to remove the physical file

## Docker Volume

In the Docker setup, file storage is mapped to a host directory:

```yaml
volumes:
  - ./documents:/app/documents_storage:rw
```

This ensures files persist across container restarts and are shared between services.
