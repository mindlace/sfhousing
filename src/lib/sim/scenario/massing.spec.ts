// District options for pipeline massing (large-site massing spec §4.3 "Story limit L", §4.5).
import { describe, expect, it } from 'vitest';
import type { ParcelId } from '$lib/data/parcel';
import { createLru } from '../lru';
import { generate, generateForUnits } from '$lib/generator';
import { parseCalibration } from '$lib/timelapse/model';
import { parseProjectsFile, type InFlightProject } from '$lib/timelapse/projects';
import type { Calibration } from '$lib/timelapse/types';
import miniCalibrationJson from './fixtures/mini-calibration.json';
import { miniCity } from './fixtures/mini-parcels';
import { MINI_AS_OF, MINI_PROJECTS, miniProjectsJson } from './fixtures/mini-projects';
import { buildSimInput } from './input';
import { districtOptsFor, pipeKey, type MassingCtx } from './massing';
import type { Schedule, SimInput } from './types';

const P = MINI_PROJECTS;
const city = miniCity();
const base: SimInput = buildSimInput({
  parcels: city.parcels,
  projects: parseProjectsFile(miniProjectsJson(), { onInvalid() {} }),
  calibration: parseCalibration(structuredClone(miniCalibrationJson) as unknown) as Calibration
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
    expect(buildSimInput({ parcels: city.parcels, projects: file, calibration })).toMatchObject({
      districtMaxStories: file.districtMaxStories?.stories ?? null
    });
    const withMax: typeof file = {
      ...file,
      districtMaxStories: { stories: 14, n: 9, provenance: file.rhnaCompletedNet.provenance }
    };
    expect(
      buildSimInput({ parcels: city.parcels, projects: withMax, calibration }).districtMaxStories
    ).toBe(14);
    const without = { ...file };
    delete without.districtMaxStories;
    expect(
      buildSimInput({ parcels: city.parcels, projects: without, calibration }).districtMaxStories
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
