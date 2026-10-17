// Height and bulk district strings (DataSF h9wh-cg3m `height`), e.g. `40//65-R-4`.
// Spec: docs/superpowers/specs/2026-10-16-scenario-data-design.md §4.2. Pure: no I/O.
import { MAX_STORIES } from '../../src/lib/generator/constants';

export type HeightDistrict =
  | { kind: 'none' }
  | { kind: 'height'; baseFt: number; lpFt: number | null; r4: boolean; normalised: string };

export class HeightParseError extends Error {
  constructor(
    message: string,
    readonly input: string
  ) {
    super(`${message}: ${JSON.stringify(input)}`);
    this.name = 'HeightParseError';
  }
}

/**
 * Step 1: trim, collapse whitespace runs to one space, rewrite a trailing `-?R-?4` as `-R-4`.
 * Source: spec §4.2 step 1 (tier 0 string hygiene; the live `120/400//120/650-R4` needs it).
 * Used for `none` strings too, so district tables hold normalised strings.
 */
export function normaliseHeight(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/-?R-?4$/, '-R-4');
}

/** Step 4: the largest token matching `^\d{2,4}$` after splitting on `[-/ ]`, or null. */
function maxHeightToken(side: string): number | null {
  let max: number | null = null;
  for (const tok of side.split(/[-/ ]/)) {
    if (!/^\d{2,4}$/.test(tok)) continue;
    const n = Number(tok);
    if (max === null || n > max) max = n;
  }
  return max;
}

/**
 * Parse one height/bulk string (spec §4.2, tier 0: derived from the published string; max of a
 * multi-number form is the permitted ceiling, verified against `gen_hght` for all 260 live
 * non-sentinel strings).
 *
 * - No 2-4 digit token: `none` (the nine live sentinels: OS, CP, HP, HP-RA, MB-RA, Special Height
 *   District, None Stated, USCG/Caltrans, Job Corps).
 * - Split on `//`: left is base, right is Local Program. More than one `//`, or a `//` with an
 *   empty side, throws `HeightParseError`.
 * - `r4` = normalised string ends `-R-4`. Only R-4 `//` strings are Local Program; the four live
 *   non-R-4 `//` strings keep `r4: false` and carry their right side in `lpFt` for reporting.
 * - An R-4 string with no `//` has `lpFt = baseFt`.
 */
export function parseHeightDistrict(s: string): HeightDistrict {
  const normalised = normaliseHeight(s);
  if (maxHeightToken(normalised) === null) return { kind: 'none' };
  const sides = normalised.split('//');
  if (sides.length > 2) throw new HeightParseError('more than one // in height string', s);
  const r4 = normalised.endsWith('-R-4');
  const baseFt = maxHeightToken(sides[0]);
  if (sides.length === 2) {
    const lpFt = maxHeightToken(sides[1]);
    if (baseFt === null || lpFt === null) {
      throw new HeightParseError('// with no height on one side', s);
    }
    return { kind: 'height', baseFt, lpFt, r4, normalised };
  }
  // No `//`: the single side is the base, and sentinel check above guarantees a token.
  if (baseFt === null) throw new HeightParseError('no height token', s);
  return { kind: 'height', baseFt, lpFt: r4 ? baseFt : null, r4, normalised };
}

/**
 * Tier 3 (orchestrator): ten feet per storey, clamped at the generator's `MAX_STORIES` (80).
 * Floor overshoot against the height limit (up to about 5% on towers) is accepted (spec §4.2).
 */
export function storiesFromFt(ft: number): number {
  return Math.min(MAX_STORIES, Math.floor(ft / 10));
}
