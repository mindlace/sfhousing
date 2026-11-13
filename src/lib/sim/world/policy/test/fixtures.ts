// Builders for the policy compiler's specs: schema 4 documents with spans given by model months
// on the mini city's lots. Test values, not data.
import type { ParcelId } from '$lib/data/parcel';
import type { BrushQuery, StopType } from '$lib/sim/levers/brushes';
import { FIXTURE_AS_OF } from '$lib/sim/levers/fixtures/finance';
import type { FinanceLevers } from '$lib/sim/levers/types';
import { miniCity } from '$lib/sim/scenario/fixtures/mini-parcels';
import { queryKey, type CustomBrush, type TransitBand } from '$lib/sim-page/policy';
import { OBSERVED_TIMING, type TimingSet } from '$lib/sim-page/timing';
import type { Effect, Policy, Selector, SimPolicy4, Span } from '$lib/timeline/policy4';
import type { Day } from '$lib/timelapse/time';
import type { Pool, Programme, TermKey } from '$lib/timelapse/types';
import { monthFirstDay, monthLastDay } from '../../months';

export const AS_OF: Day = FIXTURE_AS_OF;

/** A span from the first day of `fromMonth` to the last day of `toMonth` (null: no end). */
export function span(asOf: Day, fromMonth: number, toMonth: number | null, what: Effect): Span {
  return {
    from: monthFirstDay(asOf, fromMonth),
    to: toMonth === null ? null : monthLastDay(asOf, toMonth),
    what: structuredClone(what)
  };
}

/** Month ranges, `[from, to]` (to null = no end); default: from month 1 with no end. */
export type Months = [from: number, to: number | null][];
const ALWAYS: Months = [[1, null]];

function make(id: string, where: Selector, what: Effect, months: Months, preset: string | null) {
  const p: Policy = {
    id,
    label: id,
    preset,
    on: true,
    where,
    spans: months.map(([a, b]) => span(AS_OF, a, b, what))
  };
  return p;
}

export const transitPolicy = (
  id: string,
  stopTypes: StopType[],
  bands: TransitBand[],
  months = ALWAYS
): Policy => make(id, { tag: 'transit', stopTypes }, { tag: 'bands', bands }, months, null);

export const paintedPolicy = (id: string, brushes: CustomBrush[], months = ALWAYS): Policy =>
  make(id, { tag: 'painted' }, { tag: 'brushes', brushes }, months, null);

export const protectPolicy = (
  id: string,
  category: 'rentControl' | 'historic' | 'newerThan',
  years: number | null = null,
  months = ALWAYS
): Policy => make(id, { tag: 'category', category }, { tag: 'protect', years }, months, null);

export const timingPolicy = (id: string, set: TimingSet, months = ALWAYS): Policy =>
  make(id, { tag: 'routes' }, { tag: 'timing', set }, months, set.preset);

export const baselinePolicy = (
  id: string,
  entries: FinanceLevers['baselineScale'],
  months = ALWAYS
): Policy => make(id, { tag: 'baseline' }, { tag: 'scales', entries }, months, null);

export const fundPolicy = (
  id: string,
  poolId: string,
  pool: Pool | null,
  programmes: Programme[],
  months = ALWAYS
): Policy =>
  make(id, { tag: 'fund', pool: poolId }, { tag: 'fund', pool, programmes }, months, null);

export const termsPolicy = (
  id: string,
  terms: Partial<Record<TermKey, number>>,
  months = ALWAYS
): Policy => make(id, { tag: 'terms' }, { tag: 'terms', terms }, months, null);

/** The policy switched off. */
export const off = (p: Policy): Policy => ({ ...p, on: false });

const KIND: Record<Selector['tag'], keyof SimPolicy4['kinds']> = {
  transit: 'zoning',
  painted: 'zoning',
  category: 'zoning',
  routes: 'permitting',
  baseline: 'money',
  fund: 'money',
  terms: 'money'
};

/** A document holding `policies`, each in its kind's list in the order given. */
export function miniDoc(...policies: Policy[]): SimPolicy4 {
  const doc: SimPolicy4 = { schema: 4, kinds: { zoning: [], permitting: [], money: [] } };
  for (const p of policies) doc.kinds[KIND[p.where.tag]].push(p);
  return doc;
}

/** The mini city's lot ids, sorted. */
export function miniLotIds(): ParcelId[] {
  return [...miniCity().records.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** A lots table: each query's key to its lots. */
export function lotsOf(...entries: [BrushQuery, ParcelId[]][]): Record<string, ParcelId[]> {
  return Object.fromEntries(entries.map(([q, l]) => [queryKey(q), l]));
}

/** Observed timing with the given overrides. */
export const timingSet = (over: Partial<TimingSet> = {}): TimingSet => ({
  ...structuredClone(OBSERVED_TIMING.current),
  ...over
});
