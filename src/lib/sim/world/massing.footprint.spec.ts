import { describe, expect, it, vi } from 'vitest';
import type { ParcelId, ParcelRecord } from '$lib/data/parcel';
import { fnv1a32, generate, generateForm, generateForUnits } from '$lib/generator';
import { MAX_STORIES } from '$lib/generator/constants';
import { localFrame } from '$lib/generator/geo';
import { rect } from '$lib/generator/fixtures/district';
import { normaliseRing } from '$lib/map/pack';
import { packTimedCell } from '$lib/map/pack-timed';
import { parseCalibration } from '$lib/timelapse/model';
import { parseProjectsFile } from '$lib/timelapse/projects';
import type { Calibration } from '$lib/timelapse/types';
import { createLru } from '../lru';
import { miniOptions } from './fixtures/mini-options';
import { miniCity, MINI_SAME_CELL_PAIR } from './fixtures/mini-parcels';
import miniCalibrationJson from './fixtures/mini-calibration.json';
import { MINI_AS_OF, miniProjectsJson } from './fixtures/mini-projects';
import { buildSimInput } from './input/build';
import {
  cellAnchorParcel,
  footprintOf,
  footprintParcel,
  massingFor,
  districtOptsFor,
  pipeKey,
  simKey,
  type MassingCtx
} from './massing';
import type { Massing, Schedule, SimInput } from './input/types';
import { BUILDING_FORMS } from '$lib/sim/choice/types';

const city = miniCity();
const input: SimInput = buildSimInput({
  parcels: city.parcels,
  projects: parseProjectsFile(miniProjectsJson(), { onInvalid() {} }),
  calibration: parseCalibration(structuredClone(miniCalibrationJson) as unknown) as Calibration,
  options: miniOptions(city)
});

/** `massingFor` for every revision, index-aligned with `schedule.revisions`. */
const massingsFor = (schedule: Schedule, ctx: MassingCtx): Massing[] =>
  schedule.revisions.map((_, k) => massingFor(schedule, k, ctx));

const rec = (id: ParcelId): ParcelRecord => {
  const r = city.records.get(id);
  if (!r) throw new Error(`no record ${id}`);
  return r;
};

