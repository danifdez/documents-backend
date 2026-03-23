## File Storage

The backend uses a SHA256 content-addressed storage system to store uploaded files. Files are stored
on disk, organized by their hash, which provides automatic deduplication: if the same file is uploaded
twice, it is stored only once.

### Storage layout

Files are stored under a configurable base directory. The path for each file is derived from its SHA256 hash:

```
{base_dir}/{hash[0:3]}/{hash[3:6]}/{hash}{extension}
```

For example, a PDF with hash `a1b2c3d4e5...` would be stored at:

```
/app/documents/a1b/2c3/a1b2c3d4e5....pdf
```

This two-level directory structure prevents any single directory from growing too large with many files.

### Deduplication

When a file is uploaded, the backend computes its SHA256 hash and checks whether a resource with the
same hash already exists in the database. If it does, the upload is rejected with a `409 Conflict`
response — the existing resource is already there. If not, the file is written to disk and a new
resource record is created.

### FileStorageService API

The `FileStorageService` exposes the following methods
used internally by other modules:

| Method | Description |
|--------|-------------|
| `calculateHash(buffer)` | Computes the SHA256 hex digest of a file buffer |
| `storeFile(hash, file, originalFilename)` | Writes the file to the correct path on disk |
| `getFile(relativePath)` | Reads and returns a file from storage |
| `deleteFile(relativePath)` | Deletes a file from disk |
| `fileExists(hash, extension)` | Checks whether a file with the given hash exists |
| `getRelativePath(hash, ext)` | Returns the relative storage path for a hash/extension pair |
| `getFullPath(hash, ext)` | Returns the absolute path on disk |
| `getFilePath(relativePath)` | Resolves a relative path to an absolute path |
