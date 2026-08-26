import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

const EMBEDDING_DIMENSIONS = 384;
const MAX_CANDIDATES = 5_000;

export interface VectorPointInput {
  id: string;
  embedding: number[];
  payload: Record<string, unknown>;
}

export type VectorCandidate = VectorPointInput;
export type WorkspaceVectorSourceType = 'resource' | 'doc' | 'knowledge';

@Injectable()
export class VectorStoreService {
  constructor(private readonly dataSource: DataSource) {}

  async replaceWorkspaceSource(
    sourceType: WorkspaceVectorSourceType,
    sourceId: string,
    projectId: number | null,
    points: VectorPointInput[],
  ): Promise<void> {
    if (!new RegExp(`^${sourceType}_[1-9][0-9]*$`).test(sourceId)) {
      throw new Error('Workspace vector source id is invalid');
    }
    if (projectId != null && (!Number.isInteger(projectId) || projectId <= 0)) {
      throw new Error('Workspace vector project id is invalid');
    }
    const validated = points.map((point) => {
      const validatedPoint = this.validatePoint(point);
      if (!validatedPoint.id.startsWith(`${sourceId}:`)) {
        throw new Error('Workspace vector point id is outside its source');
      }
      return {
        ...validatedPoint,
        payload: {
          ...validatedPoint.payload,
          source_type: sourceType,
          source_id: sourceId,
          project_id: projectId,
        },
      };
    });
    await this.dataSource.transaction(async (manager) => {
      await manager.query('DELETE FROM rag_chunks WHERE source_id = $1', [
        sourceId,
      ]);
      for (const point of validated) {
        await manager.query(
          `INSERT INTO rag_chunks
             (id, embedding, source_type, source_id, project_id, payload)
           VALUES ($1, $2::vector, $3, $4, $5, $6::jsonb)`,
          [
            point.id,
            this.vectorLiteral(point.embedding),
            sourceType,
            sourceId,
            projectId == null ? null : String(projectId),
            JSON.stringify(point.payload),
          ],
        );
      }
    });
  }

