import { createDatabase } from './client.js';
import { getDatabaseUrl } from './env.js';
import { seedDevelopmentData } from './seed-data.js';

if (process.env.NODE_ENV === 'production') {
  throw new Error('Development seed is disabled in production');
}
const { db, pool } = createDatabase(getDatabaseUrl());
try {
  await seedDevelopmentData(db);
  console.log('Development fixtures ready (IMPORTED, not published).');
} finally {
  await pool.end();
}
