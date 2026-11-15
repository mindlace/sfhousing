import { dev } from '$app/environment';
import type { SimObject } from '$lib/server/sim-object/sim-object';
import { simStub, type SimEnv } from '$lib/server/sim-object/stub';

/**
 * The sim's object for a request handler: null under `npm run dev` (no object runs there)
 * and wherever the `SIM` binding is absent. Imports `$app/environment`, so nothing the
 * object's own bundle reaches (`src/lib/server/sim-object/`, `sim-roles.ts`) may import it.
 */
export function liveSimStub(env: SimEnv, simId: string): DurableObjectStub<SimObject> | null {
  if (dev) return null;
  return simStub(env, simId);
}
