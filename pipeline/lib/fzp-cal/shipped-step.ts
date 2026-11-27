/**
 * The one price step and the one height-time step the dataset ships (building-choice spec, "Costs
 * as dated steps"; preflight ruling F12): built once here, read by the options step's cost-pruned
 * report and by the calibration's `choice` and `heightTime` (Task 8), so both price on the same
 * step. Anchors are the Controller's prototypes (src/lib/sim/finance/prototypes.ts), value per
 * home = cost − shortfall; carrying is MARKET_TERMS.constructionRate on AVERAGE_DRAWN; the cost
 * ratio above 24 stories is fitted on permits (building-records.ts) and the height bands on the
 * stage spells (height-time.ts).
 */
import { PROTOTYPES } from '../../../src/lib/sim/finance/prototypes';
import { AVERAGE_DRAWN, MARKET_TERMS } from '../../../src/lib/sim/finance/terms';
import type { HeightTimeModel, PriceStep } from '../../../src/lib/sim/choice/types';
import type { Day, Provenance, ProjectHistory } from '../../../src/lib/timelapse/types';
import { isoToDay } from '../../project-records/multiphase';
import { aboveTopCostRatio } from '../building-records';
import { fitHeightTime } from './height-time';
import { purgeCensor } from './purge';
import { buildSpells, normalise, qualifies } from './spells';
import type { CalProfile, PermitRow } from './types';
import { PLANNING_START } from './window';

export interface ShippedStep {
  prices: PriceStep;
  heightTime: HeightTimeModel;
  /** The fitted cost ratio above the top anchor, with its permit counts and provenance. */
  aboveTop: { ratio: number; n: [number, number]; provenance: Provenance };
}

const byId = (a: { id: string }, b: { id: string }): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * The shipped step from `asOf`: today's Controller anchors, the permit cost ratio above 24
 * stories and the height bands fitted on the completed stage spells entered from PLANNING_START
 * to `asOf` (the spells `calibrate` builds, on the same qualifying histories).
 */
export function shippedStep(a: {
  histories: readonly ProjectHistory[];
  permits: readonly PermitRow[];
  asOf: Day;
  cal: CalProfile;
}): ShippedStep {
  const q = a.histories.filter(qualifies).sort(byId);
  const norm = purgeCensor(normalise(q, a.asOf).norm, a.cal).norm;
  const { spells } = buildSpells(norm, a.asOf);
  const window: [Day, Day] = [isoToDay(PLANNING_START), a.asOf];
  const heightTime = fitHeightTime(spells, norm, a.cal, window, a.asOf).model;
  const aboveTop = aboveTopCostRatio(a.permits);
  const anchors = Object.fromEntries(
    PROTOTYPES.map((p) => [
      p.id,
      {
        stories: p.stories,
        homes: p.homes,
        costPerHome: p.costPerHome,
        valuePerHome: p.costPerHome - p.shortfallPerHome
      }
    ])
  ) as PriceStep['anchors'];
  const rate = MARKET_TERMS.constructionRate.value;
  if (rate === null) throw new Error('shipped step: MARKET_TERMS.constructionRate has no value');
  return {
    prices: {
      anchors,
      aboveTopCostRatio: aboveTop.ratio,
      carrying: { rate, drawn: AVERAGE_DRAWN.value }
    },
    heightTime,
    aboveTop
  };
}
