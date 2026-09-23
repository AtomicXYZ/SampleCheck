import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

// Resolve from this file so CLI commands work regardless of the working directory.
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

export function getDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is required in production');
  }
  const url = new URL('postgresql://127.0.0.1');
  url.username = process.env.POSTGRES_USER ?? 'samplecheck';
  url.password = process.env.POSTGRES_PASSWORD ?? 'samplecheck_dev';
  url.port = process.env.POSTGRES_PORT ?? '5432';
  url.pathname = `/${encodeURIComponent(process.env.POSTGRES_DB ?? 'samplecheck')}`;
  return url.toString();
}
