import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { chmod, link, mkdir, open, readFile } from 'fs/promises';
import * as fs from 'fs-extra';
import * as path from 'path';
import { EntityManager } from 'typeorm';
import { contentHash } from './execution-canonical';
import { ExecutionArtifactEntity } from './execution-artifact.entity';
import {
  assertArtifactRetentionClass,
  defaultArtifactExpiry,
  ExecutionArtifactRetentionClass,
} from './execution-artifact-policy';

const DEFAULT_INLINE_MAX_BYTES = 64 * 1024;
const UUID_PATH_PATTERN =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-' +
  '[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const FILE_STORAGE_REF_PATTERN = new RegExp(
  `^file:v1/[0-9a-f]{2}/[0-9a-f]{2}/${UUID_PATH_PATTERN}\\.blob$`,
);

export interface StoredExecutionArtifactInput {
  artifactId: string;
  rootExecutionId: string;
  kind: string;
  contentHash: string;
  size: string;
  mediaType: string;
  encoding: string;
  dataClassification: string;
  redaction: Record<string, unknown>;
  retentionClass: ExecutionArtifactRetentionClass;
  expiresAt?: Date | null;
  createdByEventId: string | null;
  producedByAttemptId?: string | null;
  inputSourceIds: string[];
  derivedFromArtifactIds?: string[];
  body: Buffer | null;
}

@Injectable()
export class ExecutionArtifactStorageService {
  private readonly storageDirectory: string;
  private readonly inlineMaxBytes: number;

  constructor(config: ConfigService) {
    const documentsDirectory = path.resolve(
      config.get<string>('DOCUMENTS_STORAGE_DIR') ?? '../documents',
    );
    this.storageDirectory = path.resolve(
      config.get<string>('EXECUTION_ARTIFACT_STORAGE_DIR') ??
        path.join(documentsDirectory, '..', 'execution-artifacts'),
    );
    this.inlineMaxBytes = this.parseInlineMaxBytes(
      config.get<string>('EXECUTION_ARTIFACT_INLINE_MAX_BYTES'),
    );
  }

  async save(
    manager: EntityManager,
    input: StoredExecutionArtifactInput,
  ): Promise<ExecutionArtifactEntity> {
    this.assertBodyIntegrity(input);
    assertArtifactRetentionClass(input.retentionClass);
    const expiresAt =
      input.expiresAt === undefined
        ? defaultArtifactExpiry(input.retentionClass)
        : input.expiresAt;
    if (expiresAt !== null && expiresAt <= new Date()) {
      throw new Error('artifact_expiry_invalid');
    }
    const physical =
      input.body !== null
        ? await this.storeBody(input.artifactId, input.body)
        : {
            storageRef: `unavailable:v1:${input.artifactId}`,
            body: null,
          };
    const repository = manager.getRepository(ExecutionArtifactEntity);
    return repository.save(
      repository.create({
        ...input,
        expiresAt,
        contentState: 'active',
        withdrawalReason: null,
        contentDeletedAt: null,
        producedByAttemptId: input.producedByAttemptId ?? null,
        derivedFromArtifactIds: input.derivedFromArtifactIds ?? [],
        storageRef: physical.storageRef,
        body: physical.body,
      }),
    );
  }

  async readBody(artifact: ExecutionArtifactEntity): Promise<Buffer | null> {
    if (
      artifact.contentState !== 'active' ||
      (artifact.expiresAt !== null && artifact.expiresAt <= new Date())
    ) {
      return null;
    }
    if (Buffer.isBuffer(artifact.body)) {
      this.assertStoredBodyIntegrity(artifact, artifact.body);
      return Buffer.from(artifact.body);
    }
    const match = FILE_STORAGE_REF_PATTERN.exec(artifact.storageRef);
    if (!match) {
      if (artifact.storageRef.startsWith('unavailable:v1:')) return null;
      throw new Error('artifact_storage_ref_invalid');
    }
    const relativePath = match[0].slice('file:'.length);
    const fullPath = this.resolveExternalPath(relativePath);
    let body: Buffer;
    try {
      body = await readFile(fullPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    this.assertStoredBodyIntegrity(artifact, body);
    return body;
  }

  async hydrate(
    artifact: ExecutionArtifactEntity,
  ): Promise<ExecutionArtifactEntity> {
    artifact.body = await this.readBody(artifact);
    return artifact;
  }

  async hydrateAll(
    artifacts: ExecutionArtifactEntity[],
  ): Promise<ExecutionArtifactEntity[]> {
    return Promise.all(artifacts.map((artifact) => this.hydrate(artifact)));
  }

  async deleteBody(artifact: ExecutionArtifactEntity): Promise<void> {
    const match = FILE_STORAGE_REF_PATTERN.exec(artifact.storageRef);
    if (!match) return;
    const relativePath = match[0].slice('file:'.length);
    await fs.remove(this.resolveExternalPath(relativePath));
  }

  private async storeBody(
    artifactId: string,
    body: Buffer,
  ): Promise<{ storageRef: string; body: Buffer | null }> {
    if (body.length <= this.inlineMaxBytes) {
      return {
        storageRef: `postgres:v1:${artifactId}`,
        body,
      };
    }
    const relativePath = this.externalRelativePath(artifactId);
    const fullPath = this.resolveExternalPath(relativePath);
    const artifactDirectory = path.dirname(fullPath);
    await mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
    await chmod(artifactDirectory, 0o700);
    const temporaryPath = `${fullPath}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporaryPath, 'wx', 0o600);
      try {
        await handle.writeFile(body);
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await link(temporaryPath, fullPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const existing = await readFile(fullPath);
        if (!existing.equals(body)) {
          throw new Error('artifact_storage_conflict');
        }
      }
      await chmod(fullPath, 0o600);
    } finally {
      await fs.remove(temporaryPath);
    }
    return { storageRef: `file:${relativePath}`, body: null };
  }

  private externalRelativePath(artifactId: string): string {
    const normalizedId = artifactId.toLowerCase();
    const compactId = normalizedId.replaceAll('-', '');
    return path.posix.join(
      'v1',
      compactId.slice(0, 2),
      compactId.slice(2, 4),
      `${normalizedId}.blob`,
    );
  }

  private resolveExternalPath(relativePath: string): string {
    const fullPath = path.resolve(this.storageDirectory, relativePath);
    const prefix = `${this.storageDirectory}${path.sep}`;
    if (!fullPath.startsWith(prefix)) {
      throw new Error('artifact_storage_ref_invalid');
    }
    return fullPath;
  }

  private assertBodyIntegrity(input: StoredExecutionArtifactInput): void {
    if (input.body === null) return;
    if (
      Number(input.size) !== input.body.length ||
      input.contentHash !== contentHash(input.body)
    ) {
      throw new Error('artifact_body_integrity_mismatch');
    }
  }

  private assertStoredBodyIntegrity(
    artifact: ExecutionArtifactEntity,
    body: Buffer,
  ): void {
    if (
      Number(artifact.size) !== body.length ||
      artifact.contentHash !== contentHash(body)
    ) {
      throw new Error('artifact_body_integrity_mismatch');
    }
  }

  private parseInlineMaxBytes(value: string | undefined): number {
    if (value === undefined || value === '') return DEFAULT_INLINE_MAX_BYTES;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new Error('EXECUTION_ARTIFACT_INLINE_MAX_BYTES must be >= 0');
    }
    return parsed;
  }
}
