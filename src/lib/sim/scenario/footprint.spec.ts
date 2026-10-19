import { describe, expect, it, vi } from 'vitest';
import type { ParcelId, ParcelRecord } from '$lib/data/parcel';
import { FILL_LEVELS, fillStories } from '$lib/data/scenario-codec';
import { fnv1a32, generate, generateForUnits } from '$lib/generator';
import { MAX_STORIES } from '$lib/generator/constants';
import { localFrame } from '$lib/generator/geo';
import { normaliseRing } from '$lib/map/pack';
import { packTimedCell } from '$lib/map/pack-timed';
import { parseCalibration } from '$lib/timelapse/model';
import { parseProjectsFile } from '$lib/timelapse/projects';
import type { Calibration } from '$lib/timelapse/types';
import { createLru } from '../lru';
import { miniCity, MINI_SAME_CELL_PAIR } from './fixtures/mini-parcels';
import miniCalibrationJson from './fixtures/mini-calibration.json';
import { MINI_AS_OF, MINI_HORIZON, miniProjectsJson } from './fixtures/mini-projects';
import { buildSimInput } from './input';
import {
  cellAnchorParcel,
  footprintOf,
  footprintParcel,
  massingFor,
  massingsFor,
  pipeKey,
  simKey,
  type MassingCtx
} from './massing';
import { simulate } from './simulate';
import type { Schedule, SimInput } from './types';

const city = miniCity();
const input: SimInput = buildSimInput({
  parcels: city.parcels,
  projects: parseProjectsFile(miniProjectsJson(), { onInvalid() {} }),
  calibration: parseCalibration(structuredClone(miniCalibrationJson) as unknown) as Calibration
});
const NO_CAP = 0xffff;

const rec = (id: ParcelId): ParcelRecord => {
  const r = city.records.get(id);
  if (!r) throw new Error(`no record ${id}`);
  return r;
};

/** A ctx over the mini chunks with spies on both generator entry points. */
function makeCtx(over: Partial<MassingCtx> = {}) {
  const gen = vi.fn(generate);
  const genForUnits = vi.fn(generateForUnits);
  const logged: string[] = [];
  const seen = new Set<string>();
  const ctx: MassingCtx = {
    input,
    records: (id) => city.records.get(id),
    memo: createLru(1000),
    gen,
    genForUnits,
    // The ctx owns the once-per-project rule; this is a faithful stand-in.
    logOnce(projectId, msg) {
      if (seen.has(projectId)) return;
      seen.add(projectId);
      logged.push(msg);
    },
    ...over
  };
  return { ctx, gen, genForUnits, logged };
}

const DAY = MINI_AS_OF;
function schedule(over: Partial<Schedule> & Pick<Schedule, 'projectId' | 'parcelIds'>): Schedule {
  return {
    origin: 'pipeline',
    pathway: 'discretionary',
    entered: {},
    end: { kind: 'open' },
    revisions: [
      { day: DAY, units: 40, stories: null },
      { day: DAY + 100, units: 44, stories: 6 },
      { day: DAY + 200, units: 30, stories: 5 }
    ],
    existingUnits: 0,
    multiPhase: false,
    phase: null,
    ...over
  };
}

const pairSchedule = (over: Partial<Schedule> = {}) =>
  schedule({ projectId: 'PRJ:pair', parcelIds: [...MINI_SAME_CELL_PAIR], ...over });

