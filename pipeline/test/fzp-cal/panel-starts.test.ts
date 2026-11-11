// The initiation panel keeps each counted start (market-baseline spec §4.2, §4.3).
import { describe, expect, it } from 'vitest';
import {
  aggregatePanel,
  initiationEvents,
  monthIndex,
  startHomes,
  type PanelSource,
  type PanelYearRow
} from '../../lib/fzp-cal/panel';
import { CalibrationError, type NormHistory } from '../../lib/fzp-cal/types';
import { isoToDay } from '../../project-records/multiphase';
import type { Day, FeatureId, ProjectHistory } from '../../../src/lib/timelapse/types';

const d = isoToDay;
const noArea = () => 0;

interface HistOpts {
  parcel: string;
  filed: string;
  end?: ProjectHistory['end'];
  unitsAt?: ProjectHistory['unitsAt'];
  stories?: number | null;
  planningProposed?: ProjectHistory['planningProposed'];
}

function hist(id: string, o: HistOpts): NormHistory {
  const entered = { filed: d(o.filed) };
  const end = o.end ?? { kind: 'open', lastObserved: d('2026-09-30') };
  const src: ProjectHistory = {
    id,
    pathway: 'discretionary',
    parcelIds: [o.parcel],
    entered,
    end,
    unitsAt: o.unitsAt ?? { filed: 10 },
    existingUnits: 0,
    storiesProposed: o.stories ?? null,
    baseStoriesAtFiling: null,
    sources: [],
    quality: []
  };
  if (o.planningProposed !== undefined) src.planningProposed = o.planningProposed;
  return {
    id,
    pathway: 'discretionary',
    parcelIds: [o.parcel],
    eff: { ...entered },
    end,
    purgeCensored: false,
    src
  };
}

const EDGES: Record<FeatureId, number[]> = {
  potentialRatio: [0, 1, 2, 5],
  existingUnits: [0, 1, 5],
  lotAreaM2: [0, 200, 1000],
  yearBuilt: [0, 1900, 1979],
  storiesGap: [-100, 0, 3],
  improvementShare: [0, 0.5],
  rentControlLikely: [0, 1],
  landUseClass: [0, 1, 2, 3, 4, 5]
};

function row(mapblklot: string): PanelYearRow {
  return {
    mapblklot,
    hostableBase: true,
    imputed: 0,
    features: {
      potentialRatio: 3,
      existingUnits: 2,
      lotAreaM2: 300,
      yearBuilt: 1925,
      storiesGap: 4,
      improvementShare: 0.3,
      rentControlLikely: 1,
      landUseClass: 2
    }
  };
}

const allYears = Array.from({ length: 19 }, (_, i) => 2007 + i);
/** Parcels A..E every year; Z has no row (its event is off panel). */
const SRC: PanelSource = {
  years: allYears,
  read: async () => ['A', 'B', 'C', 'D', 'E'].map(row)
};

const HISTS: NormHistory[] = [
  // permit basis (F before 2015, P given): affordable cohort, homes from permitFiled
  hist('p1', {
    parcel: 'B',
    filed: '2010-05-01',
    unitsAt: { filed: 0, permitFiled: 12, complete: 14 },
    stories: 5,
    planningProposed: { units: 20, affordable: 19 }
  }),
  // permit basis, no Planning record; earlier month than p1 but a later parcel
  hist('p2', { parcel: 'C', filed: '2009-01-01', unitsAt: { complete: 7 } }),
  // record basis
  hist('r1', {
    parcel: 'A',
    filed: '2016-03-10',
    unitsAt: {},
    planningProposed: { units: 10, affordable: 0 }
  }),
  // covered: A is in flight under r1 from 2016-04
  hist('r2', { parcel: 'A', filed: '2016-07-01', stories: 9 }),
  // record basis, same year as r1, later parcel, earlier month
  hist('a0', { parcel: 'D', filed: '2016-01-20', stories: 3 }),
  // off panel: Z has no row
  hist('o1', { parcel: 'Z', filed: '2017-01-05' }),
  // two starts on E in 2018: the first exits in April
  hist('e2', { parcel: 'E', filed: '2018-09-01', unitsAt: { filed: 30 }, stories: 4 }),
  hist('e1', {
    parcel: 'E',
    filed: '2018-02-01',
    end: { kind: 'exit', stage: 'filed', reason: 'withdrawn', day: d('2018-04-15') }
  })
];

