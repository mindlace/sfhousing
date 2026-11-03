import { describe, expect, it } from 'vitest';
import { idsHash } from '../column-file';
import { dayOf } from '../../sim/scenario/dates';
import { miniCity } from '../../sim/scenario/fixtures/mini-parcels';
import { GOLDEN_HORIZON, goldenInput } from '../../sim/scenario/simulate.golden.cases';
import { simulate } from '../../sim/scenario/simulate';
import type { Schedule } from '../../sim/scenario/types';
import {
  LESSCARS_FORMAT,
  SOURCES,
  decodeTimelinePayload,
  encodeTimelinePayload,
  parsePlanFile,
  parseSitesFile,
  parseSummary,
  type LessCarsSummary,
  type LessCarsTimeline
} from './codec';
import { TINY_PLAN } from './fixtures/tiny-plan';
import V1_PLAN from './fixtures/v1/plan.json';
import V1_SITES from './fixtures/v1/sites.json';
import V1_SUMMARY from './fixtures/v1/summary.json';
import { schedulePlan } from './schedule';

const ids = miniCity().parcels.id;

/** A schedule with every optional field set: exit end, phase, regime, inFlight, null stories. */
function oddSchedule(): Schedule {
  return {
    projectId: 'p:odd',
    origin: 'pipeline',
    parcelIds: [ids[3], ids[1]],
    pathway: 'permitOnly',
    entered: { permitFiled: dayOf(2027, 2, 1), permitIssued: dayOf(2027, 9, 1) },
    end: { kind: 'exit', stage: 'permitIssued', reason: 'expired', day: dayOf(2029, 1, 1) },
    revisions: [
      { day: dayOf(2027, 2, 1), units: 12, stories: null },
      { day: dayOf(2027, 5, 1), units: 10, stories: 5 }
    ],
    existingUnits: 2,
    multiPhase: false,
    phase: { masterId: 'm:1', index: 2, of: 3, start: 'estimated' },
    regime: 1,
    inFlight: true
  };
}

const t: LessCarsTimeline = {
  format: LESSCARS_FORMAT,
  datasetVersion: 'fixture-60',
  count: ids.length,
  idsHash: idsHash(ids),
  seed: 7,
  schedules: [...simulate(goldenInput(), 7, GOLDEN_HORIZON), oddSchedule()],
  builds: [
    {
      siteId: 'lc:hwy:0',
      projectId: 'hwy',
      parcelRow: null,
      units: 40,
      stories: 6,
      existing: 0,
      startDay: dayOf(2037, 1, 1),
      completeDay: dayOf(2039, 1, 1)
    },
    {
      siteId: ids[5],
      projectId: 'parking',
      parcelRow: 5,
      units: 22,
      stories: 4,
      existing: 1,
      startDay: dayOf(2035, 1, 1),
      completeDay: dayOf(2036, 7, 1)
    }
  ],
  reservations: [
    { row: 2, kept: true },
    { row: 5, kept: false }
  ]
};
const bound = { count: ids.length, id: ids };

function summary(): LessCarsSummary {
  // two seeds; per source sums (×2): freed 4, parking −1, transitUnlocked 3, other 0 → extra 6
  return {
    format: LESSCARS_FORMAT,
    datasetVersion: 'fixture-60',
    planId: 'mini',
    seeds: 2,
    representativeSeed: 1,
    switchDay: dayOf(2032, 1, 31),
    regimeDays: [dayOf(2032, 1, 31)],
    yearEnds: [dayOf(2028, 12, 31), dayOf(2029, 12, 31)],
    extra: { mean: [0, 3], p10: [0, 1], p50: [0, 1], p90: [0, 5] },
    bySource: { freed: [0, 2], parking: [0, -0.5], transitUnlocked: [0, 1.5], other: [0, 0] },
    plan: [10, 13.5],
    baseline: [10, 10.5],
    provenance: {
      tier: 3,
      label: 'Simulated',
      sources: [{ label: 'Spec', url: 'https://example.org/spec' }],
      method: 'Paired runs.'
    }
  };
}

