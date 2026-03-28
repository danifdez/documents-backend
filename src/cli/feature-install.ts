import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { resolve } from 'path';
import * as fs from 'fs';
import { FEATURE_DIR_MAP, getFeatureSqlPath } from '../common/feature-installer.service';

config({ path: resolve(__dirname, '..', '..', '.env') });

function readFeatureFlags(): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const flag of Object.keys(FEATURE_DIR_MAP)) {
    const envKey = `FEATURE_${flag.toUpperCase()}`;
    result[flag] = process.env[envKey] !== 'false';
  }
  return result;
}

async function run() {
  const flags = readFeatureFlags();
  const enabled = Object.entries(flags).filter(([, v]) => v);

  if (enabled.length === 0) {
    console.log('No features enabled.');
    return;
  }

  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    username: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || '',
    database: process.env.POSTGRES_DB || 'documents',
  });

  await dataSource.initialize();

  try {
    for (const [flag] of enabled) {
      const sqlPath = getFeatureSqlPath(flag, 'install');
      if (!sqlPath) continue;

      try {
        const sql = fs.readFileSync(sqlPath, 'utf-8');
        await dataSource.query(sql);
        console.log(`[OK]  Feature '${flag}' installed`);
      } catch (error) {
        console.error(`[ERR] Failed to install feature '${flag}':`, error.message);
      }
    }
  } finally {
    await dataSource.destroy();
  }
}

run();
