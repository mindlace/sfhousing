/**
 * The developer's choice fits (building-choice spec, "Start odds refit"; plan Task 8): the choice
 * spread by maximum likelihood of the records' built stories, and the affordable projects' rule
 * from the cohort check. The likelihood is scored through the run-time choice code
 * (src/lib/sim/choice/choose.ts, preflight ruling F13), on the one shipped price and height-time
 * step, so the fit and the run cannot diverge.
 */
import { optionTableOf, type OptionTable } from '../../../src/lib/data/option-table';
import type { ParcelId } from '../../../src/lib/data/parcel';
import {
  allowedCount,
  choiceCtxOf,
  choiceRow,
  expectations,
  optionHomes,
  type ChoiceCtx
} from '../../../src/lib/sim/choice/choose';
import { optionPrototype } from '../../../src/lib/sim/choice/pricing';
import { uncoveredPerHome } from '../../../src/lib/sim/finance/prototypes';
import {
  BUILDING_FORMS,
  BUILDING_TYPES,
  type ChoiceModel,
  type HeightTimeModel,
  type HeightTimeStep,
  type Option,
  type PriceStep
} from '../../../src/lib/sim/choice/types';
import { exp, log } from '../../../src/lib/timelapse/math';
import type { Day, Provenance } from '../../../src/lib/timelapse/types';
import { isoToDay } from '../../project-records/multiphase';
import type { RecordTargets } from '../building-records';
import { primaryParcel, type PanelSource, type PanelYearRow } from './panel';
import type { NormHistory } from './types';
import { startCohort, type StartCohort } from '../affordable-cohort';
import { PLANNING_START } from './window';

/** One record: its lot's options (rising in stories), location value, limit and built stories. */
export interface ChoiceRecord {
  options: Option[];
  locationValue: number;
  /** The base limit in stories when the record was filed. */
  limit: number;
  /** The record's built (proposed) stories. */
  stories: number;
  /** Homes on the lot before the project; 0 when absent. */
  existing?: number;
  /** The density cap in homes; none when absent. */
  cap?: number | null;
  /** The start cohort of the record's project (affordable-cohort.ts); absent counts as market. */
  cohort?: StartCohort;
  /** The calendar year the record was first recorded: the market it is priced at, when given. */
  year?: number;
}

export interface ChoiceSpreadFit {
  choiceSpread: number;
  /** The log-likelihood at the fitted spread. */
  logLik: number;
  /** Records in the likelihood. */
  n: number;
  /** Records over their limit, left out (the density-bonus projects: sizeOverEnvelope). */
  excludedOver: number;
  /** Records whose lot has no option gaining a home at the limit, left out. */
  noOption: number;
  /** The log-likelihood at each PROFILE_SPREADS value: how sharply the records fix the spread. */
  profile: { spread: number; logLik: number }[];
}

/** The spreads the profile reports. */
export const PROFILE_SPREADS = [0.01, 0.1, 1, 10, 100];

/** The search interval on choiceSpread (golden-section on its log). */
export const SPREAD_RANGE: [number, number] = [1e-3, 1e2];
/** Stop when the bracket on ln choiceSpread is this narrow. */
const LOG_TOL = 1e-5;
/** The floor on a record's probability, so an option the model gives no weight stays finite. */
const P_FLOOR = 1e-12;
const GOLDEN = (Math.sqrt(5) - 1) / 2;

/** Placeholder provenance for the fit's own model: never published. */
const FIT_ONLY: Provenance = {
  tier: 4,
  label: 'choice-fit working model, invented, never published',
  sources: [],
  method: 'the shipped step wrapped for the likelihood'
};

/**
 * The maximum-likelihood choiceSpread over `records`, by golden-section search on its log in
 * SPREAD_RANGE. A record's likelihood is the market rule's probability of the options at its built
 * stories among the options allowed at its limit; a record whose built stories no gaining option
 * has takes the gaining options at the nearest stories (ties to the lower). With no record, the
 * spread is NaN and the log-likelihood 0. With `pricesFor`, a record with a `year` is priced at
 * `pricesFor(year)` (its own year's market, era-market.ts), as one dated step of the model's price
 * series; a record without one, and every record without `pricesFor`, at `prices`.
 */
