import { Injectable } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';

const GRAPH_NAME = 'documents';

export interface GraphEntity {
  id: number | string;
  name: string;
  type: string;
}

export interface GraphRelationship {
  source: number | string;
  target: number | string;
  predicate: string;
  confidence: number;
  resource_id?: number;
}

export interface RelationshipGraph {
  entities: GraphEntity[];
  relationships: GraphRelationship[];
}

export interface RelationshipEntityInput {
  id: number;
  name: string;
  type: string;
}

export interface ExtractedRelationshipInput {
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  context?: string;
}

@Injectable()
export class AgeGraphService {
  constructor(private readonly dataSource: DataSource) {}

  async queryAll(limit = 500): Promise<RelationshipGraph> {
    return this.queryTriples('MATCH (s:Entity)-[r:REL]->(o:Entity)', {}, limit);
  }

  async queryByResource(
    resourceId: number,
    limit = 100,
  ): Promise<RelationshipGraph> {
    return this.queryTriples(
      'MATCH (s:Entity)-[r:REL {resource_id: $resource_id}]->(o:Entity)',
      { resource_id: resourceId },
      limit,
    );
  }

  async queryByProject(
    projectId: number,
    resourceIds?: number[],
    limit = 200,
  ): Promise<RelationshipGraph> {
    const resourceFilter = resourceIds?.length
      ? ' AND r.resource_id IN $resource_ids'
      : '';
    return this.queryTriples(
      `MATCH (s:Entity)-[r:REL]->(o:Entity) WHERE r.project_id = $project_id${resourceFilter}`,
      {
        project_id: projectId,
        ...(resourceIds?.length ? { resource_ids: resourceIds } : {}),
      },
      limit,
    );
  }

  async queryNeighborhood(
    entityNames: string[],
    projectId?: number,
    depth = 2,
    limit = 50,
  ): Promise<RelationshipGraph> {
    if (!entityNames.length) return { entities: [], relationships: [] };
    const safeDepth = Math.max(1, Math.min(Math.trunc(depth), 5));
    const safeLimit = this.safeLimit(limit, 50);
    const runner = await this.connect();
    try {
      const relationshipPattern =
        projectId == null
          ? `:REL*1..${safeDepth}`
          : `:REL*1..${safeDepth} {project_id: $project_id}`;
      const rows = await this.cypher(
        runner,
        `MATCH p = (seed:Entity)-[${relationshipPattern}]-(other:Entity) ` +
          'WHERE seed.name IN $names ' +
          'UNWIND relationships(p) AS r ' +
          'WITH startNode(r) AS s, r, endNode(r) AS o ' +
          'RETURN DISTINCT s.name AS source, r.predicate AS predicate, ' +
          `o.name AS target, r.confidence AS confidence LIMIT ${safeLimit}`,
        {
          names: entityNames,
          ...(projectId == null ? {} : { project_id: projectId }),
        },
        'source agtype, predicate agtype, target agtype, confidence agtype',
      );
      const entities = new Map<string, GraphEntity>();
      const relationships = rows.map((row) => {
        const source = String(this.ageValue(row.source));
        const target = String(this.ageValue(row.target));
        entities.set(source, { id: source, name: source, type: '' });
        entities.set(target, { id: target, name: target, type: '' });
        return {
          source,
          target,
          predicate: String(this.ageValue(row.predicate)),
          confidence: Number(this.ageValue(row.confidence) ?? 1),
        };
      });
      return { entities: [...entities.values()], relationships };
    } finally {
      await runner.release();
    }
  }

  async queryNeighborhoodForText(
    text: string,
    projectId?: number,
  ): Promise<RelationshipGraph> {
    const normalized = text.trim().toLocaleLowerCase();
    if (!normalized) return { entities: [], relationships: [] };
    const runner = await this.connect();
    let names: string[];
    try {
      const rows = await this.cypher(
        runner,
        'MATCH (e:Entity) RETURN DISTINCT e.name AS name ORDER BY e.name LIMIT 1000',
        {},
        'name agtype',
      );
      names = rows
        .map((row) => String(this.ageValue(row.name) ?? '').trim())
        .filter((name) => name.length >= 2)
        .filter((name) => normalized.includes(name.toLocaleLowerCase()))
        .slice(0, 20);
    } finally {
      await runner.release();
    }
    return this.queryNeighborhood(names, projectId);
  }

