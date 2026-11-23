// See https://svelte.dev/docs/kit/types#app.d.ts
import type { User } from '$lib/server/user-store/user';

declare global {
  /** The tree's dataset version, defined at build time by datasetVersionPlugin (scripts/lib). */
  const __SFH_DATASET_VERSION__: string;
  namespace App {
    interface Error {
      message: string;
      reference?: string;
    }
    interface Locals {
      user: User | null;
      // `userId` is the LIVE Better-Auth `user.id` (FK target of account/passkey),
      // NOT the stable identity id on `user`.
      session: { id: string; userId: string } | null;
    }
    interface PageState {
      /** Remix hand-off from /p/:id to / (plan-sharing ruling 7). `plan` (serialized) only
       *  when the localStorage write failed. Cleared by / after the toast. */
      sfhRemix?: { from: string; plan?: string };
      /** Remix hand-off from /s/:id to /sim (plan 5). `doc` (serialized) only when the
       *  localStorage write failed. Cleared by /sim after the toast. */
      sfhSimRemix?: { from: string; doc?: string; upgradedFrom?: number };
    }
    interface Platform {
      env: Env;
      ctx: ExecutionContext;
      caches: CacheStorage;
      cf?: IncomingRequestCfProperties;
    }
  }
}
export {};
