// District options for pipeline massing (large-site massing spec §4.3 "Story limit L", §4.5).
import { describe, expect, it } from 'vitest';
import type { ParcelId } from '$lib/data/parcel';
import { createLru } from '../lru';
import { fnv1a32, generate, generateForm, generateForUnits } from '$lib/generator';
import { scenarioRecordOf } from '$lib/data/scenario-codec';
import { BUILDING_FORMS } from '$lib/sim/choice/types';
import { parseCalibration } from '$lib/timelapse/model';
import { parseProjectsFile, type InFlightProject } from '$lib/timelapse/projects';
import type { Calibration } from '$lib/timelapse/types';
import miniCalibrationJson from './fixtures/mini-calibration.json';
import { miniOptions } from './fixtures/mini-options';
import { miniCity } from './fixtures/mini-parcels';
import { MINI_AS_OF, MINI_PROJECTS, miniProjectsJson } from './fixtures/mini-projects';
import { buildSimInput } from './input/build';
import { districtOptsFor, massingFor, pipeKey, simKey, type MassingCtx } from './massing';
import type { Schedule, SimInput } from './input/types';

const P = MINI_PROJECTS;
const city = miniCity();
const base: SimInput = buildSimInput({
  parcels: city.parcels,
  projects: parseProjectsFile(miniProjectsJson(), { onInvalid() {} }),
  calibration: parseCalibration(structuredClone(miniCalibrationJson) as unknown) as Calibration,
  options: miniOptions(city)
});

/** `base` with these envelope stories, row edits and districtMaxStories. */
function inputWith(
  envelopes: Record<ParcelId, number>,
  edit: (row: InFlightProject) => InFlightProject = (r) => r,
  districtMaxStories: number | null = null
): SimInput {
  const envelopeStories = new Uint8Array(base.parcels.envelopeStories);
  for (const [id, n] of Object.entries(envelopes)) {
    const i = base.parcels.index.get(id);
    if (i === undefined) throw new Error(`no parcel ${id}`);
    envelopeStories[i] = n;
  }
  return {
    ...base,
    parcels: { ...base.parcels, envelopeStories },
    projects: base.projects.map((r) => (r.id === P.entitled3 ? edit(structuredClone(r)) : r)),
    districtMaxStories
  };
}

const ctxOf = (input: SimInput): MassingCtx => ({
  input,
  records: (id) => city.records.get(id),
  memo: createLru(10),
  gen: generate,
  genForUnits: generateForUnits,
  genForm: generateForm,
  logOnce() {}
});

const heights = (over: Partial<NonNullable<InFlightProject['daHeights']>>) => ({
  stories: null,
  maxStories: null,
  openSpaceShare: null,
  ...over
});

function sched(over: Partial<Schedule> = {}): Schedule {
  return {
    projectId: P.entitled3,
    origin: 'pipeline',
    parcelIds: ['3600003', '3600004'],
    pathway: 'discretionary',
    entered: {},
    end: { kind: 'open' },
    revisions: [{ day: MINI_AS_OF, units: 300, stories: null }],
    existingUnits: 0,
    multiPhase: true,
    phase: null,
    ...over
  };
}

const phase1 = (): Schedule =>
  sched({
    projectId: `${P.entitled3}:phase:1`,
    parcelIds: ['3600003'],
    phase: { masterId: P.entitled3, index: 1, of: 3, start: 'estimated' }
  });

describe('buildSimInput districtMaxStories', () => {
  it('is the projects.json districtMaxStories.stories, else null', () => {
    const file = parseProjectsFile(miniProjectsJson(), { onInvalid() {} });
    const calibration = base.calibration;
    const options = base.options;
    expect(
      buildSimInput({ parcels: city.parcels, projects: file, calibration, options })
    ).toMatchObject({
      districtMaxStories: file.districtMaxStories?.stories ?? null
    });
    const withMax: typeof file = {
      ...file,
      districtMaxStories: { stories: 14, n: 9, provenance: file.rhnaCompletedNet.provenance }
    };
    expect(
      buildSimInput({ parcels: city.parcels, projects: withMax, calibration, options })
        .districtMaxStories
    ).toBe(14);
    const without = { ...file };
    delete without.districtMaxStories;
    expect(
      buildSimInput({ parcels: city.parcels, projects: without, calibration, options })
        .districtMaxStories
    ).toBeNull();
  });
});

