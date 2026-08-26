import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

const EMBEDDING_DIMENSIONS = 384;
const MAX_CANDIDATES = 5_000;

export interface VectorPointInput {
  id: string;
  embedding: number[];
  payload: Record<string, unknown>;
}

export interface VectorReplacementObservation {
  pointCount: number;
  pointIds: string[];
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
    const validated = this.workspacePoints(
      sourceType,
      sourceId,
      projectId,
      points,
    );
    await this.dataSource.transaction((manager) =>
      this.replaceWorkspaceSourceWithManager(
        sourceType,
        sourceId,
        projectId,
        validated,
        manager,
      ),
    );
  }

  async replaceWorkspaceSourceVerified(
    sourceType: WorkspaceVectorSourceType,
    sourceId: string,
    projectId: number | null,
    points: VectorPointInput[],
    manager: EntityManager,
  ): Promise<VectorReplacementObservation> {
    const validated = this.workspacePoints(
      sourceType,
      sourceId,
      projectId,
      points,
    );
    await this.replaceWorkspaceSourceWithManager(
      sourceType,
      sourceId,
      projectId,
      validated,
      manager,
    );
    const [observation] = await manager.query(
      `WITH expected AS (
         SELECT value->>'id' AS id,
                (value->>'embedding')::vector::text AS embedding,
                $2::text AS source_type,
                $1::text AS source_id,
                $3::text AS project_id,
                value->'payload' AS payload
         FROM jsonb_array_elements($4::jsonb) AS item(value)
       ), actual AS (
         SELECT id, embedding::text AS embedding, source_type, source_id,
                project_id, payload
         FROM rag_chunks
         WHERE source_id = $1
       )
       SELECT (SELECT COUNT(*)::int FROM actual) AS point_count,
              NOT EXISTS (
                (SELECT * FROM actual EXCEPT SELECT * FROM expected)
                UNION ALL
                (SELECT * FROM expected EXCEPT SELECT * FROM actual)
              ) AS matches`,
      [
        sourceId,
        sourceType,
        projectId == null ? null : String(projectId),
        JSON.stringify(validated),
      ],
    );
    if (
      observation?.matches !== true ||
      Number(observation.point_count) !== validated.length
    ) {
      throw new Error('workspace_vector_effect_not_verified');
    }
    return {
      pointCount: validated.length,
      pointIds: validated.map((point) => point.id),
    };
  }

  private workspacePoints(
    sourceType: WorkspaceVectorSourceType,
    sourceId: string,
    projectId: number | null,
    points: VectorPointInput[],
  ): VectorPointInput[] {
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
    return validated;
  }

  private async replaceWorkspaceSourceWithManager(
    sourceType: WorkspaceVectorSourceType,
    sourceId: string,
    projectId: number | null,
    points: VectorPointInput[],
    manager: EntityManager,
  ): Promise<void> {
    await manager.query('DELETE FROM rag_chunks WHERE source_id = $1', [
      sourceId,
    ]);
    for (const point of points) {
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
  }

  async replaceIndexedFile(
    indexedFileId: number,
    ownerTag: string,
    points: VectorPointInput[],
  ): Promise<void> {
    const validated = this.indexedFilePoints(indexedFileId, ownerTag, points);
    await this.dataSource.transaction((manager) =>
      this.replaceIndexedFileWithManager(
        indexedFileId,
        ownerTag,
        validated,
        manager,
      ),
    );
  }

  async replaceIndexedFileVerified(
    indexedFileId: number,
    ownerTag: string,
    points: VectorPointInput[],
    manager: EntityManager,
  ): Promise<VectorReplacementObservation> {
    const validated = this.indexedFilePoints(indexedFileId, ownerTag, points);
    await this.replaceIndexedFileWithManager(
      indexedFileId,
      ownerTag,
      validated,
      manager,
    );
    const [observation] = await manager.query(
      `WITH expected AS (
         SELECT value->>'id' AS id,
                (value->>'embedding')::vector::text AS embedding,
                $2::text AS owner_tag,
                value->'payload' AS payload
         FROM jsonb_array_elements($3::jsonb) AS item(value)
       ), actual AS (
         SELECT id, embedding::text AS embedding, owner_tag, payload
         FROM indexed_file_chunks
         WHERE indexed_file_id = $1
       )
       SELECT (SELECT COUNT(*)::int FROM actual) AS point_count,
              NOT EXISTS (
                (SELECT * FROM actual EXCEPT SELECT * FROM expected)
                UNION ALL
                (SELECT * FROM expected EXCEPT SELECT * FROM actual)
              ) AS matches`,
      [indexedFileId, ownerTag, JSON.stringify(validated)],
    );
    if (
      observation?.matches !== true ||
      Number(observation.point_count) !== validated.length
    ) {
      throw new Error('indexed_file_vector_effect_not_verified');
    }
    return {
      pointCount: validated.length,
      pointIds: validated.map((point) => point.id),
    };
  }

  private indexedFilePoints(
    indexedFileId: number,
    ownerTag: string,
    points: VectorPointInput[],
  ): VectorPointInput[] {
    if (!Number.isInteger(indexedFileId) || indexedFileId <= 0) {
      throw new Error('Indexed file id is invalid');
    }
    if (!/^(assistant|agent):[1-9][0-9]*$/.test(ownerTag)) {
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
    return validated;
  }

  private async replaceIndexedFileWithManager(
    indexedFileId: number,
    ownerTag: string,
    points: VectorPointInput[],
    manager: EntityManager,
  ): Promise<void> {
    await manager.query(
      'DELETE FROM indexed_file_chunks WHERE indexed_file_id = $1',
      [indexedFileId],
    );
    for (const point of points) {
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
