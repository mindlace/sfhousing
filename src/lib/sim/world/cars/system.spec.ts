// The car system on the mini city: what each event does to the pending homes, the zone month,
// the refresh schedule, the snapshot, and the order of the timeline views.
import { describe, expect, it } from 'vitest';
import { CAR_LEVELS, MIXES, refreshTable } from '$lib/sim/cars';
import { inclusionaryUnits } from '$lib/sim/finance/tiers';
import type { InFlightProject } from '$lib/timelapse/projects';
import { addProject, pushRev } from '../columns';
import type { PolicyTimeline } from '../policy/frame';
import { staticsOf, type Statics } from '../statics';
import { miniInput } from '../test/mini';
import { Recorder, runWorld } from '../test/run';
import { frameOf, oneFrame } from '../test/timeline';
import {
  ORIGIN_MASTER,
  ORIGIN_PIPELINE,
  ORIGIN_SIM,
  type CarSystem,
  type FundingSystem,
  type StepCtx,
  type World
} from '../types';
import { withFunding } from '../world';
import { carSnapshotOf, type CarColumns } from './columns';
import { createCarSystem } from './system';
import { carCity } from './test/city';

const L = CAR_LEVELS;
const NM = MIXES.length;
const M = MIXES.indexOf('market');
const VL = MIXES.indexOf('veryLow');
const LO = MIXES.indexOf('low');
const MO = MIXES.indexOf('moderate');
const input = miniInput();
const statics = staticsOf(input);
const timeline = oneFrame(frameOf(input));
const city = carCity(input, { zones: 3, noZoneEvery: 9 });
const SEED = 4;

function created(sys: CarSystem, st: Statics = statics): World {
  return withFunding(null, sys).createWorld(st, timeline, SEED, { event() {} });
}

const placedLot = (z: number) => city.data.lotZone.findIndex((v) => v === z);
const zoneTotal = (c: CarColumns, z: number) => {
  let n = 0;
  for (let i = z * c.types * L; i < (z + 1) * c.types * L; i++) n += c.hh[i];
  return n;
};

/** A started row on `lot` (or pipeline project `k`) with `units` homes and `existing` lost. */
function addRow(
  w: World,
  o: { origin: number; src: number; units: number; existing?: number; kind?: number }
): number {
  const row = addProject(w.projects);
  const q = w.projects;
  q.origin[row] = o.origin;
  q.src[row] = o.src;
  q.units[row] = o.units;
  q.existing[row] = o.existing ?? 0;
  q.kind[row] = o.kind ?? 0;
  q.stream[row] = 0x1234567 + row;
  pushRev(q, row, statics.asOf + 10, o.units, null);
  return row;
}