  async createRelationship(
    subject: RelationshipEntityInput,
    predicate: string,
    object: RelationshipEntityInput,
    resourceId: number,
    projectId?: number,
  ): Promise<void> {
    await this.write(async (runner) => {
      await this.upsertEntity(runner, subject);
      await this.upsertEntity(runner, object);
      await this.upsertRelationship(
        runner,
        subject.id,
        predicate,
        object.id,
        resourceId,
        projectId,
        1,
        '',
      );
    });
  }

  async updateRelationship(
    subjectId: number,
    predicate: string,
    objectId: number,
    newPredicate: string,
    resourceId: number,
  ): Promise<void> {
    await this.write((runner) =>
      this.exec(
        runner,
        'MATCH (s:Entity {entity_id: $subject_id})' +
          '-[r:REL {predicate: $predicate, resource_id: $resource_id}]->' +
          '(o:Entity {entity_id: $object_id}) SET r.predicate = $new_predicate',
        {
          subject_id: subjectId,
          predicate,
          object_id: objectId,
          new_predicate: newPredicate,
          resource_id: resourceId,
        },
      ),
    );
  }

  async deleteRelationship(
    subjectId: number,
    predicate: string,
    objectId: number,
    resourceId: number,
  ): Promise<void> {
    await this.write((runner) =>
      this.exec(
        runner,
        'MATCH (s:Entity {entity_id: $subject_id})' +
          '-[r:REL {predicate: $predicate, resource_id: $resource_id}]->' +
          '(o:Entity {entity_id: $object_id}) DELETE r',
        {
          subject_id: subjectId,
          predicate,
          object_id: objectId,
          resource_id: resourceId,
        },
      ),
    );
  }

  async deleteByResource(resourceId: number): Promise<void> {
    await this.write((runner) =>
      this.exec(
        runner,
        'MATCH ()-[r:REL {resource_id: $resource_id}]->() DELETE r',
        { resource_id: resourceId },
      ),
    );
  }

  async replaceExtractedRelationships(
    resourceId: number,
    projectId: number | null,
    entityInputs: RelationshipEntityInput[],
    relationships: ExtractedRelationshipInput[],
  ): Promise<void> {
    const entities = new Map(
      entityInputs.map((entity) => [entity.name, entity] as const),
    );
    await this.write(async (runner) => {
      await this.exec(
        runner,
        'MATCH ()-[r:REL {resource_id: $resource_id}]->() DELETE r',
        { resource_id: resourceId },
      );
      const referencedNames = new Set(
        relationships.flatMap((relationship) => [
          relationship.subject,
          relationship.object,
        ]),
      );
      for (const name of referencedNames) {
        const entity = entities.get(name);
        if (!entity) {
          throw new Error(`Unknown relationship entity: ${name}`);
        }
        await this.upsertEntity(runner, entity);
      }
      for (const relationship of relationships) {
        const subject = entities.get(relationship.subject);
        const object = entities.get(relationship.object);
        if (!subject || !object) {
          throw new Error(
            'Relationship endpoints must reference known entities',
          );
        }
        await this.upsertRelationship(
          runner,
          subject.id,
          relationship.predicate,
          object.id,
          resourceId,
          projectId,
          relationship.confidence,
          relationship.context ?? '',
        );
      }
    });
  }

