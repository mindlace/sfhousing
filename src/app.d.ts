// See https://svelte.dev/docs/kit/types#app.d.ts
import type { User } from '$lib/server/user-store/user';

declare global {
  /** The tree's dataset version, defined at build time by datasetVersionPlugin (scripts/lib). */
  const __SFH_DATASET_VERSION__: string;
  namespace App {
    interface Error {
      message: string;
    }
    interface Locals {
      user: User | null;
      // `userId` is the LIVE Better-Auth `user.id` (FK target of account/passkey),
      // NOT the stable identity id on `user`.
      session: { id: string; userId: string } | null;
    }
    // No page sets history state; SimRoute passes the current one through replaceState.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface PageState {}
    interface Platform {
      env: Env;
      ctx: ExecutionContext;
      caches: CacheStorage;
      cf?: IncomingRequestCfProperties;
    }
  }
}
export {};