describe('events into pending homes', () => {
  const day = statics.asOf + 100;

  it('a market start fills u - onSite market homes and the inclusionary tiers', () => {
    const sys = createCarSystem(city.data, city.model);
    const w = created(sys);
    const z = 1;
    const row = addRow(w, { origin: ORIGIN_SIM, src: placedLot(z), units: 40 });
    sys.onEvent(w, statics, { kind: 'end', row, day, how: 'complete' });
    const inc = inclusionaryUnits(40);
    const at = z * NM;
    const c = w.cars!;
    expect(inc.veryLow + inc.low + inc.moderate).toBeGreaterThan(0);
    expect(c.pendFill[at + M]).toBe(40 - inc.veryLow - inc.low - inc.moderate);
    expect(c.pendFill[at + VL]).toBe(inc.veryLow);
    expect(c.pendFill[at + LO]).toBe(inc.low);
    expect(c.pendFill[at + MO]).toBe(inc.moderate);
  });

  it('an affordable row splits by affordableTiers, none to market', () => {
    const sys = createCarSystem(city.data, city.model);
    const w = created(sys);
    const z = 0;
    const row = addRow(w, { origin: ORIGIN_SIM, src: placedLot(z), units: 50, kind: 1 });
    sys.onEvent(w, statics, { kind: 'end', row, day, how: 'complete' });
    const c = w.cars!;
    const a = city.model.newHomes.affordableTiers;
    expect(c.pendFill[M]).toBe(0);
    expect(c.pendFill[VL] + c.pendFill[LO] + c.pendFill[MO]).toBe(50);
    expect(Math.abs(c.pendFill[VL] - 50 * a.veryLow)).toBeLessThan(1);
    expect(Math.abs(c.pendFill[LO] - 50 * a.low)).toBeLessThan(1);
    expect(Math.abs(c.pendFill[MO] - 50 * a.moderate)).toBeLessThan(1);
  });

  it('a construction start loses the row’s existing homes; exits and other stages nothing', () => {
    const sys = createCarSystem(city.data, city.model);
    const w = created(sys);
    const row = addRow(w, { origin: ORIGIN_SIM, src: placedLot(2), units: 12, existing: 3 });
    sys.onEvent(w, statics, { kind: 'enter', row, day, stage: 'permitIssued' });
    sys.onEvent(w, statics, { kind: 'end', row, day, how: 'exit' });
    expect(w.cars!.pendLost[2]).toBe(0);
    sys.onEvent(w, statics, { kind: 'enter', row, day, stage: 'construction' });
    expect(w.cars!.pendLost[2]).toBe(3);
    expect(w.cars!.pendFill.every((v) => v === 0)).toBe(true);
  });

  it('a revised row fills its final units at completion', () => {
    const sys = createCarSystem(city.data, city.model);
    const w = created(sys);
    const row = addRow(w, { origin: ORIGIN_SIM, src: placedLot(0), units: 8 });
    pushRev(w.projects, row, statics.asOf + 20, 6, null);
    sys.onEvent(w, statics, { kind: 'end', row, day, how: 'complete' });
    let sum = 0;
    for (let k = 0; k < NM; k++) sum += w.cars!.pendFill[k];
    expect(sum).toBe(6);
  });

  it('a pipeline row fills the market mix in its first lot’s zone', () => {
    const sys = createCarSystem(city.data, city.model);
    const w = created(sys);
    const k = statics.projects.findIndex((p) => p.parcelIds.length > 0);
    const lot = statics.parcelId.indexOf(statics.projects[k].parcelIds[0]);
    const z = city.data.lotZone[lot];
    const row = addRow(w, { origin: ORIGIN_PIPELINE, src: k, units: 30 });
    sys.onEvent(w, statics, { kind: 'end', row, day, how: 'complete' });
    if (z < 0) expect(w.cars!.unplaced).toBe(30);
    else expect(w.cars!.pendFill[z * NM + M]).toBe(30);
  });

  it('counts homes with no zone as unplaced and does not throw (Review Focus 1)', () => {
    const ghost = { ...statics.projects[0], id: 'ghost', parcelIds: ['no-such-lot'] };
    const st: Statics = { ...statics, projects: [...statics.projects, ghost as InFlightProject] };
    const sys = createCarSystem(city.data, city.model);
    const w = created(sys, st);
    const noZone = city.data.lotZone.indexOf(-1);
    expect(noZone).toBeGreaterThanOrEqual(0);
    const a = addRow(w, { origin: ORIGIN_SIM, src: noZone, units: 7, existing: 2 });
    const b = addRow(w, { origin: ORIGIN_PIPELINE, src: st.projects.length - 1, units: 5 });
    expect(() => {
      sys.onEvent(w, st, { kind: 'enter', row: a, day, stage: 'construction' });
      sys.onEvent(w, st, { kind: 'end', row: a, day, how: 'complete' });
      sys.onEvent(w, st, { kind: 'end', row: b, day, how: 'complete' });
    }).not.toThrow();
    expect(w.cars!.unplaced).toBe(14);
    expect(w.cars!.pendFill.every((v) => v === 0)).toBe(true);
  });
});

