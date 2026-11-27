// A lot's building options: one per (type, form, stories) the generator can mass on it, and the
// cost-independent pruning the dataset bakes. Nothing baked here depends on a price; the priced
// helpers (pruneByCost, lotConstants) take a price step and are for reports and run time.
import type { ParcelRecord } from '../../data/parcel';
import { DISTRICT_MIN_M2 } from '../../generator/constants';
import { districtArea, mayBeDistrict } from '../../generator/district-layout';
import { generateForm } from '../../generator/forms';
import { physicalMaxStories } from '../../generator/physical';
import { normaliseSite } from '../../generator/site';
import { drawVariety } from '../../generator/variety';
import { bandOf, carryPerHome, costPerHome, valuePerHome } from './pricing';
import {
  BUILDING_FORMS,
  BUILDING_TYPES,
  TOWER_MIN_STORIES,
  TYPE_FORMS,
  TYPE_STORIES,
  type HeightTimeStep,
  type Option,
  type PriceStep
} from './types';

/** The most stories any option has: the generator's clamp for district-size lots. */
const STORIES_MAX = 80;
/** Type V under this many homes is priced as prototype E (pricing.ts). */
const SMALL_HOMES = 25;

/** Whether the generator masses `rec` as a district (several lots on one parcel row). */
export function isDistrictLot(rec: ParcelRecord): boolean {
  return mayBeDistrict(rec.polygon) && districtArea(rec.polygon) >= DISTRICT_MIN_M2;
}

/**
 * The most stories the generator can mass on `rec`: 0 when ineligible, 80 for a district, else
 * its physical maximum (at most 80). Callers pass `seed = fnv1a32(rec.id)`.
 */
export function storyBound(rec: ParcelRecord, seed: number): number {
  if (!rec.eligible) return 0;
  if (isDistrictLot(rec)) return STORIES_MAX;
  const site = normaliseSite(rec.polygon, drawVariety(seed).edgeInsetM);
  return site ? Math.min(STORIES_MAX, physicalMaxStories(site)) : 0;
}

/**
 * Every option the lot holds, unpruned and uncapped: for each type, each of its forms
 * (`TYPE_FORMS`) at each story count in the type's range (`TYPE_STORIES`, towers from
 * `TOWER_MIN_STORIES`) up to the lot's physical maximum, the building `generateForm` masses,
 * when it fits and is built at exactly those stories. Sorted by (stories, type code, form code).
 * Callers pass `seed = fnv1a32(rec.id)`.
 */
export function candidatesOf(rec: ParcelRecord, seed: number): Option[] {
  const bound = storyBound(rec, seed);
  const out: Option[] = [];
  for (let stories = 1; stories <= bound; stories++) {
    for (const type of BUILDING_TYPES) {
      const [lo, hi] = TYPE_STORIES[type];
      if (stories < lo || stories > hi) continue;
      for (const form of BUILDING_FORMS) {
        if (!TYPE_FORMS[type].includes(form)) continue;
        if (form === 'tower' && stories < TOWER_MIN_STORIES) continue;
        const b = generateForm(rec, form, stories, seed);
        // a building lowered below the stories asked is the option at its own stories
        if (!b || b.stories !== stories || b.units <= 0) continue;
        out.push({ type, form, stories, homes: b.units, plates: b.plates });
      }
    }
  }
  return out;
}

/** The step series an option's cost and value are read from: E for Type V under 25 homes. */
export function costSeriesOf(o: Option): 'V' | 'E' | 'III' | 'I' {
  return o.type === 'V' && o.homes < SMALL_HOMES ? 'E' : o.type;
}

/**
 * Which options survive when one is dropped only for another of the same group with homes ≥ and
 * stories ≤ its own (of two equal options the lower index survives). One sweep per group in
 * (stories ↑, homes ↓, index ↑) order: an option survives when its homes beat every option before it.
 */
