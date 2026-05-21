import { defineConfig } from 'drizzle-kit';

const url = process.env['DATABASE_URL'] ?? 'postgres://openxiv:openxiv@localhost:5432/openxiv';

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
