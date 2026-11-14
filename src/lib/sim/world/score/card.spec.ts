// `cardAt` (rule 14): the project card from world 1 on the fixture city, and the lot-limits line
// from a compiled timeline on the mini city.
import { beforeAll, describe, expect, it } from 'vitest';
import type { ParcelId } from '$lib/data/parcel';
import { envelopeOf } from '$lib/data/scenario-codec';
import type { Master } from '$lib/sim/scenario/simulate';
import { chooseProject, projectCard, type CardCtx } from '$lib/sim/scenario/card';
import type { Massing, SimInput } from '$lib/sim/scenario/types';
import { customQuery, queryKey, type CustomBrush } from '$lib/sim-page/policy';
import type { Effect, Policy } from '$lib/timeline/policy4';
import type { Day } from '$lib/timelapse/time';
import { STAGE_ORDER } from '$lib/timelapse/types';
import { createWorld } from '../index';
import { compileTimeline } from '../policy/compile';
import type { PolicyFrame, PolicyTimeline } from '../policy/frame';
import { limitsOf } from '../policy/limits';
import { lookupsAt, newScale } from '../policy/lookups';
import { miniCompileCtx } from '../policy/test/compile-fixtures';
import { miniDoc, span } from '../policy/test/fixtures';
import { masterAt, scheduleAt } from '../read';
import { staticsOf, type Statics } from '../statics';
import { fundedMini, oneMoneyTimeline, runFunded } from '../funding/test/fixtures';
import { fixtureInput } from '../test/cities.node';
import { horizonMonth, runWorld } from '../test/run';
import { frameOf, oneFrame } from '../test/timeline';
import {
  NO_DAY,
  ORIGIN_MASTER,
  ORIGIN_PHASE,
  ORIGIN_PIPELINE,
  ORIGIN_SIM,
  type World
} from '../types';
import { cardAt } from './card';
import type { CardDeps } from './types';

const S = STAGE_ORDER.length;
/** The host's `NOT_DRAWN`: a footprint with no ring. */
const NOT_DRAWN: Massing = { footprint: [] };
const BUILDABLE = 3;

function depsOf(eligible: boolean): CardDeps {
  return {
    qualityRules: new Map(),
    building: () => NOT_DRAWN,
    logOnce() {},
    record: () => ({ neighborhood: 'Hood', landUse: 'Use', eligible, existingUnits: 0 }),
    buildable: () => BUILDABLE
  };
}

