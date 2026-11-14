// Test support: a fast `toEqual` for typed arrays. Browser-safe.
import { expect } from 'vitest';

/**
 * Two typed arrays of one kind are equal when their elements are, each by `Object.is` (so NaN
 * equals NaN and 0 differs from -0), which is what `toEqual` asks of them. The generic walk does
 * the same element by element through its whole matcher machinery, which on a city's packed cells
 * (hundreds of cells of geometry arrays) costs hundreds of ms per comparison; this loop costs a few.
 * Any other pair of values is left to the default equality (undefined).
 */
function typedArrayEquality(a: unknown, b: unknown): boolean | undefined {
  if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b)) return undefined;
  if (a instanceof DataView || b instanceof DataView) return undefined;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  const x = a as unknown as ArrayLike<number | bigint>;
  const y = b as unknown as ArrayLike<number | bigint>;
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) return false;
  return true;
}

/** Registers the tester for the calling spec file. */
export function useFastTypedArrayEquality(): void {
  expect.addEqualityTesters([typedArrayEquality]);
}
