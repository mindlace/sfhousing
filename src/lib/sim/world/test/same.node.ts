// Node only: `node:util`. A fast deep equality for big worlds and event lists.
import { isDeepStrictEqual } from 'node:util';
import { expect } from 'vitest';

/**
 * Passes exactly when `expect(a, message).toEqual(b)` would: Node's native deep comparison first
 * (strict, so a pass there is a pass of `toEqual`), and `toEqual` itself, with its diff, only when
 * that fails. `toEqual` walks a world's typed columns one element at a time through the matcher,
 * which is most of a whole-city comparison's time.
 */
export function expectEqual(a: unknown, b: unknown, message?: string): void {
  if (isDeepStrictEqual(a, b)) expect(true, message).toBe(true);
  else expect(a, message).toEqual(b);
}
