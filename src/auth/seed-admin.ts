import { config } from 'dotenv';
import { resolve } from 'path';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';

config({ path: resolve(__dirname, '..', '..', '..', '.env') });

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

  const username = process.env.ADMIN_USERNAME ?? 'admin';
  const password = process.env.ADMIN_PASSWORD ?? 'admin';

  // Check if admin already exists
  const existing = await dataSource.query(
    `SELECT id FROM users WHERE username = $1`,
    [username],
  );

  if (existing.length > 0) {
    console.log(`Admin user "${username}" already exists (id: ${existing[0].id})`);
    await dataSource.destroy();
    return;
  }

  const hash = await bcrypt.hash(password, 10);

  await dataSource.query(
    `INSERT INTO users (username, password_hash, display_name, role, permissions, active)
     VALUES ($1, $2, $3, 'admin', '{}', true)`,
    [username, hash, 'Administrator'],
  );

  console.log(`Admin user "${username}" created successfully`);
  await dataSource.destroy();
}

seedAdmin().catch((err) => {
  console.error('Failed to seed admin:', err);
  process.exit(1);
});