describe('the zone month', () => {
  const ctxOf = (w: World, month: number) => ({ world: w, month, seed: SEED }) as StepCtx;

  it('removing 10 homes from a zone of 4 households leaves 0 and 6 unmatched', () => {
    const full = carCity(input, { zones: 3, occupied: 1 });
    const sys = createCarSystem(full.data, full.model);
    const w = created(sys);
    const c = w.cars!;
    const z = 1;
    c.hh.fill(0, z * c.types * L, (z + 1) * c.types * L);
    c.hh[z * c.types * L + 1] = 4;
    c.pendLost[z] = 10;
    w.month = 1;
    sys.step(ctxOf(w, 2));
    expect(zoneTotal(c, z)).toBe(0);
    expect(c.unmatched).toBe(6);
    expect(c.pendLost.every((v) => v === 0)).toBe(true);
  });

  it('turns pending homes into occupied x homes households, rounded', () => {
    const sys = createCarSystem(city.data, city.model);
    const w = created(sys);
    const c = w.cars!;
    const before = [0, 1, 2].map((z) => zoneTotal(c, z));
    c.pendFill[0 * NM + M] = 100;
    c.pendFill[2 * NM + LO] = 10;
    c.pendLost[1] = 20;
    sys.step(ctxOf(w, 1));
    const occ = city.data.occupied;
    const got = [0, 1, 2].map((z) => zoneTotal(c, z) - before[z]);
    expect(Math.abs(got[0] - 100 * occ[0])).toBeLessThan(1);
    expect(Math.abs(got[1] + 20 * occ[1])).toBeLessThan(1);
    expect(Math.abs(got[2] - 10 * occ[2])).toBeLessThan(1);
    expect(c.pendFill.every((v) => v === 0)).toBe(true);
  });
});

describe('refresh, snapshot and the world', () => {
  it('computes the table and base at create and refreshes them in months 13, 25, ...', () => {
    const sys = createCarSystem(city.data, city.model);
    const api = withFunding(null, sys);
    const w = api.createWorld(statics, timeline, SEED, { event() {} });
    const c0 = structuredClone(w.cars!);
    expect(c0.tableMonth).toBe(0);
    const t0 = structuredClone(c0);
    refreshTable(t0, city.model, city.data);
    expect(Array.from(c0.table)).toEqual(Array.from(t0.table));
    expect(Array.from(c0.base)).toEqual(Array.from(c0.spaces));
    expect(c0.base.every((v) => v > 0)).toBe(true);
    const due = api.planDue(w, statics, timeline, SEED, 40);
    const months: number[] = [];
    let before12: CarColumns | null = null;
    for (let m = 1; m <= 40; m++) {
      if (m === 13) before12 = structuredClone(w.cars!);
      api.step(w, due, statics, timeline, SEED, { event() {} });
      months.push(w.cars!.tableMonth);
      if (m === 13) {
        refreshTable(before12!, city.model, city.data);
        expect(Array.from(w.cars!.table)).toEqual(Array.from(before12!.table));
      }
    }
    expect(months).toEqual(
      months.map((_, i) => (i + 1 < 13 ? 0 : i + 1 < 25 ? 13 : i + 1 < 37 ? 25 : 37))
    );
    expect(Array.from(w.cars!.base)).toEqual(Array.from(c0.base));
  });

  it('reports totals, NaN-free zones while populated, and spaces per home only in start months', () => {
    expect(carSnapshotOf(runWorld(statics, timeline, SEED, 3))).toBeNull();
    const sys = createCarSystem(city.data, city.model);
    const api = withFunding(null, sys);
    const rec = new Recorder();
    const w = api.createWorld(statics, timeline, SEED, rec);
    const due = api.planDue(w, statics, timeline, SEED, 240);
    let withStarts = 0;
    for (let m = 1; m <= 240; m++) {
      rec.month = m;
      api.step(w, due, statics, timeline, SEED, rec);
      const s = carSnapshotOf(w)!;
      const starts = rec.events.filter(
        (e) => e.month === m && e.kind === 'start' && w.projects.origin[e.row] !== ORIGIN_MASTER
      );
      const placed = starts.filter(
        (e) =>
          w.projects.origin[e.row] === ORIGIN_SIM && city.data.lotZone[w.projects.src[e.row]] >= 0
      );
      if (placed.length > 0) {
        withStarts++;
        expect(s.spacesPerHome).toBeGreaterThan(0);
      } else if (starts.length === 0) expect(s.spacesPerHome).toBeNull();
      expect(s.households).toBeGreaterThan(0);
      expect(s.carless).toBeLessThanOrEqual(s.households);
      expect(s.zones.length).toBe(3);
    }
    expect(withStarts).toBeGreaterThan(0);
  });
});

