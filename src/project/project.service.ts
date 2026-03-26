import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ProjectEntity } from './project.entity';

@Injectable()
export class ProjectService {
  constructor(
    @InjectRepository(ProjectEntity)
    private readonly repository: Repository<ProjectEntity>,
    private readonly dataSource: DataSource,
  ) { }

  async findOne(id: number): Promise<ProjectEntity | null> {
    return await this.repository.findOneBy({ id });
  }

  async create(project: Partial<ProjectEntity>): Promise<ProjectEntity> {
    const created = this.repository.create(project);
    return this.repository.save(created);
  }

  async findAll(): Promise<ProjectEntity[]> {
    return await this.repository.find({ order: { createdAt: 'DESC' } });
  }

  async search(query: string): Promise<ProjectEntity[]> {
    if (!query || !query.trim()) return this.findAll();
    const like = `%${query}%`;
    return await this.repository
      .createQueryBuilder('p')
      .where('p.name ILIKE :q OR p.description ILIKE :q', { q: like })
      .orderBy('similarity(p.name, :s)', 'DESC')
      .setParameter('s', query)
      .getMany();
  }

  async update(id: number, project: Partial<ProjectEntity>): Promise<ProjectEntity | null> {
    const existing = await this.repository.findOneBy({ id });
    if (!existing) return null;
    Object.assign(existing, project);
    const saved = await this.repository.save(existing);
    return saved;
  }

  async remove(id: number): Promise<void> {
    const p = await this.repository.findOneBy({ id });
    if (p) await this.repository.remove(p);
  }

  async getStats(id: number): Promise<Record<string, any>> {
    const qr = this.dataSource.createQueryRunner();

    // Counts
    const counts = await qr.query(`
      SELECT
        (SELECT COUNT(*) FROM resources WHERE "projectId" = $1) AS "resourceCount",
        (SELECT COUNT(*) FROM docs WHERE "projectId" = $1) AS "docCount",
        (SELECT COUNT(*) FROM notes WHERE "projectId" = $1) AS "noteCount",
        (SELECT COUNT(*) FROM datasets WHERE "projectId" = $1) AS "datasetCount",
        (SELECT COUNT(*) FROM bibliography_entries WHERE "projectId" = $1) AS "bibliographyCount",
        (SELECT COUNT(DISTINCT e.id) FROM entities e
          JOIN entity_projects ep ON ep."entityId" = e.id
          WHERE ep."projectId" = $1) AS "entityCount"
    `, [id]);

    // Languages from resources
    const languages = await qr.query(`
      SELECT DISTINCT language FROM resources
      WHERE "projectId" = $1 AND language IS NOT NULL
      ORDER BY language
    `, [id]);

    // Top keywords: aggregate JSON arrays from resources
    const keywordsRaw = await qr.query(`
      SELECT kw, COUNT(*)::int AS count
      FROM resources, jsonb_array_elements_text(keywords::jsonb) AS kw
      WHERE "projectId" = $1 AND keywords IS NOT NULL
      GROUP BY kw ORDER BY count DESC LIMIT 30
    `, [id]);

    // Top entities with type
    const topEntities = await qr.query(`
      SELECT e.name, et.name AS type, COUNT(re."resourceId")::int AS count
      FROM entities e
      JOIN entity_projects ep ON ep."entityId" = e.id
      JOIN entity_types et ON e."entityTypeId" = et.id
      LEFT JOIN resource_entities re ON re."entityId" = e.id
      WHERE ep."projectId" = $1
      GROUP BY e.id, e.name, et.name
      ORDER BY count DESC LIMIT 30
    `, [id]);

    // Top authors from resources
    const topAuthors = await qr.query(`
      SELECT a.name, COUNT(ra."resourceId")::int AS count
      FROM authors a
      JOIN resource_authors ra ON ra."authorId" = a.id
      JOIN resources r ON r.id = ra."resourceId"
      WHERE r."projectId" = $1
      GROUP BY a.id, a.name
      ORDER BY count DESC LIMIT 20
    `, [id]);

    // Bibliography by year
    const bibByYear = await qr.query(`
      SELECT year, COUNT(*)::int AS count
      FROM bibliography_entries
      WHERE "projectId" = $1 AND year IS NOT NULL
      GROUP BY year ORDER BY year
    `, [id]);

    // Bibliography by type
    const bibByType = await qr.query(`
      SELECT entry_type AS type, COUNT(*)::int AS count
      FROM bibliography_entries
      WHERE "projectId" = $1
      GROUP BY entry_type ORDER BY count DESC
    `, [id]);

    // Entity co-occurrence (entities appearing in the same resource)
    const cooccurrence = await qr.query(`
      SELECT e1.name AS source, e2.name AS target, COUNT(*)::int AS weight
      FROM resource_entities r1
      JOIN resource_entities r2 ON r1."resourceId" = r2."resourceId" AND r1."entityId" < r2."entityId"
      JOIN entities e1 ON e1.id = r1."entityId"
      JOIN entities e2 ON e2.id = r2."entityId"
      JOIN resources res ON res.id = r1."resourceId"
      WHERE res."projectId" = $1
      GROUP BY e1.name, e2.name
      ORDER BY weight DESC LIMIT 50
    `, [id]);

    // Key points from resources (sample)
    const keyPointsRaw = await qr.query(`
      SELECT r.name AS "resourceName", r.key_points AS "keyPoints"
      FROM resources r
      WHERE r."projectId" = $1 AND r.key_points IS NOT NULL
      LIMIT 10
    `, [id]);

    const keyPoints: { text: string; source: string }[] = [];
    for (const row of keyPointsRaw) {
      const points = typeof row.keyPoints === 'string' ? JSON.parse(row.keyPoints) : row.keyPoints;
      if (Array.isArray(points)) {
        for (const p of points.slice(0, 3)) {
          keyPoints.push({ text: p, source: row.resourceName });
        }
      }
    }

    // Timeline events
    const timelineEvents = await qr.query(`
      SELECT t.name, t.timeline_data AS "timelineData"
      FROM timelines t
      WHERE t."projectId" = $1 AND t.timeline_data IS NOT NULL
      LIMIT 5
    `, [id]);

    const events: { date: string; label: string; endDate?: string }[] = [];
    for (const tl of timelineEvents) {
      const data = typeof tl.timelineData === 'string' ? JSON.parse(tl.timelineData) : tl.timelineData;
      if (Array.isArray(data)) {
        for (const ev of data) {
          events.push({ date: ev.date, label: ev.title, endDate: ev.endDate || undefined });
        }
      }
    }

    await qr.release();

    return {
      ...counts[0],
      languages: languages.map((r: any) => r.language),
      topKeywords: keywordsRaw.map((r: any) => ({ word: r.kw, count: r.count })),
      topEntities: topEntities.map((r: any) => ({ name: r.name, type: r.type, count: r.count })),
      topAuthors: topAuthors.map((r: any) => ({ name: r.name, count: r.count })),
      bibliographyByYear: bibByYear.map((r: any) => ({ year: r.year, count: r.count })),
      bibliographyByType: bibByType.map((r: any) => ({ type: r.type, count: r.count })),
      entityCooccurrence: cooccurrence.map((r: any) => ({ source: r.source, target: r.target, weight: r.weight })),
      keyPoints: keyPoints.slice(0, 20),
      timelineEvents: events,
    };
  }
}