export function fitChoiceSpread(
  records: readonly ChoiceRecord[],
  prices: PriceStep,
  time: HeightTimeStep,
  upTo: number[],
  pricesFor?: (year: number) => PriceStep
): ChoiceSpreadFit {
  let excludedOver = 0;
  let noOption = 0;
  const kept = records.filter((r) => {
    if (r.stories > r.limit) {
      excludedOver++;
      return false;
    }
    return true;
  });
  const t = optionTableOf(
    'choice-fit',
    kept.map((r) => ({ options: r.options, locationValue: r.locationValue }))
  );
  // One dated price step per record year (from = the year's index in `years`), the shipped
  // prices at step 0 for records without a year; one height-time step throughout.
  const years = pricesFor
    ? [...new Set(kept.flatMap((r) => (r.year === undefined ? [] : [r.year])))].sort(
        (a, b) => a - b
      )
    : [];
  const stepOf = (r: ChoiceRecord): number =>
    pricesFor && r.year !== undefined ? years.indexOf(r.year) + 1 : 0;
  const m: ChoiceModel = {
    prices: [
      { from: 0, value: prices },
      ...years.map((y, i) => ({ from: i + 1, value: pricesFor!(y) }))
    ],
    choiceSpread: 1,
    affordableRule: 'market',
    provenance: {
      anchors: FIT_ONLY,
      aboveTopCostRatio: FIT_ONLY,
      carrying: FIT_ONLY,
      choiceSpread: FIT_ONLY,
      affordableRule: FIT_ONLY,
      locationValue: FIT_ONLY
    }
  };
  const ht: HeightTimeModel = { upTo, steps: [{ from: 0, value: time }], provenance: FIT_ONLY };
  const ctx = choiceCtxOf(t, m, ht);

  // Per record: its allowed count and the row positions of the options at its matched stories.
  const lots: {
    lot: number;
    step: number;
    n: number;
    cap: number | null;
    existing: number;
    at: number[];
  }[] = [];
  kept.forEach((r, lot) => {
    const n = allowedCount(t, lot, r.limit);
    const existing = r.existing ?? 0;
    const cap = r.cap ?? null;
    const from = t.offset[lot];
    let best = -1;
    let bestGap = Infinity;
    for (let k = 0; k < n; k++) {
      if (optionHomes(t, from + k, cap, existing) <= existing) continue;
      const s = t.stories[from + k];
      const gap = Math.abs(s - r.stories);
      if (gap < bestGap || (gap === bestGap && s < best)) {
        best = s;
        bestGap = gap;
      }
    }
    if (best < 0) {
      noOption++;
      return;
    }
    const at: number[] = [];
    for (let k = 0; k < n; k++) {
      if (t.stories[from + k] === best && optionHomes(t, from + k, cap, existing) > existing) {
        at.push(k);
      }
    }
    lots.push({ lot, step: stepOf(r), n, cap, existing, at });
  });

  let width = 0;
  for (const l of lots) width = Math.max(width, l.n);
  const cum = new Float32Array(Math.max(1, width));
  const logLik = (spread: number): number => {
    const at: ChoiceCtx = { ...ctx, m: { ...m, choiceSpread: spread } };
    let sum = 0;
    for (const l of lots) {
      choiceRow(at, l.step, l.lot, l.n, l.cap, l.existing, 'market', cum);
      let p = 0;
      for (const k of l.at) p += cum[k] - (k > 0 ? cum[k - 1] : 0);
      sum += log(Math.max(p, P_FLOOR));
    }
    return sum;
  };

  if (lots.length === 0) {
    return { choiceSpread: NaN, logLik: 0, n: 0, excludedOver, noOption, profile: [] };
  }
  let a = log(SPREAD_RANGE[0]);
  let b = log(SPREAD_RANGE[1]);
  let x1 = b - GOLDEN * (b - a);
  let x2 = a + GOLDEN * (b - a);
  let f1 = logLik(exp(x1));
  let f2 = logLik(exp(x2));
  while (b - a > LOG_TOL) {
    if (f1 >= f2) {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = b - GOLDEN * (b - a);
      f1 = logLik(exp(x1));
    } else {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = a + GOLDEN * (b - a);
      f2 = logLik(exp(x2));
    }
  }
  const choiceSpread = exp((a + b) / 2);
  return {
    choiceSpread,
    logLik: logLik(choiceSpread),
    n: lots.length,
    excludedOver,
    noOption,
    profile: PROFILE_SPREADS.map((spread) => ({ spread, logLik: logLik(spread) }))
  };
}

