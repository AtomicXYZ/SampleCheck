import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { createDatabase } from './client.js';
import { getDatabaseUrl } from './env.js';

const { db, pool } = createDatabase(getDatabaseUrl());
try {
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
  });
  console.log('Database migrations applied.');
} finally {
  await pool.end();
}
