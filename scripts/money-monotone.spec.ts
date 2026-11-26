// The money monotonicity check on the fixture: the sets, the edges, the readings, the offenders.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fundingPresets } from '../src/lib/sim-page/funding-presets';
import { monthFirstDay } from '../src/lib/sim/world/months';
import { openEngine, type Engine } from './lib/engine-runner';
import {
  DEADLINE_YEARS,
  MONOTONE_TOLERANCE,
  docFor,
  edgesOf,
  monotoneExit,
  monotoneLines,
  offeredPresets,
  offenders,
  runMonotone,
  subsetsOf,
  type Offender,
  type Reading,
  type SetReadings
} from './money-monotone';

const FIXTURE = 'e2e/fixtures/data/fixture-0';
/** Enough for one fill of the fixture's window; a hook argument, not a wait. */
const FILL_HOOK_MS = 600_000;

let engine: Engine;

beforeAll(async () => {
  engine = await openEngine({ dir: FIXTURE });
}, FILL_HOOK_MS);

afterAll(() => {
  engine?.close();
});

const reading = (net: number): Record<Reading, number> => ({ net, funded: 0, affordable: 0 });
const sets = (before: number, after: number): SetReadings[] => [
  { set: [], secs: 0, at: { 2045: reading(before) } },
  { set: ['p'], secs: 0, at: { 2045: reading(after) } }
];

describe('the sets', () => {
  it('the constants', () => {
    expect(MONOTONE_TOLERANCE).toBe(5);
    expect([...DEADLINE_YEARS]).toEqual([2035, 2040, 2045, 2055, 2060]);
  });

  it('subsetsOf and edgesOf', () => {
    const s = subsetsOf(['a', 'b', 'c']);
    expect(s).toHaveLength(8);
    expect(s[0]).toEqual([]);
    expect(s).toContainEqual(['a', 'c']); // members keep ids order
    expect(edgesOf(['a', 'b', 'c', 'd', 'e', 'f'])).toHaveLength(192);
  });

  it('a drop of exactly the tolerance passes; one more fails', () => {
    expect(offenders(sets(100, 95), ['p'])).toEqual([]);
    expect(offenders(sets(100, 94), ['p'])).toEqual([
      { from: [], added: 'p', reading: 'net', year: 2045, before: 100, after: 94 }
    ]);
  });

  it('a rise is never an offender', () => {
    expect(offenders(sets(100, 200), ['p'])).toEqual([]);
  });
});

describe('offeredPresets', () => {
  it('lists the presets that add money: no withdrawals, none held back', () => {
    const ids = offeredPresets(engine.cal);
    const all = fundingPresets(engine.cal);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).not.toContain('state-off');
    expect(ids).not.toContain('federal-credits-off');
    for (const p of all.filter((q) => ids.includes(q.id))) {
      expect(p.available).toBe(true);
      expect(p.baselineScale.every((s) => s.scale >= 1)).toBe(true);
    }
    expect(all.filter((p) => p.available && !ids.includes(p.id)).map((p) => p.id)).toEqual(
      ['state-off', 'federal-credits-off'].filter((id) =>
        all.some((p) => p.id === id && p.available)
      )
    );
  });
});

describe('docFor', () => {
  it('adds each preset from month 1, in ids order', () => {
    const ids = offeredPresets(engine.cal);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    const set = [ids[0], ids[1]];
    const doc = docFor(set, engine.cal, engine.asOf);
    expect(doc.kinds.money.map((p) => p.preset)).toEqual(set);
    expect(doc.kinds.money[0].spans[0].from).toBe(monthFirstDay(engine.asOf, 1));
    expect(docFor([], engine.cal, engine.asOf).kinds.money).toEqual([]);
  });
});

describe('runMonotone on the fixture', () => {
  it('two presets: 4 sets, every reading finite', async () => {
    const presets = offeredPresets(engine.cal).slice(0, 2);
    const r = await runMonotone(engine, { presets });
    expect(r.ids).toEqual(presets);
    expect(r.sets).toHaveLength(4);
    for (const s of r.sets) {
      expect(Object.keys(s.at).map(Number)).toEqual([...DEADLINE_YEARS]);
      for (const year of DEADLINE_YEARS) {
        for (const v of Object.values(s.at[year])) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
        }
      }
    }
    expect(Array.isArray(r.offenders)).toBe(true);
  });

  it('an unknown preset is refused', async () => {
    await expect(runMonotone(engine, { presets: ['x'] })).rejects.toThrow(
      'preset x is not offered'
    );
  });
});

describe('lines and exit', () => {
  const drop: Offender = {
    from: [],
    added: 'p',
    reading: 'net',
    year: 2045,
    before: 100,
    after: 94
  };

  it('names the dataset, the presets, each drop and the verdict', () => {
    expect(monotoneLines({ datasetVersion: 'fixture-0', ids: ['p', 'q'], offenders: [] })).toEqual([
      'Dataset fixture-0',
      'Presets: p, q',
      'Monotone: no reading drops more than 5 homes'
    ]);
    expect(monotoneLines({ datasetVersion: 'fixture-0', ids: ['p'], offenders: [drop] })).toEqual([
      'Dataset fixture-0',
      'Presets: p',
      'Drop: net Dec 2045, [] + p: 100 -> 94 (-6)',
      'Not monotone: 1 drops on 1 edges'
    ]);
  });

  it('exits 0 when monotone and 1 on an offender', () => {
    expect(monotoneExit([])).toBe(0);
    expect(monotoneExit([drop])).toBe(1);
  });
});
