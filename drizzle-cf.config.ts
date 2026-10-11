import { defineTracks } from '@planafoot/drizzle-cf-migrations';
import type { CfMigrationsConfig } from '@planafoot/drizzle-cf-migrations';

export default {
  tracks: defineTracks({
    d1: { dir: 'migrations/d1', drizzleConfig: 'drizzle.config.ts', bundle: null }
  }),
  schemas: { d1: () => import('./src/lib/server/db/schema/index') },
  docsRef: 'docs/dev/developing.md'
} satisfies CfMigrationsConfig;