/** A ctx over the mini chunks with spies on both generator entry points. */
function makeCtx(over: Partial<MassingCtx> = {}) {
  const gen = vi.fn(generate);
  const genForUnits = vi.fn(generateForUnits);
  const genForm = vi.fn(generateForm);
  const logged: string[] = [];
  const seen = new Set<string>();
  const ctx: MassingCtx = {
    input,
    records: (id) => city.records.get(id),
    memo: createLru(1000),
    gen,
    genForUnits,
    genForm,
    // The ctx owns the once-per-project rule; this is a faithful stand-in.
    logOnce(projectId, msg) {
      if (seen.has(projectId)) return;
      seen.add(projectId);
      logged.push(msg);
    },
    ...over
  };
  return { ctx, gen, genForUnits, genForm, logged };
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

/** A simulated revision at option f of the lot's row: its homes, stories and index. */
const optionRev = (id: ParcelId, f: number) => {
  const t = input.options;
  const j = t.offset[city.parcels.index.get(id)!] + f;
  return { day: DAY, units: t.homes[j], stories: t.stories[j], option: f };
};

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
    expect(simKey('0026T003', 'tower', 20, 2)).toBe('s|0026T003|tower|20|2');
    expect(pipeKey(5, 40, 6, ['b', 'a'], {})).toBe('p|5|40|6|a,b|-|-|-');
    expect(pipeKey(5, 40, null, ['a'], { storyLimit: 9, curatedStories: 6 })).toBe(
      'p|5|40|-|a|9|6|-'
    );
  });

  it('the pipeline key sorts and de-duplicates the parcel ids', () => {
    expect(pipeKey(1, 2, 3, ['c', 'a', 'b', 'a'], {})).toBe(pipeKey(1, 2, 3, ['a', 'b', 'c'], {}));
    expect(pipeKey(1, 2, 3, ['a', 'b'], {})).not.toBe(pipeKey(1, 2, 3, ['a', 'c'], {}));
    expect(pipeKey(1, 2, 3, ['a'], {})).not.toBe(pipeKey(1, 2, null, ['a'], {}));
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
    const opts = districtOptsFor(s, ctx);
    expect(ctx.memo.get(pipeKey(fnv1a32('BP:one'), 1, null, ['0026T013'], opts))).toBeNull();
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
      6,
      districtOptsFor(s, ctx)
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
      undefined,
      districtOptsFor(pairSchedule(), ctx)
    );
  });

  it("a simulated project is massed on the scenario record at its option's form and stories", () => {
    const id = '3512012'; // chunk says 1 existing unit, T11 says 2
    const i = city.parcels.index.get(id)!;
    const t = input.options;
    const s = schedule({
      projectId: `SIM:${id}`,
      origin: 'simulated',
      parcelIds: [id],
      revisions: [optionRev(id, 0)]
    });
    const { ctx, gen, genForm } = makeCtx();
    const m = massingFor(s, 0, ctx);
    expect(gen).not.toHaveBeenCalled();
    expect(genForm).toHaveBeenCalledTimes(1);
    const [recArg, form, stories, seed] = genForm.mock.calls[0];
    expect(rec(id).existingUnits).not.toBe(city.parcels.existingUnits[i]);
    expect(recArg.existingUnits).toBe(city.parcels.existingUnits[i]);
    expect(recArg.existingFloorAreaM2).toBe(city.parcels.existingFloorAreaM2[i]);
    expect(form).toBe(BUILDING_FORMS[t.form[t.offset[i]]]);
    expect(stories).toBe(t.stories[t.offset[i]]);
    expect(seed).toBe(fnv1a32(id));
    expect('parts' in m && m.source).toBe('scenario');
  });

  it('the simulated memo is keyed by the option, not by seed or project', () => {
    const id = '3512012';
    const t = input.options;
    const j = t.offset[city.parcels.index.get(id)!];
    expect(t.offset[city.parcels.index.get(id)! + 1] - j).toBeGreaterThan(1);
    const mk = (projectId: string, f: number) =>
      schedule({ projectId, origin: 'simulated', parcelIds: [id], revisions: [optionRev(id, f)] });
    const { ctx, genForm } = makeCtx();
    massingFor(mk('SIM:a', 0), 0, ctx);
    massingFor(mk('SIM:b', 0), 0, ctx);
    expect(genForm).toHaveBeenCalledTimes(1);
    massingFor(mk('SIM:a', 1), 0, ctx);
    expect(genForm).toHaveBeenCalledTimes(2);
    expect(
      ctx.memo.get(simKey(id, BUILDING_FORMS[t.form[j]], t.stories[j], t.plates[j]))
    ).toBeTruthy();
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

  /** A 40 ha (800 × 500 m) parcel: a district site (spec §4.1). */
  const BIG: ParcelRecord = {
    ...rec('3600001'),
    id: '3600099',
    polygon: rect(800, 500),
    areaM2: 400_000
  };
  const bigRecords = new Map(city.records).set(BIG.id, BIG);
  const master = () =>
    schedule({
      projectId: 'CASE:unphased',
      parcelIds: [BIG.id],
      multiPhase: true,
      phase: null,
      revisions: [{ day: DAY, units: 1500, stories: null }]
    });

  it('a master without phases with free parcels is massed', () => {
    const { ctx, genForUnits } = makeCtx({ records: (id) => bigRecords.get(id) });
    const s = master();
    const m = massingFor(s, 0, ctx);
    expect(genForUnits).toHaveBeenCalledWith(
      [BIG],
      1500,
      MAX_STORIES,
      fnv1a32('CASE:unphased'),
      undefined,
      districtOptsFor(s, ctx)
    );
    expect('parts' in m).toBe(true);
    if (!('parts' in m)) return;
    expect(m.source).toBe('pipeline');
    expect(m.lots?.length).toBeGreaterThan(1);
  });

  it('an unphased row on the mini parcels calls the generator for every revision', () => {
    const { ctx, genForUnits } = makeCtx();
    const s = unphased();
    massingsFor(s, ctx);
    expect(genForUnits).toHaveBeenCalledTimes(s.revisions.length);
  });

  it('a null generator still gives the footprint', () => {
    const { ctx } = makeCtx({ records: (id) => bigRecords.get(id), genForUnits: () => null });
    const s = master();
    expect(massingsFor(s, ctx)).toEqual(s.revisions.map(() => footprintOf(BIG)));
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
    const { ctx, logged, genForm } = makeCtx({
      input: { ...input, parcels: { ...input.parcels, index: new Map() } }
    });
    const s = schedule({
      projectId: 'SIM:x',
      origin: 'simulated',
      parcelIds: ['3512012'],
      revisions: [optionRev('3512012', 0)]
    });
    expect(massingFor(s, 0, ctx)).toEqual(footprintOf(rec('3512012')));
    expect(genForm).not.toHaveBeenCalled();
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
  it("draws every option of every lot, holding exactly the option's homes at its stories", () => {
    const parcels = input.parcels;
    const t = input.options;
    const { ctx } = makeCtx();
    let compared = 0;
    for (let i = 0; i < parcels.count; i++) {
      const id = parcels.id[i];
      if (!city.records.has(id)) continue;
      for (let f = 0; f < t.offset[i + 1] - t.offset[i]; f++) {
        const j = t.offset[i] + f;
        const s = schedule({
          projectId: `SIM:${id}`,
          origin: 'simulated',
          parcelIds: [id],
          revisions: [{ day: DAY, units: t.homes[j], stories: t.stories[j], option: f }]
        });
        const m = massingFor(s, 0, ctx);
        if (!('parts' in m)) throw new Error(`option ${f} of ${id} draws no building`);
        expect(m.units).toBe(t.homes[j]);
        expect(m.stories).toBe(t.stories[j]);
        expect(m.plates ?? 0).toBe(t.plates[j]);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(50);
  });
});
