import type { SimEnv } from '$lib/server/sim-object/stub';

/**
 * A stand-in for the request's `platform.env`, with only the binding the roster hook and the
 * takedown read. `getByName` returns the fake object for a sim; by default no object is reached.
 */
export function fakeSimEnv(
  getByName: (name: string) => unknown = () => {
    throw new Error('no sim object in this test');
  }
): NonNullable<SimEnv> {
  return { SIM: { getByName } as unknown as DurableObjectNamespace };
}