describe('cardAt on the fixture (one frame, seed 1)', () => {
  let input: SimInput;
  let statics: Statics;
  let frame: PolicyFrame;
  let world: World;
  const deps = depsOf(false);

  beforeAll(async () => {
    input = await fixtureInput();
    statics = staticsOf(input);
    frame = frameOf(input);
    world = runWorld(statics, oneFrame(frame), 1, horizonMonth(input.asOf));
  });

  /** A `CardCtx` built here from the frame, independently of `cardAt`. */
  function ctxAt(day: Day): CardCtx {
    const p = world.projects;
    const masters = new Map<string, Master>();
    for (let r = 0; r < p.n; r++) {
      const m = masterAt(world, statics, r, day);
      if (m) masters.set(m.masterId, m);
    }
    return {
      asOf: input.asOf,
      input: {
        ...input,
        parcels: frame.view.parcels,
        calibration: frame.calibration,
        inFlightScale: frame.speed,
        newProjects: { calibration: frame.newCalibration, scale: newScale(frame) }
      },
      rows: new Map(input.projects.map((x) => [x.id, x])),
      masters,
      qualityRules: deps.qualityRules,
      building: deps.building,
      logOnce: deps.logOnce
    };
  }

  /** The row of the first origin `o` with two entered stages, and those two days. */
  function rowWithTwoStages(o: number): { row: number; a: Day; b: Day; stageB: string } | null {
    const p = world.projects;
    for (let r = 0; r < p.n; r++) {
      if (p.origin[r] !== o) continue;
      const days: [Day, number][] = [];
      for (let s = 0; s < S; s++) {
        const d = p.entered[r * S + s];
        if (d !== NO_DAY) days.push([d, s]);
      }
      days.sort((x, y) => x[0] - y[0]);
      for (let k = 1; k < days.length; k++)
        if (days[k][0] > days[k - 1][0])
          return { row: r, a: days[k - 1][0], b: days[k][0], stageB: STAGE_ORDER[days[k][1]] };
    }
    return null;
  }

  it('a later stage appears only after its day', () => {
    const found = rowWithTwoStages(ORIGIN_SIM);
    expect(found).not.toBeNull();
    const { row, b, stageB } = found!;
    const p = world.projects;
    const parcelId = statics.parcelId[p.src[row]];
    const id = `sim:${parcelId}:${p.sub[row]}`;
    const before = cardAt(world, statics, frame, deps, parcelId, b - 1, id).summary.project!;
    expect(before.projectId).toBe(id);
    expect(before.stages.map((x) => x.stage)).not.toContain(stageB);
    const after = cardAt(world, statics, frame, deps, parcelId, b, id).summary.project!;
    expect(after.projectId).toBe(id);
    expect(after.stages).toContainEqual(expect.objectContaining({ stage: stageB, day: b }));
  });

  it('the card equals projectCard of the schedule read on that day', () => {
    let checked = 0;
    for (const o of [ORIGIN_PIPELINE, ORIGIN_PHASE]) {
      const found = rowWithTwoStages(o);
      expect(found, `origin ${o}`).not.toBeNull();
      const { row, b } = found!;
      for (const day of [b - 1, b]) {
        const s = scheduleAt(world, statics, row, day)!;
        const parcelId = s.parcelIds[0];
        const got = cardAt(world, statics, frame, deps, parcelId, day, s.projectId);
        const want = projectCard(chooseProject([s], day, s.projectId)!, day, ctxAt(day));
        expect(got.summary.project).toEqual(want);
        checked++;
      }
    }
    expect(checked).toBe(4);
  });

  it('the summary carries the record and the frame’s envelope', () => {
    const found = rowWithTwoStages(ORIGIN_SIM)!;
    const parcelId = statics.parcelId[world.projects.src[found.row]];
    const { summary } = cardAt(world, statics, frame, deps, parcelId, found.b);
    const i = frame.view.parcels.index.get(parcelId)!;
    const env = envelopeOf(frame.view.parcels, i);
    expect(summary).toMatchObject({
      parcelId,
      neighborhood: 'Hood',
      landUse: 'Use',
      eligible: false,
      existingUnits: frame.view.parcels.existingUnits[i],
      envelope: env.maxStories > 0 ? env : null,
      // NOT_DRAWN is a footprint: no building to describe
      generated: null
    });
    expect(summary.limits).toBeUndefined();
  });

  it('lookups are the frame’s tables for the cohort', () => {
    const found = rowWithTwoStages(ORIGIN_SIM)!;
    const p = world.projects;
    const parcelId = statics.parcelId[p.src[found.row]];
    const id = `sim:${parcelId}:${p.sub[found.row]}`;
    const got = cardAt(world, statics, frame, deps, parcelId, found.b, id);
    expect(got.summary.project!.lookups).toBe('fresh');
    expect(got.lookups).toBe(lookupsAt(frame).fresh);

    const used = new Set<ParcelId>();
    for (let r = 0; r < p.n; r++) {
      if (p.origin[r] === ORIGIN_SIM) used.add(statics.parcelId[p.src[r]]);
      else if (p.origin[r] !== ORIGIN_MASTER)
        for (const x of scheduleAt(world, statics, r, Number.MAX_SAFE_INTEGER)?.parcelIds ?? [])
          used.add(x);
    }
    const empty = statics.parcelId.find((x) => !used.has(x))!;
    expect(empty).toBeDefined();
    const none = cardAt(world, statics, frame, deps, empty, found.b);
    expect(none.summary.project).toBeUndefined();
    expect(none.lookups).toBeNull();
  });

  it('throws when the record is missing', () => {
    const missing: CardDeps = { ...deps, record: () => null };
    expect(() => cardAt(world, statics, frame, missing, statics.parcelId[0], input.asOf)).toThrow();
  });

  it('a hand-built frame has no limits attribution: an eligible lot throws', () => {
    const i = frame.view.parcels.envelopeStories.findIndex((x) => x > 0);
    expect(i).toBeGreaterThanOrEqual(0);
    const parcelId = frame.view.parcels.id[i];
    expect(() => cardAt(world, statics, frame, depsOf(true), parcelId, input.asOf)).toThrow(
      RangeError
    );
  });
});

