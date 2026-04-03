import * as fs from 'fs';
import * as path from 'path';

/**
 * Map of feature flags to their directory names under features/.
 * Features without a directory (e.g. 'rag', 'relationships') don't need SQL setup.
 */
export const FEATURE_DIR_MAP: Record<string, string> = {
  entities: 'entities',
  authors: 'authors',
  canvas: 'canvas',
  datasets: 'datasets',
  data_sources: 'data-sources',
  notes: 'notes',
  calendar: 'calendar',
  timelines: 'timelines',
  knowledge_base: 'knowledge_base',
  bibliography: 'bibliography',
  tasks: 'tasks',
};

export function getFeaturesDir(): string {
  return path.resolve(__dirname, '..', '..', 'features');
}

export function getFeatureSqlPath(featureName: string, type: 'install' | 'uninstall'): string | null {
  const dir = Object.entries(FEATURE_DIR_MAP).find(
    ([flag, d]) => d === featureName || flag === featureName,
  );
  if (!dir) return null;

  const sqlPath = path.join(getFeaturesDir(), dir[1], `${type}.sql`);
  return fs.existsSync(sqlPath) ? sqlPath : null;
}

export function getAvailableFeatures(): string[] {
  return Object.values(FEATURE_DIR_MAP);
}