/** Whether the cohort check measured a difference: a finite difference and an SE above 0. */
export function affordableRuleMeasurable(t: { diff: number; se: number }): boolean {
  return Number.isFinite(t.diff) && Number.isFinite(t.se) && t.se > 0;
}

/**
 * The affordable projects' rule (spec, owner decision): 'most-homes' (rule A) exactly when the
 * affordable mean of built height ÷ limit exceeds the private mean by more than 2 SE of the
 * difference, else 'market'. Without a measurable difference it is 'market'.
 */
export function affordableRule(t: RecordTargets['cohort']): {
  rule: 'most-homes' | 'market';
  diff: number;
  se: number;
} {
  const rule = affordableRuleMeasurable(t) && t.diff > 2 * t.se ? 'most-homes' : 'market';
  return { rule, diff: t.diff, se: t.se };
}

/**
 * The records the market spread is fitted on: all of them under the market rule; under
 * 'most-homes' those whose project is not in the affordable cohort, since affordable projects
 * then choose by rule A, not the market rule. `affordable` counts the records left out.
 */
export function marketRecords(
  records: readonly ChoiceRecord[],
  rule: 'most-homes' | 'market'
): { records: ChoiceRecord[]; affordable: number } {
  if (rule === 'market') return { records: [...records], affordable: 0 };
  const kept = records.filter((r) => r.cohort !== 'affordable');
  return { records: kept, affordable: records.length - kept.length };
}

/** Whether a fitted spread sits at either end of SPREAD_RANGE (within 0.1% on the log scale). */
export function atSearchBound(fit: Pick<ChoiceSpreadFit, 'choiceSpread'>): boolean {
  const s = fit.choiceSpread;
  return Number.isFinite(s) && SPREAD_RANGE.some((b) => Math.abs(log(s / b)) < 1e-3);
}

/** Row `i` of an option table as options. */
export function optionsOf(t: OptionTable, i: number): Option[] {
  const out: Option[] = [];
  for (let j = t.offset[i]; j < t.offset[i + 1]; j++) {
    out.push({
      type: BUILDING_TYPES[t.type[j]],
      form: BUILDING_FORMS[t.form[j]],
      stories: t.stories[j],
      homes: t.homes[j],
      plates: t.plates[j]
    });
  }
  return out;
}

/** A history's earliest entered day, any stage (the size model's first record). */
function firstRecord(h: NormHistory): Day | null {
  let first: Day | null = null;
  for (const day of Object.values(h.eff)) {
    if (day !== undefined && (first === null || day < first)) first = day;
  }
  return first;
}

/**
 * The fit's records (plan, "Choice-spread fit"): every history first recorded from PLANNING_START
 * to `asOf` with proposed stories and base stories at filing of at least 1, on its largest
 * parcel's panel row of its first record's roll year (the last panel year after it). Its options
 * are that row's panel options, with today's locationValue (panel-options.bin carries no past
 * value), its limit the base stories at filing, its existing homes and base cap that roll year's.
 * `measured` counts the histories that pass the filters; `noPanelRow` those of them without a
 * panel row carrying choice inputs.
 */
