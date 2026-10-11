import { defineConfig } from 'drizzle-kit';

// No @types/node in this repo (tsconfig types are worker-only), so read env via globalThis.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
const databaseUrl =
  env?.DATABASE_URL || 'file:./.wrangler/state/v3/d1/miniflare-D1DatabaseObject/local.sqlite';

export default defineConfig({
  schema: './src/lib/server/db/schema/index.ts',
  dialect: 'sqlite',
  dbCredentials: { url: databaseUrl },
  verbose: true,
  strict: true,
  out: './migrations/d1'
});
