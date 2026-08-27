import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { contentHash } from '../../../src/execution/execution-canonical';
import { ExecutionArtifactStorageService } from '../../../src/execution/execution-artifact-storage.service';

const ARTIFACT_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca701';
const ROOT_EXECUTION_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca702';

describe('ExecutionArtifactStorageService', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'documents-artifacts-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  function setup(inlineMaxBytes: number) {
    const repository = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    const manager = {
      getRepository: jest.fn(() => repository),
    };
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'EXECUTION_ARTIFACT_STORAGE_DIR') return directory;
        if (key === 'EXECUTION_ARTIFACT_INLINE_MAX_BYTES') {
          return String(inlineMaxBytes);
        }
        return undefined;
      }),
    };
    return {
      service: new ExecutionArtifactStorageService(config as any),
      manager,
      repository,
    };
  }

  function input(body: Buffer) {
    return {
      artifactId: ARTIFACT_ID,
      rootExecutionId: ROOT_EXECUTION_ID,
      kind: 'dataset_snapshot',
      contentHash: contentHash(body),
      size: String(body.length),
      mediaType: 'application/json',
      encoding: 'identity',
      dataClassification: 'workspace',
      redaction: { applied: false },
      retentionClass: 'execution',
      createdByEventId: null,
      inputSourceIds: [],
      body,
    };
  }

  it('keeps small bodies inline in PostgreSQL', async () => {
    const { service, manager } = setup(1024);
    const body = Buffer.from('{"value":1}');

    const artifact = await service.save(manager as any, input(body));

    expect(artifact.storageRef).toBe(`postgres:v1:${ARTIFACT_ID}`);
    expect(artifact.body).toEqual(body);
    await expect(service.readBody(artifact as any)).resolves.toEqual(body);
  });

  it('stores large bodies externally and resolves them transparently', async () => {
    const { service, manager } = setup(4);
    const body = Buffer.from('{"value":1}');

    const artifact = await service.save(manager as any, input(body));

    expect(artifact.storageRef).toMatch(/^file:v1\//);
    expect(artifact.body).toBeNull();
    await expect(service.readBody(artifact as any)).resolves.toEqual(body);
    const relativePath = artifact.storageRef.slice('file:'.length);
    await expect(readFile(join(directory, relativePath))).resolves.toEqual(
      body,
    );
  });

  it('reuses an immutable external body on an idempotent write', async () => {
    const { service, manager } = setup(0);
    const body = Buffer.from('same body');

    const first = await service.save(manager as any, input(body));
    const second = await service.save(manager as any, input(body));

    expect(second.storageRef).toBe(first.storageRef);
    await expect(service.readBody(second as any)).resolves.toEqual(body);
  });

  it('rejects different content for an occupied artifact identity', async () => {
    const { service, manager } = setup(0);
    await service.save(manager as any, input(Buffer.from('first')));

    await expect(
      service.save(manager as any, input(Buffer.from('second'))),
    ).rejects.toThrow('artifact_storage_conflict');
  });

  it('rejects a modified external body', async () => {
    const { service, manager } = setup(0);
    const artifact = await service.save(
      manager as any,
      input(Buffer.from('original')),
    );
    await writeFile(
      join(directory, artifact.storageRef.slice('file:'.length)),
      'modified',
    );

    await expect(service.readBody(artifact as any)).rejects.toThrow(
      'artifact_body_integrity_mismatch',
    );
  });

  it('represents an intentionally absent body without physical storage', async () => {
    const { service, manager } = setup(0);
    const artifact = await service.save(manager as any, {
      ...input(Buffer.alloc(0)),
      body: null,
    });

    expect(artifact.storageRef).toBe(`unavailable:v1:${ARTIFACT_ID}`);
    await expect(service.readBody(artifact as any)).resolves.toBeNull();
  });

  it('fails fast when the inline threshold is invalid', () => {
    const config = {
      get: jest.fn((key: string) =>
        key === 'EXECUTION_ARTIFACT_INLINE_MAX_BYTES' ? '-1' : directory,
      ),
    };

    expect(() => new ExecutionArtifactStorageService(config as any)).toThrow(
      'EXECUTION_ARTIFACT_INLINE_MAX_BYTES must be >= 0',
    );
  });

  it('rejects storage references outside the versioned artifact namespace', async () => {
    const { service } = setup(0);

    await expect(
      service.readBody({
        ...input(Buffer.from('body')),
        body: null,
        storageRef: 'file:../../secret',
      } as any),
    ).rejects.toThrow('artifact_storage_ref_invalid');
  });
});
