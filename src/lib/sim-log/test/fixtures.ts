/**
 * Builders for log tests. The document builders are copied from `timeline/parse4.spec.ts`, whose
 * spec file cannot be imported.
 */
import { FIXTURE_AS_OF, fundingOnly } from '$lib/sim/levers/fixtures/finance';
import { OBSERVED_TIMING } from '$lib/sim-page/timing';
import { monthFirstDay, monthLastDay } from '$lib/sim/world/months';
import type { SimPolicy4 } from '$lib/timeline/policy4';
import type { StrokeFields } from '../keys';
import { DEFAULT_SIM_NAME } from '../shapes';
import type { Change, FoldInput, RulesetContent } from '../types';

export const AS_OF = FIXTURE_AS_OF;
export const first = (m: number) => monthFirstDay(AS_OF, m);
export const last = (m: number) => monthLastDay(AS_OF, m);
export type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const span = (from: number, to: number | null, what: J): J => ({ from, to, what });
export const open = (what: J, m = 1): J => span(first(m), null, what);

export const stroke = { path: [[-122.4, 37.7]], radiusM: 50 };
export const bandsW = (stories = 6): J => ({ tag: 'bands', bands: [{ maxM: 402, stories }] });
export const brushesW = (): J => ({
  tag: 'brushes',
  brushes: [{ id: 'b1', kind: 'paint', strokes: [stroke], stories: 5 }]
});
export const timingSet = (): J => structuredClone(OBSERVED_TIMING.current);
export const timingW = (): J => ({ tag: 'timing', set: timingSet() });
const fundF = fundingOnly();
export const poolOf = (id: string): J => ({ ...structuredClone(fundF.pools[0]), id });
export const progOf = (id: string, pool: string): J => ({
  ...structuredClone(fundF.programmes[0]),
  id,
  pool
});
export const fundW = (pool: string, programmes: string[] = ['u-prog-1']): J => ({
  tag: 'fund',
  pool: poolOf(pool),
  programmes: programmes.map((g) => progOf(g, pool))
});
export const scaleEntry = (pool: string, from: number, scale = 1): J => ({ pool, from, scale });

export const pol = (id: string, where: J, spans: J[], over: J = {}): J => ({
  id,
  label: id,
  preset: null,
  on: true,
  where,
  spans,
  ...over
});
export const transit = (id = 'z1', spans: J[] = [open(bandsW())]): J =>
  pol(id, { tag: 'transit', stopTypes: ['metro'] }, spans);
export const painted = (id = 'z2', spans: J[] = [open(brushesW())]): J =>
  pol(id, { tag: 'painted' }, spans);
export const category = (id: string, c: string, years: number | null): J =>
  pol(id, { tag: 'category', category: c }, [open({ tag: 'protect', years })]);
export const routes = (id = 'p1', spans: J[] = [open(timingW())]): J =>
  pol(id, { tag: 'routes' }, spans, { preset: 'observed' });
export const baseline = (id = 'm1', entries: J[] = [scaleEntry('state', AS_OF + 400, 2)]): J =>
  pol(id, { tag: 'baseline' }, [open({ tag: 'scales', entries })]);
export const fund = (id: string, pool: string, spans?: J[]): J =>
  pol(
    id,
    { tag: 'fund', pool },
    spans ?? [open(fundW(pool, [`${pool}-g`.replace('u-pool', 'u-prog')]))]
  );
export const terms = (id = 'm3'): J =>
  pol(id, { tag: 'terms' }, [open({ tag: 'terms', terms: { constructionYears: 2 } })]);

export const doc = (z: J[] = [], p: J[] = [], m: J[] = []): SimPolicy4 =>
  ({ schema: 4, kinds: { zoning: z, permitting: p, money: m } }) as SimPolicy4;

/** A stroke's fields, for the key tests. */
export const F: StrokeFields = {
  span: 's:20000:z2',
  brush: 'b1',
  kind: 'paint',
  stories: 5,
  path: [[-122.4, 37.7]],
  radiusM: 50
};

export const ruleset = (policy: SimPolicy4, name = DEFAULT_SIM_NAME): RulesetContent => ({
  name,
  policy
});

export const input = (changes: Change[], over: Partial<FoldInput> = {}): FoldInput => ({
  changes,
  shapes: 1,
  datasetVersion: 'fixture-0',
  ...over
});