  private async queryTriples(
    match: string,
    params: Record<string, unknown>,
    limit: number,
  ): Promise<RelationshipGraph> {
    const safeLimit = this.safeLimit(limit, 200);
    const runner = await this.connect();
    try {
      const rows = await this.cypher(
        runner,
        `${match} RETURN s.entity_id AS source_id, s.name AS source_name, ` +
          's.entity_type AS source_type, r.predicate AS predicate, ' +
          'r.confidence AS confidence, r.resource_id AS resource_id, ' +
          'o.entity_id AS target_id, o.name AS target_name, ' +
          `o.entity_type AS target_type LIMIT ${safeLimit}`,
        params,
        'source_id agtype, source_name agtype, source_type agtype, ' +
          'predicate agtype, confidence agtype, resource_id agtype, ' +
          'target_id agtype, target_name agtype, target_type agtype',
      );
      const entities = new Map<number | string, GraphEntity>();
      const relationships: GraphRelationship[] = [];
      for (const row of rows) {
        const source = this.ageValue(row.source_id) as number | string;
        const target = this.ageValue(row.target_id) as number | string;
        entities.set(source, {
          id: source,
          name: String(this.ageValue(row.source_name)),
          type: String(this.ageValue(row.source_type) ?? ''),
        });
        entities.set(target, {
          id: target,
          name: String(this.ageValue(row.target_name)),
          type: String(this.ageValue(row.target_type) ?? ''),
        });
        relationships.push({
          source,
          target,
          predicate: String(this.ageValue(row.predicate)),
          confidence: Number(this.ageValue(row.confidence) ?? 1),
          resource_id: Number(this.ageValue(row.resource_id)),
        });
      }
      return { entities: [...entities.values()], relationships };
    } finally {
      await runner.release();
    }
  }

  private async upsertEntity(
    runner: QueryRunner,
    entity: RelationshipEntityInput,
  ): Promise<void> {
    await this.exec(
      runner,
      'MERGE (e:Entity {entity_id: $entity_id}) ' +
        'SET e.name = $name, e.entity_type = $entity_type ' +
        'REMOVE e.project_id, e.resource_id',
      {
        entity_id: entity.id,
        name: entity.name,
        entity_type: entity.type,
      },
    );
  }

  private async upsertRelationship(
    runner: QueryRunner,
    subjectId: number,
    predicate: string,
    objectId: number,
    resourceId: number,
    projectId: number | null | undefined,
    confidence: number,
    context: string,
  ): Promise<void> {
    await this.exec(
      runner,
      'MATCH (s:Entity {entity_id: $subject_id}) ' +
        'MATCH (o:Entity {entity_id: $object_id}) ' +
        'MERGE (s)-[r:REL {predicate: $predicate, resource_id: $resource_id}]->(o) ' +
        'SET r.project_id = $project_id, r.confidence = $confidence, r.context = $context',
      {
        subject_id: subjectId,
        predicate,
        object_id: objectId,
        resource_id: resourceId,
        project_id: projectId ?? null,
        confidence,
        context,
      },
    );
  }

  private async write(
    work: (runner: QueryRunner) => Promise<void>,
  ): Promise<void> {
    const runner = await this.connect();
    await runner.startTransaction();
    try {
      await work(runner);
      await runner.commitTransaction();
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }

  private async connect(): Promise<QueryRunner> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      await runner.query("LOAD 'age'");
      await runner.query('SET search_path = ag_catalog, "$user", public');
      return runner;
    } catch (error) {
      await runner.release();
      throw error;
    }
  }

  private async exec(
    runner: QueryRunner,
    body: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    await this.cypher(runner, `${body} RETURN 1`, params, 'ok agtype');
  }

  private cypher(
    runner: QueryRunner,
    body: string,
    params: Record<string, unknown>,
    columns: string,
  ): Promise<Record<string, unknown>[]> {
    const query =
      `SELECT * FROM ag_catalog.cypher('${GRAPH_NAME}', ` +
      `$$ ${body} $$, $1::ag_catalog.agtype) AS (${columns})`;
    return runner.query(query, [JSON.stringify(params)]);
  }

  private ageValue(value: unknown): unknown {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  private safeLimit(value: number, fallback: number): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(1, Math.min(Math.trunc(value), 1_000));
  }
}