describe('lesscars codec', () => {
  it('timeline round-trips and is bound to parcels.bin', () => {
    const bytes = encodeTimelinePayload(t, ids);
    expect(decodeTimelinePayload(bytes, { count: ids.length, id: ids })).toEqual(t);
    expect(() =>
      decodeTimelinePayload(bytes, { count: ids.length, id: [...ids].reverse() })
    ).toThrow(/idsHash/);
    expect(() => decodeTimelinePayload(bytes, { count: 3, id: ids.slice(0, 3) })).toThrow(/count/);
  });

  it('round-trips reservations ascending by row', () => {
    const back = decodeTimelinePayload(encodeTimelinePayload(t, ids), bound);
    expect(back.reservations).toEqual([
      { row: 2, kept: true },
      { row: 5, kept: false }
    ]);
  });

  it('rejects reservations missing, out of range, unsorted or with a bad kept flag', () => {
    const withColumn = (col: unknown): Uint8Array => {
      const doc = JSON.parse(new TextDecoder().decode(encodeTimelinePayload(t, ids)));
      if (col === undefined) delete doc.reservations;
      else doc.reservations = col;
      return new TextEncoder().encode(JSON.stringify(doc));
    };
    for (const col of [
      undefined,
      { row: [ids.length], kept: [1] },
      { row: [5, 2], kept: [1, 1] },
      { row: [2, 2], kept: [1, 1] },
      { row: [2], kept: [2] },
      { row: [2, 5], kept: [1] }
    ])
      expect(() => decodeTimelinePayload(withColumn(col), bound)).toThrow(/reservations/);
  });

  it('round trip keeps absent optional schedule fields absent', () => {
    const bytes = encodeTimelinePayload(t, ids);
    const back = decodeTimelinePayload(bytes, { count: ids.length, id: ids });
    const plain = back.schedules.find((s) => s.projectId !== 'p:odd')!;
    expect('regime' in plain).toBe(false);
    expect('inFlight' in plain).toBe(false);
    expect(back.schedules[back.schedules.length - 1]).toStrictEqual(oddSchedule());
  });

  it('encode refuses a timeline that does not describe the parcel ids', () => {
    expect(() => encodeTimelinePayload({ ...t, idsHash: 1 }, ids)).toThrow(/idsHash/);
    expect(() => encodeTimelinePayload({ ...t, count: 3 }, ids)).toThrow(/count/);
  });

  it('a parcel parcels.bin lacks keeps its id', () => {
    const stranger = { ...oddSchedule(), parcelIds: ['nope', ids[2]] };
    const one = { ...t, schedules: [stranger] };
    const back = decodeTimelinePayload(encodeTimelinePayload(one, ids), {
      count: ids.length,
      id: ids
    });
    expect(back.schedules[0].parcelIds).toEqual(['nope', ids[2]]);
  });

  it('parseSummary accepts a summary whose parts sum to the whole', () => {
    expect(parseSummary(JSON.parse(JSON.stringify(summary())))).toEqual(summary());
    expect(SOURCES).toEqual(['freed', 'parking', 'transitUnlocked', 'other']);
  });

  it('parseSummary rejects bySource whose integer sums do not add to extra', () => {
    const s = summary();
    s.bySource.other = [0, 0.5];
    expect(() => parseSummary(s)).toThrow(/sources sum/);
    const u = summary();
    u.bySource.freed = [0, 2.25]; // 4.5 over 2 seeds: not an integer sum
    expect(() => parseSummary(u)).toThrow(/integer/);
    const v = summary();
    v.plan = [10, 14];
    expect(() => parseSummary(v)).toThrow(/plan − baseline/);
    expect(() => parseSummary({ ...summary(), format: 'x' })).toThrow(/format/);
  });

  it('sites and plan files parse', () => {
    const rec = {
      id: 'lc:hwy:0',
      polygon: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 0]
        ]
      ],
      labelPoint: [-122.4, 37.7],
      areaM2: 50,
      existingUnits: 0,
      existingFloorAreaM2: 0,
      existingHeightM: 0,
      landUse: 'VACANT',
      eligible: true,
      neighborhood: 'Mission'
    };
    const sites = {
      format: LESSCARS_FORMAT,
      datasetVersion: 'fixture-0',
      sites: [{ siteId: 'lc:hwy:0', projectId: 'hwy', rec, outline: rec.polygon }]
    };
    expect(parseSitesFile(JSON.parse(JSON.stringify(sites)))).toEqual(sites);
    expect(() => parseSitesFile({ ...sites, sites: [{ siteId: 'x' }] })).toThrow(/projectId/);

    const s = schedulePlan(TINY_PLAN);
    const file = {
      format: LESSCARS_FORMAT,
      datasetVersion: 'fixture-0',
      plan: TINY_PLAN,
      times: [...s.times.values()],
      segments: {
        '1000': [
          [
            [-122.41, 37.76],
            [-122.42, 37.76]
          ]
        ]
      }
    };
    expect(parsePlanFile(JSON.parse(JSON.stringify(file)))).toEqual(file);
    const bad = { ...file, times: [{ ...file.times[0], id: 'ghost' }] };
    expect(() => parsePlanFile(bad)).toThrow(/ghost/);
  });
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// The files of dataset 2026-11-02-39fbf039's format (fixture-0 before lesscars v1.1 Task 4).
describe('v1 files', () => {
  it('the v1 sites, summary and plan files still parse', () => {
    const sites = parseSitesFile(V1_SITES);
    expect(sites.sites.length).toBeGreaterThan(0);
    for (const s of sites.sites) {
      expect(s).not.toHaveProperty('parcels');
      expect(s).not.toHaveProperty('parcelM2');
      expect(s).not.toHaveProperty('heldBy');
    }
    expect(parseSummary(V1_SUMMARY)).not.toHaveProperty('garageCost');
    expect(parsePlanFile(V1_PLAN).plan.id).toBe('mini');
  });

  it('round-trips the optional site keys and the garage cost', () => {
    const v1 = structuredClone(V1_SITES) as Json;
    Object.assign(v1.sites[0], { parcels: ['3512019'], parcelM2: 800.5, heldBy: 'garage' });
    expect(parseSitesFile(v1).sites[0]).toMatchObject({
      parcels: ['3512019'],
      parcelM2: 800.5,
      heldBy: 'garage'
    });
    const cost = [{ projectId: 'garage', homes: 40 }];
    expect(parseSummary({ ...summary(), garageCost: cost }).garageCost).toEqual(cost);
  });

  it('rejects a negative parcelM2 or a garage cost that is not a whole number', () => {
    const v1 = structuredClone(V1_SITES) as Json;
    v1.sites[0].parcelM2 = -1;
    expect(() => parseSitesFile(v1)).toThrow(/sites\.0\.parcelM2/);
    v1.sites[0].parcelM2 = 1;
    v1.sites[0].parcels = [3];
    expect(() => parseSitesFile(v1)).toThrow(/sites\.0\.parcels\.0/);
    const fractionalCost = { ...summary(), garageCost: [{ projectId: 'garage', homes: 1.5 }] };
    expect(() => parseSummary(fractionalCost)).toThrow(/garageCost\.0\.homes/);
    const negative = { ...summary(), garageCost: [{ projectId: 'garage', homes: -2 }] };
    expect(() => parseSummary(negative)).toThrow(/garageCost\.0\.homes/);
  });
});
