import { ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';
import { DEFAULT_PAGE_SIZE } from './constants';

export interface GlobalSearchConfig<T extends ObjectLiteral> {
  alias: string;
  select: string[];
  scoreColumn: string;
  searchColumns: string[];
  projectIdColumn?: string;
  applyProjectFilter?: (qb: SelectQueryBuilder<T>, projectId?: number) => void;
}

export async function globalSimilaritySearch<T extends ObjectLiteral>(
  repository: Repository<T>,
  searchTerm: string,
  projectId: number | undefined,
  config: GlobalSearchConfig<T>,
): Promise<any[]> {
  if (!searchTerm || !searchTerm.trim()) return [];
  const like = `%${searchTerm}%`;
  const where = config.searchColumns
    .map((col) => `unaccent(${col}) ILIKE unaccent(:q)`)
    .join(' OR ');
  const qb = repository
    .createQueryBuilder(config.alias)
    .select(config.select)
    .addSelect(
      `similarity(unaccent(${config.scoreColumn}), unaccent(:s))`,
      'score',
    )
    .where(where, { q: like })
    .setParameter('s', searchTerm);
  if (config.projectIdColumn && projectId) {
    qb.andWhere(`${config.projectIdColumn} = :projectId`, { projectId });
  }
  config.applyProjectFilter?.(qb, projectId);
  return await qb
    .orderBy('score', 'DESC')
    .limit(DEFAULT_PAGE_SIZE)
    .getRawMany();
}