describe('cellAnchorParcel and footprintParcel', () => {
  it('the cell anchor is the smallest ParcelId present in T11', () => {
    const ids: ParcelId[] = ['3512003', '0026T004', '0026T003'];
    expect(cellAnchorParcel(ids, city.parcels)).toBe('0026T003');
  });

  it('skips ids absent from T11 and returns null when none is present', () => {
    expect(cellAnchorParcel(['0000000', '0026T004', '9900001'], city.parcels)).toBe('0026T004');
    expect(cellAnchorParcel(['9900001', '9900002'], city.parcels)).toBeNull();
    expect(cellAnchorParcel([], city.parcels)).toBeNull();
  });

  it('the footprint parcel has the largest areaM2, ties to the smallest id', () => {
    const base = rec('0026T003');
    const a = { ...base, id: 'B', areaM2: 100 };
    const b = { ...base, id: 'A', areaM2: 100 };
    const c = { ...base, id: 'C', areaM2: 90 };
    expect(footprintParcel([a, b, c]).id).toBe('A');
    expect(footprintParcel([c, a]).id).toBe('B');
    expect(footprintParcel([{ ...c, areaM2: 120 }, a, b]).id).toBe('C');
  });

  it('the footprint parcel can differ from the cell anchor', () => {
    const [x, y] = MINI_SAME_CELL_PAIR; // x is the smaller id, hence the cell anchor
    const bigger = { ...rec(y), areaM2: rec(x).areaM2 + 1 };
    expect(footprintParcel([rec(x), bigger]).id).toBe(y);
    expect(cellAnchorParcel([y, x], city.parcels)).toBe(x);
  });
});

describe('keys', () => {
  it('simKey and pipeKey have the contract shape', () => {
    expect(simKey('0026T003', 7)).toBe('s|0026T003|7');
    expect(pipeKey(5, 40, 6, ['b', 'a'])).toBe('p|5|40|6|a,b');
    expect(pipeKey(5, 40, null, ['a'])).toBe('p|5|40|-|a');
  });

  it('the pipeline key sorts and de-duplicates the parcel ids', () => {
    expect(pipeKey(1, 2, 3, ['c', 'a', 'b', 'a'])).toBe(pipeKey(1, 2, 3, ['a', 'b', 'c']));
    expect(pipeKey(1, 2, 3, ['a', 'b'])).not.toBe(pipeKey(1, 2, 3, ['a', 'c']));
    expect(pipeKey(1, 2, 3, ['a'])).not.toBe(pipeKey(1, 2, null, ['a']));
  });
});

describe('footprintOf', () => {
  it('is polygon[0] through localFrame(labelPoint).to, as stored', () => {
    const r = rec('0026T011'); // the L-shaped lot
    const f = localFrame(r.labelPoint);
    expect(footprintOf(r)).toEqual({ footprint: r.polygon[0].map(([x, y]) => f.to(x, y)) });
    expect(footprintOf(r).footprint).toHaveLength(r.polygon[0].length);
  });
});

