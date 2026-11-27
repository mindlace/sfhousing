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
  /** Per height band, the median months from filed to issued (reported, not modelled). */
  filedToIssued: { upTo: number; median: number; n: number }[];
  /** The evidence for the anchors (the Controller's prototypes) and for the carrying cost. */
  provenance: { anchors: Provenance; carrying: Provenance };
}

const byId = (a: { id: string }, b: { id: string }): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * The shipped step from `asOf`: today's Controller anchors, the permit cost ratio above 24
 * stories and the height bands fitted on the completed stage spells entered from PLANNING_START
 * to `asOf` (the spells `calibrate` builds, on the same qualifying histories). The window is
 * the one the choice spread is fitted on (Planning records start in 2015; Task 8 confirmed it).
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
  const fit = fitHeightTime(spells, norm, a.cal, window, a.asOf);
  const heightTime = fit.model;
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
  const rateProv = MARKET_TERMS.constructionRate.provenance;
  const drawnProv = AVERAGE_DRAWN.provenance;
  const first = PROTOTYPES[0].provenance;
  const anchorsProv: Provenance = {
    tier: Math.max(...PROTOTYPES.map((p) => p.provenance.tier)) as Provenance['tier'],
    label: 'Controller feasibility prototypes A to E: stories, homes, cost and value per home',
    sources: first.sources,
    method:
      'Each anchor is a Controller prototype (src/lib/sim/finance/prototypes.ts): ' +
      PROTOTYPES.map(
        (p) =>
          `${p.id} ${p.stories} stories, ${p.homes} homes, cost ${p.costPerHome}, value ` +
          `${p.costPerHome - p.shortfallPerHome}`
      ).join('; ') +
      '. Value per home = cost − shortfall. ' +
      first.method
  };
  const carryingProv: Provenance = {
    tier: Math.max(rateProv.tier, drawnProv.tier) as Provenance['tier'],
    label:
      `Carrying cost: construction rate ${rate} (tier ${rateProv.tier}) on an average drawn ` +
      `share ${AVERAGE_DRAWN.value} (tier ${drawnProv.tier}, invented: the partner's assumption)`,
    sources: [...rateProv.sources, ...drawnProv.sources],
    method:
      "Interest on the months an option spends under construction beyond its anchor's band: " +
      'rate × drawn share × cost per home × extra months ÷ 12 (pricing.ts carryPerHome). ' +
      `Rate: ${rateProv.method} Drawn share: ${drawnProv.method}`
  };
  return {
    prices: {
      anchors,
      aboveTopCostRatio: aboveTop.ratio,
      carrying: { rate, drawn: AVERAGE_DRAWN.value }
    },
    heightTime,
    aboveTop,
    filedToIssued: fit.filedToIssued,
    provenance: { anchors: anchorsProv, carrying: carryingProv }
  };
}
