import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { resolve } from 'path';
import * as fs from 'fs';
import { getFeatureSqlPath, getAvailableFeatures } from '../common/feature-installer.service';

config({ path: resolve(__dirname, '..', '..', '.env') });

const featureName = process.argv[2];

if (!featureName) {
  console.error('Usage: npm run feature:uninstall -- <feature-name>');
  console.error(`Available features: ${getAvailableFeatures().join(', ')}`);
  process.exit(1);
}

async function run() {
  const sqlPath = getFeatureSqlPath(featureName, 'uninstall');

  if (!sqlPath) {
    console.error(`No uninstall.sql found for feature '${featureName}'.`);
    console.error(`Available: ${getAvailableFeatures().join(', ')}`);
    process.exit(1);
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
    const sql = fs.readFileSync(sqlPath, 'utf-8');
    await dataSource.query(sql);
    console.log(`[OK]  Feature '${featureName}' uninstalled (tables and data removed)`);
  } catch (error) {
    console.error(`[ERR] Failed to uninstall feature '${featureName}':`, error.message);
    process.exit(1);
  } finally {
    await dataSource.destroy();
  }
}

run();
