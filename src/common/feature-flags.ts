import { config } from 'dotenv';
import { resolve } from 'path';

export const FEATURE_FLAGS = [
  'entities',
  'authors',
  'canvas',
  'datasets',
  'notes',
  'calendar',
  'timelines',
  'knowledge_base',
  'bibliography',
  'tasks',
  'rag',
  'relationships',
] as const;

export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

export type FeatureMap = Record<FeatureFlag, boolean>;

/**
 * Reads feature flags directly from process.env (after loading .env via dotenv).
 * Used at module-construction time when ConfigService is not yet available.
 */
export function readFeaturesFromEnv(): FeatureMap {
  config({ path: resolve(__dirname, '..', '..', '.env') });

  const result = {} as FeatureMap;
  for (const flag of FEATURE_FLAGS) {
    const envKey = `FEATURE_${flag.toUpperCase()}`;
    result[flag] = process.env[envKey] !== 'false';
  }
  return result;
}
