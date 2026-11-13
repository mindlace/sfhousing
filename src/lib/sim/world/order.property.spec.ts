// Event order and month bounds (S7, "Tests that must pass": events), and rule 2's permutation
// test: permuting the rows of the lot table (same ids, same ranks) gives the same events. Bench
// city and fixture, seeds 1 to 3, a zoning change at month 121 (Task 9's).
import { beforeAll, describe, expect, it } from 'vitest';
import { HORIZON } from '$lib/fzp/time';
import type { ScenarioParcels } from '$lib/data/scenario-codec';
import { precomputeOf } from '$lib/sim/scenario/input';
import type { SimInput } from '$lib/sim/scenario/types';
import { monthFirstDay, monthLastDay } from './months';
import type { PolicyTimeline } from './policy/frame';
import { staticsOf, type Statics } from './statics';
import { benchInput, fixtureInput } from './test/cities.node';
import { Recorder, horizonMonth, readAll, runWorld } from './test/run';
import { changingAt, frameOf, touchedRows, upzoned } from './test/timeline';

const M = 121;
const ORDER_SEEDS = [1, 2, 3];

/** The timeline of Task 9's zoning change: every tenth candidate upzoned from month 121. */
function zoningChange(input: SimInput, p2: ScenarioParcels): PolicyTimeline {
  const g = frameOf(input, {
    id: 1,
    view: { parcels: p2, pre: precomputeOf({ ...input, parcels: p2 }) }
  });
  return changingAt(M, frameOf(input), g, touchedRows(input.parcels, p2));
}

function upzonedOf(input: SimInput): ScenarioParcels {
  return upzoned(
    input,
    precomputeOf(input).candidates.filter((_, i) => i % 10 === 0)
  );
}

/** A seeded shuffle of 0 .. n - 1 (Fisher-Yates on a 32-bit LCG). */
function shuffle(n: number, seed: number): Int32Array {
  const out = Int32Array.from({ length: n }, (_, i) => i);
  let s = seed >>> 0;
  for (let i = n - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}

type RowColumn = { length: number; [i: number]: unknown };

const isRowColumn = (v: unknown): v is RowColumn =>
  Array.isArray(v) || (ArrayBuffer.isView(v) && !(v instanceof DataView));

/** The lookup tables of `ScenarioParcels`: indexed by something other than the lot row. */
const LOOKUPS = new Set(['cells', 'districts', 'fillLevels', 'provenance']);

/**
 * `parcels` with row i taken from row `perm[i]`: every per-row column (every array but the lookup
 * tables, its stride `length / count`) permuted, nested ones too, and `index` rebuilt. `cells`
 * (row ranges for the map) is left alone; the engine does not read it.
 */
function permuted(parcels: ScenarioParcels, perm: Int32Array): ScenarioParcels {
  const n = parcels.count;
  const col = (key: string, v: RowColumn): RowColumn => {
    if (v.length % n !== 0)
      throw new Error(`permuted: ${key} has ${v.length} entries for ${n} rows`);
    const stride = v.length / n;
    const out = (
      Array.isArray(v)
        ? new Array(v.length)
        : new (v.constructor as new (n: number) => RowColumn)(v.length)
    ) as RowColumn;
    for (let i = 0; i < n; i++)
      for (let k = 0; k < stride; k++) out[i * stride + k] = v[perm[i] * stride + k];
    return out;
  };
  const walk = (o: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(o)) {
      if (isRowColumn(v) && !LOOKUPS.has(key)) out[key] = col(key, v);
      else if (
        (key === 'potentialRatio' || key === 'storiesGap') &&
        v !== null &&
        typeof v === 'object'
      )
        out[key] = walk(v as Record<string, unknown>);
      else out[key] = v;
    }
    return out;
  };
  const p = walk(parcels as unknown as Record<string, unknown>) as unknown as ScenarioParcels;
  p.index = new Map(p.id.map((id, i) => [id, i]));
  return p;
}

const cities: [string, () => SimInput | Promise<SimInput>][] = [
  ['bench', benchInput],
  ['fixture', fixtureInput]
];

describe.each(cities)('event order and rule 2 on the %s city', (name, load) => {
  let input: SimInput;
  let statics: Statics;
  let t: PolicyTimeline;
  beforeAll(async () => {
    input = await load();
    statics = staticsOf(input);
    t = zoningChange(input, upzonedOf(input));
  });

  it.each(ORDER_SEEDS)(
    `${name} seed %i: start comes first and every event lies in its month`,
    (seed) => {
      const asOf = input.asOf;
      const rec = new Recorder();
      runWorld(statics, t, seed, horizonMonth(asOf), rec);
      const started = new Set<number>();
      let inMonth = 0;
      let phases = 0;
      for (const e of rec.events) {
        if (e.kind === 'start') {
          // One 'start' per row, before any other event of the row.
          expect(started.has(e.row), `row ${e.row} started twice`).toBe(false);
          started.add(e.row);
        } else {
          // A 'phaseFiled' names the master row, which started earlier.
          expect(started.has(e.row), `${e.kind} of row ${e.row} before its start`).toBe(true);
          if (e.kind === 'phaseFiled') phases++;
        }
        if (e.month > 0) {
          expect(e.day, `${e.kind} row ${e.row}`).toBeGreaterThanOrEqual(
            monthFirstDay(asOf, e.month)
          );
          expect(e.day, `${e.kind} row ${e.row}`).toBeLessThanOrEqual(monthLastDay(asOf, e.month));
          inMonth++;
        }
      }
      expect(started.size).toBeGreaterThan(0);
      expect(inMonth).toBeGreaterThan(0);
      expect(rec.events.some((e) => e.month >= M)).toBe(true);
      if (name === 'bench') expect(phases).toBeGreaterThan(0);
    }
  );

  it.each(ORDER_SEEDS)(
    `${name} seed %i: permuting the lot table gives the same events (rule 2)`,
    (seed) => {
      const n = input.parcels.count;
      const perm = shuffle(n, 0x9e3779b9 ^ seed);
      // Lot `perm[i]` of the original table is lot i of the permuted one.
      expect(perm.some((v, i) => v !== i)).toBe(true);
      const input2: SimInput = { ...input, parcels: permuted(input.parcels, perm) };
      const statics2 = staticsOf(input2);
      // Same ids, same rank per id.
      expect(statics2.parcelId).toEqual(Array.from(perm, (j) => statics.parcelId[j]));
      expect(statics2.rank).toEqual(Uint32Array.from(perm, (j) => statics.rank[j]));
      const t2 = zoningChange(input2, permuted(upzonedOf(input), perm));
      const through = horizonMonth(input.asOf);
      const a = new Recorder();
      const wa = runWorld(statics, t, seed, through, a);
      const b = new Recorder();
      const wb = runWorld(statics2, t2, seed, through, b);
      // `'displaced'.lot` is a lot row; nothing else in an event names one.
      const mapped = b.events.map((e) => (e.kind === 'displaced' ? { ...e, lot: perm[e.lot] } : e));
      expect(mapped.length).toBe(a.events.length);
      expect(mapped).toEqual(a.events);
      expect(a.events.some((e) => e.kind === 'start' && e.month > 0)).toBe(true);
      expect(readAll(wb, statics2, HORIZON)).toEqual(readAll(wa, statics, HORIZON));
    }
  );
});