// ---- limits, from a compiled timeline on the mini city ----

const CTX = miniCompileCtx({ windowMonths: 12 });
const stroke = (lng: number, radiusM: number) => ({
  path: [[lng, 37.7] as [number, number]],
  radiusM
});
const PAINT: CustomBrush = {
  id: 'paint',
  kind: 'paint',
  strokes: [stroke(-122.4, 50)],
  stories: 7
};
const PAINTED: ParcelId[] = ['2999A001', '2999A013', '3512005', '3600014', '3600016'];
const LOTS: Record<string, ParcelId[]> = { [queryKey(customQuery(PAINT))]: PAINTED };

/** A policy on the mini city's dates (the fixtures' builders use another dataset date). */
const pol = (id: string, where: Policy['where'], what: Effect, from = 1): Policy => ({
  id,
  label: id,
  preset: null,
  on: true,
  where,
  spans: [span(CTX.input.asOf, from, null, what)]
});
const paintedPolicy = (id: string, from = 1) =>
  pol(id, { tag: 'painted' }, { tag: 'brushes', brushes: [PAINT] }, from);
const protectPolicy = (
  id: string,
  category: 'rentControl' | 'historic' | 'newerThan',
  years: number | null = null
) => pol(id, { tag: 'category', category }, { tag: 'protect', years });

function compiled(...policies: Parameters<typeof miniDoc>): PolicyTimeline {
  const c = compileTimeline(miniDoc(...policies), LOTS, CTX, 'plan');
  expect(c.step(Infinity)).toBe(true);
  return c.result();
}