describe('districtOptsFor', () => {
  it('districtOptsFor takes the zoned limit first', () => {
    const input = inputWith({ '3600003': 0, '3600004': 9 }, (r) => ({
      ...r,
      daHeights: heights({ maxStories: 20 })
    }));
    expect(districtOptsFor(sched(), ctxOf(input)).storyLimit).toBe(9);
  });

  it('then the curated max', () => {
    const input = inputWith({ '3600003': 0, '3600004': 0 }, (r) => ({
      ...r,
      daHeights: heights({ maxStories: 20 })
    }));
    expect(districtOptsFor(sched(), ctxOf(input)).storyLimit).toBe(20);
  });

  it("a phase's own max comes before the master's curated max", () => {
    const edit = (r: InFlightProject): InFlightProject => ({
      ...r,
      daHeights: heights({ maxStories: 20 }),
      phases: r.phases!.map((ph, i) => (i === 0 ? { ...ph, maxStories: 8 } : ph))
    });
    const input = inputWith({ '3600003': 0, '3600004': 0 }, edit, 14);
    expect(districtOptsFor(phase1(), ctxOf(input)).storyLimit).toBe(8);
    // the master itself, and a phase without its own max, take the master's
    expect(districtOptsFor(sched(), ctxOf(input)).storyLimit).toBe(20);
    const second: Schedule = {
      ...phase1(),
      phase: { masterId: P.entitled3, index: 2, of: 3, start: 'estimated' }
    };
    expect(districtOptsFor(second, ctxOf(input)).storyLimit).toBe(20);
    // the zoned limit still wins over the phase max
    const zoned = inputWith({ '3600003': 9 }, edit, 14);
    expect(districtOptsFor(phase1(), ctxOf(zoned)).storyLimit).toBe(9);
  });

  it('then districtMaxStories', () => {
    const input = inputWith({ '3600003': 0, '3600004': 0 }, (r) => r, 14);
    expect(districtOptsFor(sched(), ctxOf(input)).storyLimit).toBe(14);
  });

  it('else no story limit', () => {
    const input = inputWith({ '3600003': 0, '3600004': 0 });
    expect(districtOptsFor(sched(), ctxOf(input))).toEqual({});
  });

  it('curatedStories prefers the phase over the master', () => {
    const both = inputWith({}, (r) => ({
      ...r,
      daHeights: heights({ stories: 6, openSpaceShare: 0.3 }),
      phases: r.phases!.map((ph, i) => (i === 0 ? { ...ph, stories: 11, storiesTier: 1 } : ph))
    }));
    expect(districtOptsFor(phase1(), ctxOf(both))).toMatchObject({
      curatedStories: 11,
      openSpaceShare: 0.3
    });
    // the master itself, and a phase without its own height, take the master's
    expect(districtOptsFor(sched(), ctxOf(both)).curatedStories).toBe(6);
    const second: Schedule = {
      ...phase1(),
      phase: { masterId: P.entitled3, index: 2, of: 3, start: 'estimated' }
    };
    expect(districtOptsFor(second, ctxOf(both)).curatedStories).toBe(6);
  });

  it('a simulated schedule gets no opts', () => {
    const input = inputWith({ '3600003': 9 }, (r) => r, 14);
    const s = sched({ projectId: 'SIM:3600003', origin: 'simulated', parcelIds: ['3600003'] });
    expect(districtOptsFor(s, ctxOf(input))).toEqual({});
  });
});

describe('pipeKey', () => {
  it('pipeKey separates opts', () => {
    const ids: ParcelId[] = ['a', 'b'];
    expect(pipeKey(1, 50, null, ids, { storyLimit: 9 })).not.toBe(
      pipeKey(1, 50, null, ids, { storyLimit: 12 })
    );
    expect(pipeKey(1, 50, null, ids, { curatedStories: 6 })).not.toBe(
      pipeKey(1, 50, null, ids, {})
    );
    expect(pipeKey(1, 50, null, ids, { openSpaceShare: 0.2 })).not.toBe(
      pipeKey(1, 50, null, ids, {})
    );
    expect(pipeKey(5, 40, 6, ['b', 'a'], { storyLimit: 9, openSpaceShare: 0.25 })).toBe(
      'p|5|40|6|a,b|9|-|0.25'
    );
  });
});