describe('massingFor: generator results', () => {
  it('a null massing gives the largest-area parcel footprint', () => {
    // generateForUnits returns null for 1 unit on the 6 x 6 m lot (Task 3).
    const s = schedule({
      projectId: 'BP:one',
      parcelIds: ['0026T013'],
      revisions: [{ day: DAY, units: 1, stories: null }]
    });
    const { ctx, genForUnits } = makeCtx();
    expect(massingFor(s, 0, ctx)).toEqual(footprintOf(rec('0026T013')));
    expect(genForUnits).toHaveBeenCalledTimes(1);
  });

  it('memoises a null result: the generator is not called again', () => {
    const s = schedule({
      projectId: 'BP:one',
      parcelIds: ['0026T013'],
      revisions: [{ day: DAY, units: 1, stories: null }]
    });
    const { ctx, genForUnits } = makeCtx();
    massingFor(s, 0, ctx);
    massingFor(s, 0, ctx);
    expect(genForUnits).toHaveBeenCalledTimes(1);
    expect(ctx.memo.get(pipeKey(fnv1a32('BP:one'), 1, null, ['0026T013']))).toBeNull();
  });

  it('a throwing generator gives the footprint of the largest-area parcel', () => {
    const [x, y] = MINI_SAME_CELL_PAIR;
    const tall = { ...rec(y), areaM2: rec(x).areaM2 + 50 };
    const records = new Map(city.records).set(y, tall);
    const { ctx, logged } = makeCtx({
      records: (id) => records.get(id),
      genForUnits: () => {
        throw new Error('boom');
      }
    });
    expect(massingFor(pairSchedule(), 1, ctx)).toEqual(footprintOf(tall));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('boom');
  });

  it('a pipeline project is massed with generateForUnits on its sorted records', () => {
    const s = pairSchedule({ parcelIds: [MINI_SAME_CELL_PAIR[1], MINI_SAME_CELL_PAIR[0]] });
    const { ctx, genForUnits } = makeCtx();
    const m = massingFor(s, 1, ctx);
    expect(genForUnits).toHaveBeenCalledWith(
      [rec(MINI_SAME_CELL_PAIR[0]), rec(MINI_SAME_CELL_PAIR[1])],
      44,
      6,
      fnv1a32('PRJ:pair'),
      6
    );
    expect('parts' in m && m.source).toBe('pipeline');
  });

  it('unknown stories use MAX_STORIES as the cap and no stories hint', () => {
    const { ctx, genForUnits } = makeCtx();
    massingFor(pairSchedule(), 0, ctx);
    expect(genForUnits).toHaveBeenCalledWith(
      expect.any(Array),
      40,
      MAX_STORIES,
      fnv1a32('PRJ:pair'),
      undefined
    );
  });

  it('a simulated project is massed on the scenario record with its stories as the envelope', () => {
    const id = '3512012'; // chunk says 1 existing unit, T11 says 2
    const i = city.parcels.index.get(id)!;
    const s = schedule({
      projectId: `SIM:${id}`,
      origin: 'simulated',
      parcelIds: [id],
      revisions: [{ day: DAY, units: 12, stories: 4 }]
    });
    const { ctx, gen } = makeCtx();
    const m = massingFor(s, 0, ctx);
    expect(gen).toHaveBeenCalledTimes(1);
    const [recArg, env, seed, mode] = gen.mock.calls[0];
    expect(rec(id).existingUnits).not.toBe(city.parcels.existingUnits[i]);
    expect(recArg.existingUnits).toBe(city.parcels.existingUnits[i]);
    expect(recArg.existingFloorAreaM2).toBe(city.parcels.existingFloorAreaM2[i]);
    expect(env).toEqual({ maxStories: 4 });
    expect(seed).toBe(fnv1a32(id));
    expect(mode).toBe('max');
    expect('parts' in m && m.source).toBe('scenario');
  });

  it('the simulated memo is keyed by parcel and stories, not by seed or project', () => {
    const id = '3512012';
    const mk = (projectId: string, stories: number) =>
      schedule({
        projectId,
        origin: 'simulated',
        parcelIds: [id],
        revisions: [{ day: DAY, units: 12, stories }]
      });
    const { ctx, gen } = makeCtx();
    massingFor(mk('SIM:a', 4), 0, ctx);
    massingFor(mk('SIM:b', 4), 0, ctx);
    expect(gen).toHaveBeenCalledTimes(1);
    massingFor(mk('SIM:a', 5), 0, ctx);
    expect(gen).toHaveBeenCalledTimes(2);
    expect(ctx.memo.get(simKey(id, 4))).toBeDefined();
  });

  it('pipeline projects hit the memo across seeds and inputs, and a cleared memo regenerates', () => {
    const { ctx, genForUnits } = makeCtx();
    massingsFor(pairSchedule(), ctx);
    expect(genForUnits).toHaveBeenCalledTimes(3);
    massingsFor(pairSchedule(), ctx);
    expect(genForUnits).toHaveBeenCalledTimes(3);
    ctx.memo.clear();
    massingsFor(pairSchedule(), ctx);
    expect(genForUnits).toHaveBeenCalledTimes(6);
  });

  it('the pipeline memo key includes the parcel ids', () => {
    const { ctx, genForUnits } = makeCtx();
    massingFor(pairSchedule(), 1, ctx);
    massingFor(pairSchedule({ parcelIds: [MINI_SAME_CELL_PAIR[0]] }), 1, ctx);
    expect(genForUnits).toHaveBeenCalledTimes(2);
    massingFor(pairSchedule({ parcelIds: [...MINI_SAME_CELL_PAIR].reverse() }), 1, ctx);
    expect(genForUnits).toHaveBeenCalledTimes(2);
  });

  it('entries stay index-aligned with revisions', () => {
    const { ctx } = makeCtx();
    const s = pairSchedule();
    const out = massingsFor(s, ctx);
    expect(out).toHaveLength(s.revisions.length);
    out.forEach((m, k) => expect(m).toEqual(massingFor(s, k, ctx)));
  });
});

