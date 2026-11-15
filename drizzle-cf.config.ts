import { defineTracks } from '@planafoot/drizzle-cf-migrations';
import type { CfMigrationsConfig } from '@planafoot/drizzle-cf-migrations';

export default {
  tracks: defineTracks({
    d1: { dir: 'migrations/d1', drizzleConfig: 'drizzle.config.ts', bundle: null },
    sim: {
      dir: 'migrations/sim',
      drizzleConfig: 'drizzle.sim.config.ts',
      bundle: {
        outFile: 'src/lib/server/sim-object/migrations.generated.ts',
        exportName: 'simMigrations'
      }
    }
  }),
  schemas: {
    d1: () => import('./src/lib/server/db/schema/index'),
    sim: () => import('./src/lib/server/sim-object/schema')
  },
  docsRef: 'docs/dev/developing.md'
} satisfies CfMigrationsConfig;