const FIRST_FILED = new Map<string, Day>([
  ['p1', d('2010-06-15')],
  ['p2', d('2010-02-01')]
]);

async function run(hists: NormHistory[]) {
  const ev = initiationEvents(hists, FIRST_FILED, noArea);
  return aggregatePanel(SRC, ev, EDGES);
}

describe('startHomes', () => {
  const h = (unitsAt: ProjectHistory['unitsAt']) =>
    hist('x', { parcel: 'A', filed: '2016-01-01', unitsAt }).src;

  it('takes the first positive of filed, permitFiled, complete', () => {
    expect(startHomes(h({ filed: 0, permitFiled: 12, complete: 14 }))).toBe(12);
    expect(startHomes(h({ filed: 3, permitFiled: 12 }))).toBe(3);
    expect(startHomes(h({ complete: 7 }))).toBe(7);
  });

  it('is null when none is a positive finite number', () => {
    expect(startHomes(h({}))).toBeNull();
    expect(startHomes(h({ filed: 0, permitFiled: -2, complete: NaN }))).toBeNull();
    expect(startHomes(h({ filed: Infinity }))).toBeNull();
  });
});

describe('aggregatePanel starts', () => {
  it('keeps one start per counted event', async () => {
    const res = await run(HISTS);
    expect(res.events).toEqual({ record: 4, permit: 2 });
    expect(res.eventsCovered).toBe(1);
    expect(res.eventsOffPanel).toBe(1);
    expect(res.starts.length).toBe(res.events.record + res.events.permit);
  });

  it('carries basis, cohort, homes and stories, in (year, parcel, month) order', async () => {
    const res = await run(HISTS);
    expect(res.starts).toEqual([
      { year: 2010, basis: 1, cohort: 'affordable', homes: 12, stories: 5 }, // p1, B
      { year: 2010, basis: 1, cohort: 'noRecord', homes: 7, stories: null }, // p2, C
      { year: 2016, basis: 0, cohort: 'private', homes: null, stories: null }, // r1, A
      { year: 2016, basis: 0, cohort: 'noRecord', homes: 10, stories: 3 }, // a0, D
      { year: 2018, basis: 0, cohort: 'noRecord', homes: 10, stories: null }, // e1, E Feb
      { year: 2018, basis: 0, cohort: 'noRecord', homes: 30, stories: 4 } // e2, E Sep
    ]);
  });

  it('leaves out covered and off-panel events', async () => {
    const res = await run(HISTS);
    // r2 (stories 9) is covered and o1 (2017) is off panel
    expect(res.starts.some((s) => s.stories === 9)).toBe(false);
    expect(res.starts.some((s) => s.year === 2017)).toBe(false);
  });

  it('does not depend on the input order', async () => {
    const a = await run(HISTS);
    const b = await run([...HISTS].reverse());
    expect(b.starts).toEqual(a.starts);
  });

  it('records a placed start only for events written to the timeline', () => {
    const ev = initiationEvents(HISTS, FIRST_FILED, noArea);
    const keys = [...ev.placed.keys()].sort();
    const m = (iso: string) => monthIndex(d(iso));
    expect(keys).toEqual(
      [
        `A|${m('2016-03-10')}`,
        `B|${m('2010-06-15')}`,
        `C|${m('2010-02-01')}`,
        `D|${m('2016-01-20')}`,
        `E|${m('2018-02-01')}`,
        `E|${m('2018-09-01')}`,
        `Z|${m('2017-01-05')}`
      ].sort()
    );
  });

  it('a timeline event without a start record is a CalibrationError', async () => {
    const ev = initiationEvents(HISTS, FIRST_FILED, noArea);
    await expect(
      aggregatePanel(SRC, { timeline: ev.timeline, eventsCovered: 0, placed: new Map() }, EDGES)
    ).rejects.toThrow(CalibrationError);
  });
});