describe('massingFor: multi-phase rows', () => {
  const unphased = () =>
    schedule({
      projectId: 'CASE:unphased',
      parcelIds: ['3600001', '3600002'],
      multiPhase: true,
      phase: null
    });

  it('an unphased multi-phase row gets a footprint for every revision and no generator call', () => {
    const { ctx, gen, genForUnits } = makeCtx();
    const s = unphased();
    const fp = footprintOf(footprintParcel([rec('3600001'), rec('3600002')]));
    const out = massingsFor(s, ctx);
    expect(out).toEqual(s.revisions.map(() => fp));
    expect(gen).not.toHaveBeenCalled();
    expect(genForUnits).not.toHaveBeenCalled();
  });

  it('phases are massed with generateForUnits on their own parcels and project id', () => {
    const phased = simulate(input, 3, MINI_HORIZON).filter((s) => s.phase !== null);
    expect(phased.length).toBeGreaterThan(0);
    const { ctx, genForUnits } = makeCtx();
    for (const s of phased) {
      const m = massingFor(s, 0, ctx);
      const call = genForUnits.mock.calls.at(-1)!;
      const own = [...s.parcelIds].sort().map(rec);
      expect(call[0]).toEqual(own);
      expect(call[1]).toBe(s.revisions[0].units);
      expect(call[2]).toBe(s.revisions[0].stories ?? MAX_STORIES);
      expect(call[3]).toBe(fnv1a32(s.projectId));
      if ('parts' in m) expect(m.source).toBe('pipeline');
    }
    expect(genForUnits).toHaveBeenCalledTimes(phased.length);
  });
});

describe('failures, logging and packing', () => {
  const throwing = () => {
    throw new Error('generator exploded');
  };

  it('a throwing genForUnits gives a footprint for every revision; packTimedCell accepts them', () => {
    const { ctx, logged } = makeCtx({ genForUnits: throwing });
    const s = pairSchedule();
    const out = massingsFor(s, ctx);
    const fp = footprintOf(footprintParcel(MINI_SAME_CELL_PAIR.map(rec)));
    expect(out).toEqual(s.revisions.map(() => fp));
    const pick = footprintParcel(MINI_SAME_CELL_PAIR.map(rec)).id;
    const cell = packTimedCell('50_25', [{ schedule: s, massings: out, pickParcelId: pick }]);
    expect(cell.partCount).toBe(s.revisions.length);
    expect(logged).toHaveLength(1);
  });

  it('logs once per project across massingsFor calls and a memo-cleared ctx', () => {
    const sink: string[] = [];
    const seen = new Set<string>();
    const logOnce = (id: string, msg: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      sink.push(msg);
    };
    const a = makeCtx({ genForUnits: throwing, logOnce }).ctx;
    const s = pairSchedule();
    massingsFor(s, a);
    massingsFor(s, a);
    expect(sink).toHaveLength(1);
    const b = makeCtx({ genForUnits: throwing, logOnce }).ctx; // fresh memo, same logger
    massingsFor(s, b);
    expect(sink).toHaveLength(1);
    massingsFor(pairSchedule({ projectId: 'PRJ:other' }), b);
    expect(sink).toHaveLength(2);
  });

  it('a throw is not memoised', () => {
    const { ctx } = makeCtx({ genForUnits: throwing });
    massingFor(pairSchedule(), 1, ctx);
    expect(ctx.memo.size).toBe(0);
  });

  it('a simulated project missing a scenario row falls back to its footprint', () => {
    const { ctx, logged, gen } = makeCtx({
      input: { ...input, parcels: { ...input.parcels, index: new Map() } }
    });
    const s = schedule({
      projectId: 'SIM:x',
      origin: 'simulated',
      parcelIds: ['3512012'],
      revisions: [{ day: DAY, units: 12, stories: 4 }]
    });
    expect(massingFor(s, 0, ctx)).toEqual(footprintOf(rec('3512012')));
    expect(gen).not.toHaveBeenCalled();
    expect(logged).toHaveLength(1);
  });

  it('throws when no parcel record is loaded at all', () => {
    const { ctx } = makeCtx({ records: () => undefined });
    expect(() => massingFor(pairSchedule(), 0, ctx)).toThrow(/no loaded parcel records/);
  });

  /** The vertex count of the first part of a packed single-footprint cell. */
  function packedVertices(ring: [number, number][]): number {
    const r = rec('0026T003');
    const odd: ParcelRecord = { ...r, polygon: [ring] };
    const s = pairSchedule({ parcelIds: [r.id] });
    const { ctx } = makeCtx({
      records: (id) => (id === r.id ? odd : undefined),
      genForUnits: throwing
    });
    const massings = massingsFor(s, ctx);
    const cell = packTimedCell('50_25', [{ schedule: s, massings, pickParcelId: r.id }]);
    const f = localFrame(odd.labelPoint);
    const expected = normaliseRing(ring.map(([x, y]) => f.to(x, y))).length;
    expect(cell.startIndices[1] - cell.startIndices[0]).toBe(expected);
    return cell.startIndices[1] - cell.startIndices[0];
  }

  it('an open stored ring is closed once by packing', () => {
    const ring: [number, number][] = [
      [-5, -5],
      [5, -5],
      [5, 5],
      [-5, 5]
    ];
    expect(packedVertices(ring)).toBe(5);
  });

  it('a closed stored ring is passed as stored and packs to the same count, not one more', () => {
    const ring: [number, number][] = [
      [-5, -5],
      [5, -5],
      [5, 5],
      [-5, 5],
      [-5, -5]
    ];
    const r = { ...rec('0026T003'), polygon: [ring] };
    expect(footprintOf(r).footprint).toHaveLength(ring.length); // never reopened
    expect(packedVertices(ring)).toBe(normaliseRing(footprintOf(r).footprint).length);
    expect(packedVertices(ring)).toBe(5);
  });
});

