// Hand-made timeline lookups for tests (spec §6 "Fixtures"). T12's `chanceTable` and
// `typicalMonths` are not implemented yet; these stand in for their outputs. Test values only.
import type { TimelineLookups } from '../timelapse/types';
import { PATHWAYS, STAGE_ORDER, pathwayStages } from '$lib/timelapse/types';

/** T12's chance table length in months. */
export const CHANCE_LEN = 241;

/**
 * A deterministic ramp: the chance starts higher for later stages and pathways and falls by
 * 0.0025 a month, floored at 0.05, so rows cross the bar ramp stops 0.15 / 0.45 / 0.75.
 */
export function chanceRampValue(pathwayIndex: number, stageIndex: number, month: number): number {
  return Math.max(0.05, 0.3 + 0.1 * stageIndex + 0.05 * pathwayIndex - 0.0025 * month);
}

function chance(): TimelineLookups['chance'] {
  const out: TimelineLookups['chance'] = { discretionary: {}, streamlined: {}, permitOnly: {} };
  PATHWAYS.forEach((p, pi) => {
    for (const stage of pathwayStages(p)) {
      if (stage === 'complete') continue;
      // The one absent occupiable row (spec §6). No fixture slot is streamlined with a PPA, so it
      // is never read (§4.4.3); permitOnly filed/entitled are absent too, as T2 makes them.
      if (p === 'streamlined' && stage === 'preApplication') continue;
      const si = STAGE_ORDER.indexOf(stage);
      out[p][stage] = Float32Array.from({ length: CHANCE_LEN }, (_, m) =>
        chanceRampValue(pi, si, m)
      );
    }
  });
  return out;
}

/** Median months per stage. `streamlined.permitFiled` is missing on purpose (spec §6). */
const TYPICAL_MONTHS: TimelineLookups['typicalMonths'] = {
  discretionary: {
    preApplication: 6,
    filed: 14,
    entitled: 5,
    permitFiled: 10,
    permitIssued: 4,
    construction: 24
  },
  streamlined: {
    preApplication: 4,
    filed: 6,
    entitled: 3,
    permitIssued: 4,
    construction: 22
  },
  permitOnly: { preApplication: 3, permitFiled: 8, permitIssued: 4, construction: 20 }
};

export const timelineLookups: TimelineLookups = {
  chance: chance(),
  typicalMonths: TYPICAL_MONTHS
};