describe('cardAt: the lot-limits line from the frame', () => {
  const statics = staticsOf(CTX.input);
  const deps = depsOf(true);
  const asOf = CTX.input.asOf;

  it('owner and protected equal limitsOf(frame, parcelId) for every eligible lot', () => {
    const t = compiled(
      paintedPolicy('p'),
      protectPolicy('rc', 'rentControl'),
      protectPolicy('h', 'historic'),
      protectPolicy('n', 'newerThan', 15)
    );
    const world = createWorld(statics, t, 1, { event() {} });
    const frame = t.frameAt(1);
    const parcels = frame.view.parcels;
    const kinds = new Set<string>();
    let checked = 0;
    for (const [parcelId, i] of parcels.index) {
      const { summary } = cardAt(world, statics, frame, deps, parcelId, asOf);
      const allowed = parcels.envelopeStories[i];
      if (allowed === 0) {
        expect(summary.limits).toBeUndefined();
        continue;
      }
      const fl = limitsOf(frame, parcelId)!;
      expect(summary.limits, parcelId).toEqual({
        allowed,
        buildable: fl.protected ? null : BUILDABLE,
        protected: fl.protected,
        owner: fl.owner
      });
      kinds.add(fl.protected ? 'protected' : fl.owner.kind);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
    expect([...kinds].sort()).toEqual(['fzp', 'paint', 'protected']);
  });

  it('a protected lot reads protected, owner FZP, nothing buildable', () => {
    const t = compiled(
      paintedPolicy('p'),
      protectPolicy('rc', 'rentControl'),
      protectPolicy('h', 'historic'),
      protectPolicy('n', 'newerThan', 15)
    );
    const world = createWorld(statics, t, 1, { event() {} });
    const frame = t.frameAt(1);
    const parcels = frame.view.parcels;
    const id = [...parcels.index.keys()].find(
      (x) => parcels.envelopeStories[parcels.index.get(x)!] > 0 && limitsOf(frame, x)!.protected
    );
    expect(id).toBeDefined();
    expect(cardAt(world, statics, frame, deps, id!, asOf).summary.limits).toEqual({
      allowed: parcels.envelopeStories[parcels.index.get(id!)!],
      buildable: null,
      protected: true,
      owner: { kind: 'fzp' }
    });
  });

  it('deps answering null (nothing buildable) pass null through; the rest of limits is unchanged', () => {
    // The host answers null where neither the generator nor `lotBuildableStories` can build
    // (no usable site polygon); the card keeps that null, as today's `parcelSummary` does.
    const t = compiled(paintedPolicy('p'), protectPolicy('rc', 'rentControl'));
    const world = createWorld(statics, t, 1, { event() {} });
    const frame = t.frameAt(1);
    const parcels = frame.view.parcels;
    const none: CardDeps = { ...deps, buildable: () => null };
    let checked = 0;
    for (const [parcelId, i] of parcels.index) {
      if (parcels.envelopeStories[i] === 0) continue;
      const some = cardAt(world, statics, frame, deps, parcelId, asOf).summary.limits!;
      const got = cardAt(world, statics, frame, none, parcelId, asOf).summary.limits!;
      expect(got, parcelId).toEqual({ ...some, buildable: null });
      expect(got).toHaveProperty('buildable', null);
      if (!some.protected) checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('a painted policy from month 4: the card follows the frame passed in', () => {
    const t = compiled(paintedPolicy('p', 4));
    expect(t.frameAt(3)).not.toBe(t.frameAt(4));
    const world = createWorld(statics, t, 1, { event() {} });
    const id = PAINTED.find((x) => limitsOf(t.frameAt(4), x)?.owner.kind === 'paint')!;
    expect(id).toBeDefined();
    const at3 = cardAt(world, statics, t.frameAt(3), deps, id, asOf).summary.limits!;
    const at4 = cardAt(world, statics, t.frameAt(4), deps, id, asOf).summary.limits!;
    expect(at3.owner).toEqual({ kind: 'fzp' });
    expect(at4.owner).toEqual({ kind: 'paint', policy: 'p' });
    expect(at4.allowed).toBe(7);
    // and back: nothing about the earlier frame was kept
    expect(cardAt(world, statics, t.frameAt(3), deps, id, asOf).summary.limits).toEqual(at3);
  });
});

describe('cardAt: funded fields from a funded world', () => {
  const input = fundedMini();
  const statics = staticsOf(input);
  const timeline = oneMoneyTimeline(input, input.finance!);
  const frame = timeline.frameAt(1);
  const deps = depsOf(false);
  const { world, events } = runFunded(statics, timeline, 1, horizonMonth(input.asOf));
  const p = world.projects;
  const fundedRows: number[] = [];
  for (let r = 0; r < p.n; r++)
    if (p.origin[r] !== ORIGIN_MASTER && p.funded[r] === 1) fundedRows.push(r);
  const late = Number.MAX_SAFE_INTEGER;

  function cardOf(row: number) {
    const s = scheduleAt(world, statics, row, late)!;
    return cardAt(world, statics, frame, deps, s.parcelIds[0], late, s.projectId).summary.project!;
  }

  it('funding.programmes are programme ids', () => {
    expect(fundedRows.length).toBeGreaterThan(0);
    for (const r of fundedRows) {
      const want = p.programmes[r] === '' ? [] : p.programmes[r].split(',');
      expect(cardOf(r).funding?.programmes).toEqual(want);
    }
  });

  it('an affordable funded project carries kind affordable', () => {
    const rows = fundedRows.filter((r) => p.kind[r] === 1);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(cardOf(r).kind).toBe('affordable');
    for (const r of fundedRows.filter((x) => p.kind[x] === 0))
      expect(cardOf(r).kind).toBeUndefined();
  });

  it('funding.displaced is 0 before the displaced event and the shadow’s homes from its day', () => {
    // Rule 15: the schedule's field on `day`, which the card reads its project from.
    const shown = (row: number, day: Day) => {
      const s = scheduleAt(world, statics, row, day);
      if (s === null) return null;
      const card = cardAt(world, statics, frame, deps, s.parcelIds[0], day, s.projectId);
      expect(card.summary.project?.projectId).toBe(s.projectId);
      return s.funding!.displaced;
    };
    let checked = 0;
    for (const e of events) {
      if (e.kind !== 'displaced') continue;
      expect(e.units).toBeGreaterThan(0);
      // Each funded row has at most one shadow, so one 'displaced' event.
      expect(events.filter((x) => x.kind === 'displaced' && x.row === e.row)).toHaveLength(1);
      expect(shown(e.row, e.day)).toBe(e.units);
      expect(shown(e.row, late)).toBe(e.units);
      const before = shown(e.row, e.day - 1);
      if (before === null) continue; // the row began on the event's day
      expect(before).toBe(0);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