describe('simulated massing on the scenario record (IA-8)', () => {
  it('uncapped revision-0 buildings hold the drawn yield, from the T11 record', () => {
    const parcels = input.parcels;
    let checked = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const sims = simulate(input, seed, MINI_HORIZON).filter((s) => s.origin === 'simulated');
      const { ctx, gen } = makeCtx();
      for (const s of sims) {
        const i = parcels.index.get(s.parcelIds[0])!;
        if (parcels.baseCap[i] !== NO_CAP) continue;
        const m = massingFor(s, 0, ctx);
        expect('parts' in m).toBe(true);
        if (!('parts' in m)) continue;
        expect(m.units).toBe(s.revisions[0].units);
        // The building never exceeds the drawn level's stories; it can fall short when the
        // typology's volume saturates (see the all-levels test below).
        expect(m.stories).toBeLessThanOrEqual(s.revisions[0].stories!);
        expect(m.source).toBe('scenario');
        checked++;
      }
      for (const call of gen.mock.calls) {
        const i = parcels.index.get(call[0].id)!;
        expect(call[0].existingUnits).toBe(parcels.existingUnits[i]);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('every uncapped parcel at every fill level holds exactly yield[f] units', () => {
    const parcels = input.parcels;
    const { ctx } = makeCtx();
    let exact = 0;
    let compared = 0;
    for (let i = 0; i < parcels.count; i++) {
      if (parcels.baseCap[i] !== NO_CAP) continue;
      const id = parcels.id[i];
      for (let f = 0; f < FILL_LEVELS.length; f++) {
        const y = parcels.yield[i * FILL_LEVELS.length + f];
        if (y === 0) continue;
        const stories = fillStories(FILL_LEVELS[f], parcels.envelopeStories[i]);
        const s = schedule({
          projectId: `SIM:${id}`,
          origin: 'simulated',
          parcelIds: [id],
          revisions: [{ day: DAY, units: y, stories }]
        });
        const m = massingFor(s, 0, ctx);
        if (!('parts' in m)) throw new Error(`${id} f${f}: no building`);
        expect(m.units).toBe(y);
        expect(m.stories).toBeLessThanOrEqual(stories);
        if (m.stories === stories) exact++;
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(50);
    expect(exact).toBeGreaterThan(0);
  });
});
