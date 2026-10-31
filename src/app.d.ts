// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {
    interface PageState {
      /** Remix hand-off from /p/:id to / (plan-sharing ruling 7). `plan` (serialized) only
       *  when the localStorage write failed. Cleared by / after the toast. */
      sfhRemix?: { from: string; plan?: string };
      /** Remix hand-off from /s/:id to /sim (plan 5). `doc` (serialized) only when the
       *  localStorage write failed. Cleared by /sim after the toast. */
      sfhSimRemix?: { from: string; doc?: string };
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
