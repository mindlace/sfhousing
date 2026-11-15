import type { SimObject } from './sim-object';

/** The sim's object, or null where the binding is absent (vite dev, decision 3). */
export function simStub(env: unknown, simId: string): DurableObjectStub<SimObject> | null {
  const ns = (env as { SIM?: DurableObjectNamespace<SimObject> } | undefined)?.SIM;
  return ns ? ns.getByName(simId) : null;
}