function survivors(options: readonly Option[], group: (o: Option) => string): boolean[] {
  const groups = new Map<string, number[]>();
  options.forEach((o, i) => {
    const k = group(o);
    const g = groups.get(k);
    if (g) g.push(i);
    else groups.set(k, [i]);
  });
  const keep = new Array<boolean>(options.length).fill(false);
  for (const g of groups.values()) {
    g.sort(
      (a, b) =>
        options[a].stories - options[b].stories || options[b].homes - options[a].homes || a - b
    );
    let most = -Infinity;
    for (const i of g) {
      if (options[i].homes > most) {
        keep[i] = true;
        most = options[i].homes;
      }
    }
  }
  return keep;
}

const seriesKey = (o: Option) => `${o.type}/${o.form}/${costSeriesOf(o)}`;

/**
 * Cost-independent pruning: drops an option only for another of the same type, form and cost
 * series with homes ≥ and stories ≤ its own. That other option is priced on the same step series
 * and allowed at every cap that allows the dropped one, so no price step can change the drop.
 * Keeps the input order.
 */
export function pruneOptions(options: readonly Option[]): Option[] {
  const keep = survivors(options, seriesKey);
  return options.filter((_, i) => keep[i]);
}

/** The drops the 25-home line prevents: how many more options pruning by type and form alone would drop. */
export function eCrossings(options: readonly Option[]): number {
  const bySeries = survivors(options, seriesKey);
  const byForm = survivors(options, (o) => `${o.type}/${o.form}`);
  let n = 0;
  for (let i = 0; i < options.length; i++) if (bySeries[i] && !byForm[i]) n++;
  return n;
}

interface Priced {
  cost: number;
  carry: number;
  value: number;
  months: number;
}

function priced(o: Option, prices: PriceStep, time: HeightTimeStep, upTo: number[]): Priced {
  return {
    cost: costPerHome(o, prices),
    carry: carryPerHome(o, prices, time, upTo),
    value: valuePerHome(o, prices),
    months: time.constructionMonths[bandOf({ upTo }, o.stories)]
  };
}

/**
 * For the report only, never baked: the cost-based pruning first proposed. An option is dropped
 * when another has stories ≤, homes ≥, cost per home (with carrying) ≤, value per home ≥ and
 * construction months ≤ its own, at this one price step; of two equal options the lower index
 * survives. Quadratic in the row.
 */
export function pruneByCost(
  options: readonly Option[],
  prices: PriceStep,
  time: HeightTimeStep,
  upTo: number[]
): Option[] {
  const p = options.map((o) => priced(o, prices, time, upTo));
  const beats = (j: number, i: number) => {
    const a = options[j];
    const b = options[i];
    return (
      a.stories <= b.stories &&
      a.homes >= b.homes &&
      p[j].cost + p[j].carry <= p[i].cost + p[i].carry &&
      p[j].value >= p[i].value &&
      p[j].months <= p[i].months
    );
  };
  return options.filter((_, i) => {
    for (let j = 0; j < options.length; j++) {
      if (j === i || !beats(j, i)) continue;
      // two equal options: the lower index survives
      if (j < i || !beats(i, j)) return false;
    }
    return true;
  });
}

/**
 * A lot's constants at one price and height-time step, over all its options whatever the cap:
 * the least break-even location value, (costPerHome + carryPerHome) ÷ valuePerHome, the mean
 * homes and the mean cost per home (without carrying).
 */
export function lotConstants(
  opts: readonly Option[],
  prices: PriceStep,
  time: HeightTimeStep,
  upTo: number[]
): { breakEvenValue: number; meanOptionHomes: number; meanOptionCost: number } {
  if (opts.length === 0) return { breakEvenValue: Infinity, meanOptionHomes: 0, meanOptionCost: 0 };
  let breakEvenValue = Infinity;
  let homes = 0;
  let cost = 0;
  for (const o of opts) {
    const p = priced(o, prices, time, upTo);
    breakEvenValue = Math.min(breakEvenValue, (p.cost + p.carry) / p.value);
    homes += o.homes;
    cost += p.cost;
  }
  return {
    breakEvenValue,
    meanOptionHomes: homes / opts.length,
    meanOptionCost: cost / opts.length
  };
}