describe('the timeline views', () => {
  /** A delegating timeline that names itself. */
  const tagged = (base: PolicyTimeline, tag: string): PolicyTimeline & { tag: string } => ({
    tag,
    frameAt: (m) => base.frameAt(m),
    changes: () => base.changes(),
    touched: (m) => base.touched(m),
    readyThrough: () => base.readyThrough()
  });

  it('lays cars.timelineOf first and funding’s view over it, in step and in planDue', () => {
    const inner = createCarSystem(city.data, city.model);
    const seen: { step: string[]; carsGot: PolicyTimeline[] } = { step: [], carsGot: [] };
    const cars: CarSystem = {
      create: (w, s) => inner.create(w, s),
      onEvent: (w, s, e) => inner.onEvent(w, s, e),
      step(ctx) {
        seen.step.push((ctx.timeline as { tag?: string }).tag ?? 'base');
        inner.step(ctx);
      },
      timelineOf(_w, _s, t) {
        seen.carsGot.push(t);
        return tagged(t, 'cars');
      }
    };
    const got: { before: string[]; plan: string[] } = { before: [], plan: [] };
    const nothing = () => {};
    const f: FundingSystem = {
      create: nothing,
      policyChanged: nothing,
      moneyIn: nothing,
      onProjectEvent: nothing,
      apply: nothing,
      serve: nothing,
      shadow: nothing,
      planLot: () => 0,
      beforeStep(_w, _s, t) {
        got.before.push((t as { tag?: string }).tag ?? 'base');
        return tagged(t, 'funding');
      },
      timelineOf(_w, _s, t) {
        got.plan.push((t as { tag?: string }).tag ?? 'base');
        return tagged(t, 'funding');
      }
    };
    const api = withFunding(f, cars);
    const w = api.createWorld(statics, timeline, SEED, { event() {} });
    const due = api.planDue(w, statics, timeline, SEED, 3);
    for (let m = 1; m <= 3; m++) api.step(w, due, statics, timeline, SEED, { event() {} });
    expect(got.plan).toEqual(['cars']);
    expect(got.before).toEqual(['cars', 'cars', 'cars']);
    expect(seen.step).toEqual(['funding', 'funding', 'funding']);
    expect(seen.carsGot.every((t) => t === timeline)).toBe(true);
    expect(seen.carsGot).toHaveLength(4);
  });

  it('without funding, the step runs under the car system’s timeline', () => {
    const inner = createCarSystem(city.data, city.model);
    const tags: string[] = [];
    const cars: CarSystem = {
      ...inner,
      create: (w, s) => inner.create(w, s),
      step(ctx) {
        tags.push((ctx.timeline as { tag?: string }).tag ?? 'base');
        inner.step(ctx);
      },
      timelineOf: (_w, _s, t) => tagged(t, 'cars')
    };
    const api = withFunding(null, cars);
    const w = api.createWorld(statics, timeline, SEED, { event() {} });
    const due = api.planDue(w, statics, timeline, SEED, 2);
    for (let m = 1; m <= 2; m++) api.step(w, due, statics, timeline, SEED, { event() {} });
    expect(tags).toEqual(['cars', 'cars']);
  });

  it('returns the very timeline it is given (Task 8: no parking frames yet)', () => {
    const sys = createCarSystem(city.data, city.model);
    const w = created(sys);
    expect(sys.timelineOf(w, statics, timeline)).toBe(timeline);
    const off = createCarSystem(city.data, city.model, { link: false });
    expect(off.timelineOf(w, statics, timeline)).toBe(timeline);
  });
});
