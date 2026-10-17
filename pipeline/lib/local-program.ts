// Family Zoning Plan Local Program envelope in stories (spec §4.4). Pure: no I/O.
import { storiesFromFt, type HeightDistrict } from './heights';

/**
 * Large-lot rule: 8,000 sf in square metres (8000 * 0.09290304 = 743.22, spec rounds to 743.2).
 * Tier 1, Director Bulletin 11 citing Planning Code §206.10(d)(1)(C). The same rule covers corner
 * lots, which are deferred, so corner-lot parcels are understated.
 */
const LARGE_LOT_M2 = 743.2;
/** Large-lot floor for the Local Program height, ft. Tier 1, Bulletin 11 §206.10(d)(1)(C). */
const LARGE_LOT_FLOOR_FT = 65;

export type LocalProgramEnvelope = {
  baseStories: number;
  envelopeStories: number;
  localProgram: boolean;
  largeLot65: boolean;
};

/**
 * Envelope in stories for one parcel.
 *
 * - `baseStories = stories(baseFt)`; 0 for a `none` district (tier 3, `storiesFromFt`).
 * - `localProgram = r4 ∧ ¬excluded` (tier 2: the R-4 map is tier 0, exclusions are approximated
 *   from the roll, spec §4.4 table).
 * - For a Local Program parcel `lpFt' = max(baseFt, lpFt)` (lpFt null reads as baseFt), then
 *   `lotAreaM2 ≥ 743.2 ∧ lpFt' < 65` lifts it to 65 (`largeLot65`).
 * - `envelopeStories = localProgram ? stories(lpFt') : baseStories`.
 */
export function localProgramEnvelope(a: {
  district: HeightDistrict;
  lotAreaM2: number;
  excluded: boolean;
}): LocalProgramEnvelope {
  const { district } = a;
  if (district.kind === 'none') {
    return { baseStories: 0, envelopeStories: 0, localProgram: false, largeLot65: false };
  }
  const baseStories = storiesFromFt(district.baseFt);
  const localProgram = district.r4 && !a.excluded;
  if (!localProgram) {
    return { baseStories, envelopeStories: baseStories, localProgram: false, largeLot65: false };
  }
  let lpFt = Math.max(district.baseFt, district.lpFt ?? district.baseFt);
  let largeLot65 = false;
  if (a.lotAreaM2 >= LARGE_LOT_M2 && lpFt < LARGE_LOT_FLOOR_FT) {
    lpFt = LARGE_LOT_FLOOR_FT;
    largeLot65 = true;
  }
  return { baseStories, envelopeStories: storiesFromFt(lpFt), localProgram: true, largeLot65 };
}
