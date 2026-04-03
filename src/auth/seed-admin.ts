import { config } from 'dotenv';
import { resolve } from 'path';
import { randomBytes } from 'crypto';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';

config({ path: resolve(__dirname, '..', '..', '..', '.env') });

const ALL_PERMISSIONS: Record<string, boolean> = {
  'ask': true,
  'summarize': true,
  'translate': true,
  'entity-extraction': true,
  'key-points': true,
  'keywords': true,
  'image-generate': true,
  'projects': true,
  'documents': true,
  'upload': true,
  'export': true,
  'write': true,
  'delete': true,
  'canvas': true,
  'datasets': true,
  'notes': true,
  'calendar': true,
  'timelines': true,
  'knowledge-base': true,
  'bibliography': true,
  'relationships': true,
  'tasks': true,
  'user-management': true,
};

async function seedAdmin() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    username: process.env.POSTGRES_USER ?? 'postgres',
    password: process.env.POSTGRES_PASSWORD ?? 'example',
    database: process.env.POSTGRES_DB ?? 'documents',
  });

  await dataSource.initialize();

  // Ensure Admin group exists
  let adminGroup = await dataSource.query(
    `SELECT id FROM permission_groups WHERE name = 'Admin'`,
  );

  let groupId: number;
  if (adminGroup.length === 0) {
    const result = await dataSource.query(
      `INSERT INTO permission_groups (name, description, permissions) VALUES ($1, $2, $3) RETURNING id`,
      ['Admin', 'Full access to all features', JSON.stringify(ALL_PERMISSIONS)],
    );
    groupId = result[0].id;
    console.log(`Admin group created (id: ${groupId})`);
  } else {
    groupId = adminGroup[0].id;
    // Update permissions to ensure they include all current permissions
    await dataSource.query(
      `UPDATE permission_groups SET permissions = $1 WHERE id = $2`,
      [JSON.stringify(ALL_PERMISSIONS), groupId],
    );
    console.log(`Admin group already exists (id: ${groupId}), permissions updated`);
  }

  const username = process.env.ADMIN_USERNAME ?? 'admin';

  let password = process.env.ADMIN_PASSWORD;
  let generated = false;
  if (!password) {
    password = randomBytes(24).toString('base64url');
    generated = true;
  }

  // Check if admin already exists
  const existing = await dataSource.query(
    `SELECT id FROM users WHERE username = $1`,
    [username],
  );

  if (existing.length > 0) {
    // Ensure existing admin is in the Admin group
    await dataSource.query(
      `UPDATE users SET group_id = $1, permissions = $2 WHERE id = $3`,
      [groupId, JSON.stringify(ALL_PERMISSIONS), existing[0].id],
    );
    console.log(`Admin user "${username}" already exists (id: ${existing[0].id}), assigned to Admin group`);
    await dataSource.destroy();
    return;
  }

  const hash = await bcrypt.hash(password, 10);

  await dataSource.query(
    `INSERT INTO users (username, password_hash, display_name, permissions, group_id, active)
     VALUES ($1, $2, $3, $4, $5, true)`,
    [username, hash, 'Administrator', JSON.stringify(ALL_PERMISSIONS), groupId],
  );

  console.log(`Admin user "${username}" created successfully`);
  if (generated) {
    console.log(`Generated password: ${password}`);
    console.log('Set ADMIN_PASSWORD env var to use a fixed password next time.');
  }
  await dataSource.destroy();
}

seedAdmin().catch((err) => {
  console.error('Failed to seed admin:', err);
  process.exit(1);
});