  async replaceIndexedFile(
    indexedFileId: number,
    ownerTag: string,
    points: VectorPointInput[],
  ): Promise<void> {
    if (!Number.isInteger(indexedFileId) || indexedFileId <= 0) {
      throw new Error('Indexed file id is invalid');
    }
    if (!/^agent:[1-9][0-9]*$/.test(ownerTag)) {
      throw new Error('Indexed file owner is invalid');
    }
    const sourceId = `indexed_file_${indexedFileId}`;
    const validated = points.map((point) => {
      const validatedPoint = this.validatePoint(point);
      if (!validatedPoint.id.startsWith(`${sourceId}:`)) {
        throw new Error('Indexed file vector point id is outside its source');
      }
      return {
        ...validatedPoint,
        payload: {
          ...validatedPoint.payload,
          source_id: sourceId,
          indexed_file_id: indexedFileId,
          owner_tag: ownerTag,
        },
      };
    });
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        'DELETE FROM indexed_file_chunks WHERE indexed_file_id = $1',
        [indexedFileId],
      );
      for (const point of validated) {
        await manager.query(
          `INSERT INTO indexed_file_chunks
             (id, embedding, indexed_file_id, owner_tag, payload)
           VALUES ($1, $2::vector, $3, $4, $5::jsonb)`,
          [
            point.id,
            this.vectorLiteral(point.embedding),
            indexedFileId,
            ownerTag,
            JSON.stringify(point.payload),
          ],
        );
      }
    });
  }

  async replaceMemory(
    memoryId: number,
    assistantId: number,
    embedding: number[],
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (
      !Number.isInteger(memoryId) ||
      memoryId <= 0 ||
      !Number.isInteger(assistantId) ||
      assistantId <= 0
    ) {
      throw new Error('Memory vector identity is invalid');
    }
    const point = this.validatePoint({
      id: String(memoryId),
      embedding,
      payload,
    });
    await this.dataSource.query(
      `INSERT INTO memory_vectors
         (memory_id, embedding, assistant_id, payload)
       VALUES ($1, $2::vector, $3, $4::jsonb)
       ON CONFLICT (memory_id) DO UPDATE SET
         embedding = EXCLUDED.embedding,
         assistant_id = EXCLUDED.assistant_id,
         payload = EXCLUDED.payload`,
      [
        memoryId,
        this.vectorLiteral(point.embedding),
        String(assistantId),
        JSON.stringify(point.payload),
      ],
    );
  }

  async deleteWorkspaceSource(sourceId: string): Promise<void> {
    await this.dataSource.query('DELETE FROM rag_chunks WHERE source_id = $1', [
      sourceId,
    ]);
  }

  async deleteWorkspaceSources(sourceIds: string[]): Promise<void> {
    if (!sourceIds.length) return;
    await this.dataSource.query(
      'DELETE FROM rag_chunks WHERE source_id = ANY($1::text[])',
      [sourceIds],
    );
  }

  async deleteIndexedFile(indexedFileId: number): Promise<void> {
    await this.dataSource.query(
      'DELETE FROM indexed_file_chunks WHERE indexed_file_id = $1',
      [indexedFileId],
    );
  }

  async workspaceCandidates(
    projectId?: number,
    limit = MAX_CANDIDATES,
  ): Promise<VectorCandidate[]> {
    const safeLimit = this.safeLimit(limit);
    const rows = await this.dataSource.query(
      `SELECT id, embedding::text AS embedding, payload
       FROM rag_chunks
       WHERE source_type IN ('resource', 'doc', 'knowledge')
         AND ($1::text IS NULL OR project_id = $1)
       ORDER BY id
       LIMIT $2`,
      [projectId == null ? null : String(projectId), safeLimit],
    );
    return rows.map((row) => this.rowToCandidate(row));
  }

  async indexedFileCandidates(
    ownerTag: string,
    limit = MAX_CANDIDATES,
  ): Promise<VectorCandidate[]> {
    const rows = await this.dataSource.query(
      `SELECT id, embedding::text AS embedding, payload
       FROM indexed_file_chunks
       WHERE owner_tag = $1
       ORDER BY id
       LIMIT $2`,
      [ownerTag, this.safeLimit(limit)],
    );
    return rows.map((row) => this.rowToCandidate(row));
  }

  async memoryCandidates(
    assistantId: number,
    limit = MAX_CANDIDATES,
  ): Promise<VectorCandidate[]> {
    const rows = await this.dataSource.query(
      `SELECT memory_id::text AS id, embedding::text AS embedding, payload
       FROM memory_vectors
       WHERE assistant_id = $1
       ORDER BY memory_id
       LIMIT $2`,
      [String(assistantId), this.safeLimit(limit)],
    );
    return rows.map((row) => this.rowToCandidate(row));
  }

  vectorCandidatesArtifact(candidates: VectorCandidate[]): {
    role: string;
    kind: string;
    mediaType: string;
    body: Buffer;
  } {
    return {
      role: 'vector_candidates',
      kind: 'vector_candidates',
      mediaType: 'application/json',
      body: Buffer.from(JSON.stringify({ candidates }), 'utf8'),
    };
  }

  private rowToCandidate(row: Record<string, unknown>): VectorCandidate {
    const embedding = this.parseVector(row.embedding);
    const payload =
      row.payload && typeof row.payload === 'object'
        ? (row.payload as Record<string, unknown>)
        : {};
    return this.validatePoint({ id: String(row.id), embedding, payload });
  }

  private validatePoint(point: VectorPointInput): VectorPointInput {
    if (!point || typeof point !== 'object' || !point.id?.trim()) {
      throw new Error('Vector point requires an id');
    }
    if (
      !Array.isArray(point.embedding) ||
      point.embedding.length !== EMBEDDING_DIMENSIONS ||
      point.embedding.some((value) => !Number.isFinite(value))
    ) {
      throw new Error(
        `Vector embedding must contain ${EMBEDDING_DIMENSIONS} finite values`,
      );
    }
    if (!point.payload || typeof point.payload !== 'object') {
      throw new Error('Vector point requires an object payload');
    }
    return {
      id: point.id.trim().slice(0, 500),
      embedding: point.embedding.map(Number),
      payload: point.payload,
    };
  }

  private parseVector(value: unknown): number[] {
    if (Array.isArray(value)) return value.map(Number);
    if (typeof value !== 'string') return [];
    const trimmed = value.trim();
    if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return [];
    if (trimmed === '[]') return [];
    return trimmed.slice(1, -1).split(',').map(Number);
  }

  private vectorLiteral(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }

  private safeLimit(limit: number): number {
    if (!Number.isFinite(limit)) return MAX_CANDIDATES;
    return Math.max(1, Math.min(Math.trunc(limit), MAX_CANDIDATES));
  }
}
