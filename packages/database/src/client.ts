import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 5_000 });
  return { db: drizzle(pool, { schema }), pool };
}