export async function choiceRecords(
  norm: readonly NormHistory[],
  panel: PanelSource,
  panelOptions: OptionTable,
  lotArea: (id: ParcelId) => number,
  asOf: Day
): Promise<{ records: ChoiceRecord[]; measured: number; noPanelRow: number }> {
  const from = isoToDay(PLANNING_START);
  const years = [...panel.years].sort((a, b) => a - b);
  const wanted = new Map<
    number,
    { parcel: ParcelId; stories: number; limit: number; cohort: StartCohort; year: number }[]
  >();
  let measured = 0;
  for (const h of [...norm].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const first = firstRecord(h);
    if (first === null || first < from || first > asOf) continue;
    const stories = h.src.storiesProposed;
    const limit = h.src.baseStoriesAtFiling;
    if (stories === null || limit === null || stories < 1 || limit < 1) continue;
    if (h.parcelIds.length === 0) continue;
    measured++;
    const y = new Date(first * 86_400_000).getUTCFullYear();
    const year = years.filter((v) => v <= y).pop() ?? years[0];
    if (year === undefined) continue;
    const list = wanted.get(year) ?? [];
    list.push({
      parcel: primaryParcel(h.parcelIds, lotArea),
      stories,
      limit,
      cohort: startCohort(h.src.planningProposed),
      year: y
    });
    wanted.set(year, list);
  }
  const records: ChoiceRecord[] = [];
  let found = 0;
  for (const year of [...wanted.keys()].sort((a, b) => a - b)) {
    const rows = new Map<string, PanelYearRow>();
    for (const r of await panel.read(year)) rows.set(r.mapblklot, r);
    for (const w of wanted.get(year)!) {
      const c = rows.get(w.parcel)?.choice;
      if (!c) continue;
      found++;
      records.push({
        options: optionsOf(panelOptions, c.optionRow),
        locationValue: panelOptions.locationValue[c.optionRow],
        limit: w.limit,
        stories: w.stories,
        existing: c.existingUnits,
        cap: c.baseCap,
        cohort: w.cohort,
        year: w.year
      });
    }
  }
  return { records, measured, noPanelRow: measured - found };
}

/**
 * A running Pearson correlation, across panel rows, between choiceMargin and the market slope's
 * cost share of the row's best option: uncoveredPerHome ÷ costPerHome of the prototype it prices
 * as (market.ts typicalUncoveredShare's per-project share). How much the margin feature and the
 * slope measure the same thing (spec: "Its overlap with the market slope is measured").
 */
export function marginOverlap(ctx: ChoiceCtx) {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  const prices = ctx.m.prices[0].value;
  const o: Pick<Option, 'type' | 'stories' | 'homes'> = { type: 'V', stories: 0, homes: 0 };
  return {
    /** Adds a row: its option row in the context's table and its choice inputs. */
    add(lot: number, nAllowed: number, cap: number | null, existing: number): void {
      const e = expectations(ctx, 0, lot, nAllowed, cap, existing);
      if (!e.gains) return;
      const j = ctx.t.offset[lot] + e.best;
      o.type = BUILDING_TYPES[ctx.t.type[j]];
      o.stories = ctx.t.stories[j];
      o.homes = ctx.t.homes[j];
      const p = optionPrototype(o, prices);
      const y = uncoveredPerHome('market', p) / p.costPerHome;
      const x = e.margin;
      n++;
      sx += x;
      sy += y;
      sxx += x * x;
      syy += y * y;
      sxy += x * y;
    },
    /** The correlation and its n; NaN under 2 rows or with no spread. */
    result(): { r: number; n: number } {
      const cov = sxy - (sx * sy) / n;
      const vx = sxx - (sx * sx) / n;
      const vy = syy - (sy * sy) / n;
      return { r: n > 1 && vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : NaN, n };
    }
  };
}

/**
 * The margin's overlap with the market slope over a panel, as its own pass: every hostable row
 * with choice inputs, every year read once.
 */
export async function measureOverlap(
  panel: PanelSource,
  ctx: ChoiceCtx
): Promise<{ r: number; n: number }> {
  const overlap = marginOverlap(ctx);
  for (const y of panel.years) {
    for (const row of await panel.read(y)) {
      const c = row.choice;
      if (!c || !row.hostableBase) continue;
      overlap.add(
        c.optionRow,
        allowedCount(ctx.t, c.optionRow, c.baseStories),
        c.baseCap,
        c.existingUnits
      );
    }
  }
  return overlap.result();
}