describe('a simulated project draws its chosen option', () => {
  const t = base.options;
  const parcels = base.parcels;
  const formOf = (j: number) => BUILDING_FORMS[t.form[j]];

  /** A simulated schedule started at option f of lot i. */
  const simAt = (i: number, f: number): Schedule => {
    const j = t.offset[i] + f;
    return sched({
      projectId: `sim:${parcels.id[i]}:0`,
      origin: 'simulated',
      parcelIds: [parcels.id[i]],
      multiPhase: false,
      revisions: [{ day: MINI_AS_OF, units: t.homes[j], stories: t.stories[j], option: f }]
    });
  };

  /** Lots with a loaded record, in row order. */
  const lots = [...Array(parcels.count).keys()].filter((i) => city.records.has(parcels.id[i]));

  it("has the option's form, stories and plates, and holds its homes", () => {
    let towers = 0;
    let checked = 0;
    for (const i of lots.slice(0, 40)) {
      const id = parcels.id[i];
      const rec = scenarioRecordOf(parcels, i, city.records.get(id)!);
      for (let f = 0; f < t.offset[i + 1] - t.offset[i]; f++) {
        const j = t.offset[i] + f;
        const m = massingFor(simAt(i, f), 0, ctxOf(base));
        const want = generateForm(rec, formOf(j), t.stories[j], fnv1a32(id));
        expect(want).not.toBeNull();
        expect(m).toEqual({ ...want!.building, source: 'scenario' });
        if (!('parts' in m)) throw new Error('no building drawn');
        expect(m.units).toBe(t.homes[j]);
        expect(m.stories).toBe(t.stories[j]);
        expect(m.plates ?? 0).toBe(t.plates[j]);
        if (t.plates[j] > 0) towers++;
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
    expect(towers).toBeGreaterThan(0);
  });

  it('two options of different forms at the same stories get different keys and buildings', () => {
    let pairs = 0;
    for (const i of lots) {
      const from = t.offset[i];
      for (let a = from; a < t.offset[i + 1]; a++) {
        for (let b = a + 1; b < t.offset[i + 1] && t.stories[b] === t.stories[a]; b++) {
          if (t.form[a] === t.form[b]) continue;
          const id = parcels.id[i];
          const ka = simKey(id, formOf(a), t.stories[a], t.plates[a]);
          const kb = simKey(id, formOf(b), t.stories[b], t.plates[b]);
          expect(ka).not.toBe(kb);
          const ctx = ctxOf(base);
          massingFor(simAt(i, a - from), 0, ctx);
          massingFor(simAt(i, b - from), 0, ctx);
          expect(ctx.memo.get(ka)).toBeTruthy();
          expect(ctx.memo.get(kb)).toBeTruthy();
          expect(ctx.memo.get(ka)).not.toBe(ctx.memo.get(kb));
          pairs++;
        }
      }
      if (pairs >= 5) break;
    }
    expect(pairs).toBeGreaterThan(0);
  });

  it('a simulated revision without an option is drawn as its footprint', () => {
    const logged: string[] = [];
    const ctx = { ...ctxOf(base), logOnce: (_: string, m: string) => void logged.push(m) };
    const s = simAt(lots[0], 0);
    s.revisions = [{ day: MINI_AS_OF, units: 4, stories: 2 }];
    expect('parts' in massingFor(s, 0, ctx)).toBe(false);
    expect(logged.join()).toMatch(/no option/);
  });

  it("a recorded project's massing is unchanged: generateForUnits at its stories", () => {
    const s = sched({
      multiPhase: false,
      revisions: [{ day: MINI_AS_OF, units: 120, stories: 6 }]
    });
    const recs = s.parcelIds.map((id) => city.records.get(id)!);
    const ctx = ctxOf(base);
    const want = generateForUnits(recs, 120, 6, fnv1a32(s.projectId), 6, districtOptsFor(s, ctx));
    expect(want).not.toBeNull();
    expect(massingFor(s, 0, ctx)).toEqual({ ...want!, source: 'pipeline' });
  });
});
