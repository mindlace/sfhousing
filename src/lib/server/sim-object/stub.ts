import type { SimObject } from './sim-object';

/**
 * The part of the Worker's env that reaches a sim's object: the request's `platform?.env`.
 * Narrow on purpose, so passing `platform` where `platform.env` is meant does not compile.
 */
export type SimEnv = Pick<Env, 'SIM'> | undefined;

/** The sim's object, or null where the binding is absent (vite dev, decision 3). */
export function simStub(env: SimEnv, simId: string): DurableObjectStub<SimObject> | null {
  const ns = env?.SIM as DurableObjectNamespace<SimObject> | undefined;
  return ns ? ns.getByName(simId) : null;
}
