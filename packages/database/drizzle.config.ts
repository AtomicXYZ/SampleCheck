import { defineConfig } from 'drizzle-kit';

// SQL generation is offline. Applying migrations uses src/migrate.ts.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
});
