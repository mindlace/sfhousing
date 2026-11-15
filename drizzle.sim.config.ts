import { defineConfig } from 'drizzle-kit';

// The sim object's own SQLite: one database per sim (R21, R22). APPEND-ONLY: every object
// applies this history on open, so never delete migrations/sim and regenerate it. Generate with
// `npm run db:generate:sim` only.
export default defineConfig({
  schema: './src/lib/server/sim-object/schema.ts',
  dialect: 'sqlite',
  out: './migrations/sim',
  verbose: true,
  strict: true
});
