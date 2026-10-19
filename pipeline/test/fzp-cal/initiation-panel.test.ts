// Initiation panel: at-risk timeline, aggregation into fit cells, mask shares (spec §4.6).
import { afterAll, describe, expect, it } from 'vitest';
import { createTableFromRows, openDuck, type CellValue, type Duck } from '../../lib/duck';
import {
  PANEL_FEATURES,
  PANEL_MONTHS,
  aggregatePanel,
  duckPanelSource,
  initiationEvents,
  monthIndex,
  type PanelSource,
  type PanelYearRow
} from '../../lib/fzp-cal/panel';
import { CalibrationError, type NormHistory } from '../../lib/fzp-cal/types';
import { isoToDay } from '../../project-records/multiphase';
import { binIndex } from '../../../src/lib/timelapse/model';
import type { Day, FeatureId, ProjectHistory, Stage } from '../../../src/lib/timelapse/types';

const d = isoToDay;
const m = (iso: string) => monthIndex(d(iso));

function hist(
  id: string,
  parcelIds: string[],
  entered: Partial<Record<Stage, Day>>,
  end: ProjectHistory['end'] = { kind: 'open', lastObserved: d('2026-09-30') },
  purgeCensored = false
): NormHistory {
  return {
    id,
    pathway: 'discretionary',
    parcelIds,
    eff: { ...entered },
    end,
    purgeCensored,
    src: {
      id,
      pathway: 'discretionary',
      parcelIds,
      entered,
      end,
      unitsAt: { filed: 10 },
      existingUnits: 0,
      storiesProposed: null,
      baseStoriesAtFiling: null,
      sources: [],
      quality: []
    }
  };
}

const area = (areas: Record<string, number>) => (id: string) => areas[id] ?? 0;
const noArea = () => 0;

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

const FEATS: Record<FeatureId, number> = {
  potentialRatio: 3,
  existingUnits: 2,
  lotAreaM2: 300,
  yearBuilt: 1925,
  storiesGap: 4,
  improvementShare: 0.3,
  rentControlLikely: 1,
  landUseClass: 2
};

function row(mapblklot: string, over: Partial<PanelYearRow> = {}): PanelYearRow {
  return { mapblklot, hostableBase: true, imputed: 0, features: { ...FEATS }, ...over };
}

/** A fake source: `rows(year)` gives that roll year's rows (sorted by the caller). */
function source(years: number[], rows: (year: number) => PanelYearRow[]): PanelSource {
  return { years, read: async (y) => rows(y) };
}

const allYears = Array.from({ length: 19 }, (_, i) => 2007 + i);

describe('monthIndex', () => {
  it('counts calendar months from 2007-01 in UTC', () => {
    expect(monthIndex(d('2007-01-01'))).toBe(0);
    expect(monthIndex(d('2007-01-31'))).toBe(0);
    expect(monthIndex(d('2015-01-01'))).toBe(96);
    expect(monthIndex(d('2025-12-31'))).toBe(PANEL_MONTHS - 1);
    expect(monthIndex(d('2006-12-31'))).toBe(-1);
    expect(monthIndex(d('2026-01-01'))).toBe(PANEL_MONTHS);
  });
});

describe('initiationEvents', () => {
  it('is not at risk while in flight: event month marked, covered after it', () => {
    const ev = initiationEvents([hist('h', ['A'], { filed: d('2016-03-10') })], new Map(), noArea);
    const t = ev.timeline.get('A') as Int8Array;
    const e = m('2016-03-01');
    expect(t.length).toBe(PANEL_MONTHS);
    expect(Array.from(t.slice(0, e)).every((v) => v === 0)).toBe(true);
    expect(t[e]).toBe(1);
    expect(Array.from(t.slice(e + 1)).every((v) => v === -1)).toBe(true);
  });

  it('is at risk again the month after an exit', () => {
    const end = {
      kind: 'exit' as const,
      stage: 'filed' as const,
      reason: 'withdrawn' as const,
      day: d('2017-05-20')
    };
    const ev = initiationEvents(
      [hist('h', ['A'], { filed: d('2016-03-10') }, end)],
      new Map(),
      noArea
    );
    const t = ev.timeline.get('A') as Int8Array;
    expect(t[m('2016-04-01')]).toBe(-1);
    expect(t[m('2017-05-01')]).toBe(-1);
    expect(t[m('2017-06-01')]).toBe(0);
    expect(t[PANEL_MONTHS - 1]).toBe(0);
  });

  it('treats a purge-censored history as open through the panel end', () => {
    const h = hist(
      'h',
      ['A'],
      { filed: d('2016-03-10') },
      { kind: 'open', lastObserved: d('2018-01-01') },
      true
    );
    const t = initiationEvents([h], new Map(), noArea).timeline.get('A') as Int8Array;
    expect(t[m('2018-02-01')]).toBe(-1);
    expect(t[PANEL_MONTHS - 1]).toBe(-1);
  });

  it('never returns to risk after a completion', () => {
    const h = hist(
      'h',
      ['A'],
      { filed: d('2016-03-10'), complete: d('2019-01-05') },
      { kind: 'complete', day: d('2019-01-05') }
    );
    const t = initiationEvents([h], new Map(), noArea).timeline.get('A') as Int8Array;
    expect(Array.from(t.slice(m('2016-04-01'))).every((v) => v === -1)).toBe(true);
  });

  it('puts the event on the largest lot, ties to the smaller id; covers every parcel', () => {
    const h = hist('h', ['C', 'B', 'A'], { filed: d('2016-03-10') });
    const ev = initiationEvents([h], new Map(), area({ A: 100, B: 200, C: 200 }));
    const e = m('2016-03-01');
    expect(ev.timeline.get('B')?.[e]).toBe(1);
    expect(ev.timeline.get('C')?.[e]).toBe(0);
    expect(ev.timeline.get('A')?.[e]).toBe(0);
    for (const p of ['A', 'B', 'C']) expect(ev.timeline.get(p)?.[e + 1]).toBe(-1);
    const tie = initiationEvents(
      [hist('t', ['B', 'A'], { filed: d('2016-03-10') })],
      new Map(),
      noArea
    );
    expect(tie.timeline.get('A')?.[e]).toBe(1);
    expect(tie.timeline.get('B')?.[e]).toBe(0);
  });

  it('counts an event on a month another history covers, and does not mark it', () => {
    const a = hist('a', ['A'], { filed: d('2016-03-10') });
    const b = hist('b', ['A'], { filed: d('2017-08-02') });
    const ev = initiationEvents([b, a], new Map(), noArea);
    const t = ev.timeline.get('A') as Int8Array;
    expect(ev.eventsCovered).toBe(1);
    expect(t[m('2016-03-01')]).toBe(1);
    expect(t[m('2017-08-01')]).toBe(-1);
  });

  it('has no month after 2025-12: a 2026 start is no panel event and no coverage', () => {
    const late = hist('late', ['A'], { filed: d('2026-02-01') });
    const edge = hist('edge', ['B'], { filed: d('2025-12-31') });
    const ev = initiationEvents([late, edge], new Map(), noArea);
    expect(ev.outOfRange).toBe(1);
    expect(Array.from(ev.timeline.get('A') ?? []).every((v) => v === 0)).toBe(true);
    expect(ev.timeline.get('B')?.[PANEL_MONTHS - 1]).toBe(1);
  });

  it('counts histories with no parcel and does nothing for them', () => {
    const ev = initiationEvents([hist('h', [], { filed: d('2016-03-10') })], new Map(), noArea);
    expect(ev.noParcel).toBe(1);
    expect(ev.timeline.size).toBe(0);
  });
});

describe('aggregatePanel', () => {
  it('counts the event month once with event 1 and skips covered months', async () => {
    const ev = initiationEvents([hist('h', ['A'], { filed: d('2016-03-10') })], new Map(), noArea);
    const res = await aggregatePanel(
      source(allYears, () => [row('A'), row('B')]),
      ev,
      EDGES
    );
    // A: 2007-01..2016-03 at risk (111 months), B: all 228.
    expect(res.exposureMonths).toBe(111 + PANEL_MONTHS);
    expect(res.events).toEqual({ record: 1, permit: 0 });
    expect(res.parcelYears).toBe(38);
    expect(res.eventsOffPanel).toBe(0);
    const bins = PANEL_FEATURES.map((f) => binIndex(EDGES[f], FEATS[f])).join(',');
    const c2016 = res.cells.get(`2016|${bins}|0`);
    expect(c2016).toEqual({ bins: bins.split(',').map(Number), basis: 0, exposure: 15, events: 1 });
    expect(res.cells.get(`2014|${bins}|1`)?.exposure).toBe(24);
    expect(res.cells.get(`2014|${bins}|0`)).toBeUndefined();
    expect(res.cells.get(`2017|${bins}|0`)?.exposure).toBe(12);
    let ev2 = 0;
    for (const c of res.cells.values()) ev2 += c.events;
    expect(ev2).toBe(1);
  });

  it('gives a permit-basis event basis 1 in whatever year it falls', async () => {
    const h = hist('h', ['A'], { filed: d('2013-05-01') });
    const ev = initiationEvents([h], new Map([['h', d('2016-02-10')]]), noArea);
    const res = await aggregatePanel(
      source([2016], () => [row('A')]),
      ev,
      EDGES
    );
    const bins = PANEL_FEATURES.map((f) => binIndex(EDGES[f], FEATS[f])).join(',');
    expect(res.cells.get(`2016|${bins}|1`)).toMatchObject({ exposure: 1, events: 1 });
    expect(res.cells.get(`2016|${bins}|0`)).toMatchObject({ exposure: 1, events: 0 });
    expect(res.events).toEqual({ record: 0, permit: 1 });
  });

  it('a hostableBase-false parcel-year gives no exposure; its event is off panel', async () => {
    const ev = initiationEvents([hist('h', ['A'], { filed: d('2016-03-10') })], new Map(), noArea);
    const res = await aggregatePanel(
      source([2015, 2016], (y) => [row('A', { hostableBase: y !== 2016 })]),
      ev,
      EDGES
    );
    expect(res.exposureMonths).toBe(12);
    expect(res.parcelYears).toBe(1);
    expect(res.events).toEqual({ record: 0, permit: 0 });
    expect(res.eventsOffPanel).toBe(1);
  });

  it('counts an event in a year with no panel row as off panel', async () => {
    const ev = initiationEvents([hist('h', ['A'], { filed: d('2016-03-10') })], new Map(), noArea);
    const res = await aggregatePanel(
      source([2016], () => [row('B')]),
      ev,
      EDGES
    );
    expect(res.eventsOffPanel).toBe(1);
    expect(res.exposureMonths).toBe(12);
  });

  it('passes features through: raw bins are binIndex of the row values', async () => {
    const feats: Record<FeatureId, number> = {
      potentialRatio: 7.5,
      existingUnits: 0,
      lotAreaM2: 1200,
      yearBuilt: 0,
      storiesGap: -2,
      improvementShare: 0,
      rentControlLikely: 0,
      landUseClass: 4
    };
    const res = await aggregatePanel(
      source([2020], () => [row('A', { features: feats })]),
      initiationEvents([], new Map(), noArea),
      EDGES
    );
    const [cell] = [...res.cells.values()];
    expect(cell.bins).toEqual(PANEL_FEATURES.map((f) => binIndex(EDGES[f], feats[f])));
    expect(cell.bins).toEqual([3, 0, 2, 0, 0, 0, 0, 4]);
    expect(res.maxAtRisk).toEqual({ potentialRatio: 7.5, storiesGap: -2 });
  });

  it('takes maxAtRisk over at-risk rows only', async () => {
    const h = hist(
      'h',
      ['A'],
      { filed: d('2019-06-01'), complete: d('2019-07-01') },
      { kind: 'complete', day: d('2019-07-01') }
    );
    const big = { ...FEATS, potentialRatio: 40, storiesGap: 12 };
    const res = await aggregatePanel(
      source([2019, 2020], (y) => [row('A', { features: y === 2020 ? big : FEATS })]),
      initiationEvents([h], new Map(), noArea),
      EDGES
    );
    expect(res.maxAtRisk).toEqual({ potentialRatio: 3, storiesGap: 4 });
  });

  it('counts each mask bit 0..6 over exposure and event months', async () => {
    // Events (open, so covered afterwards): A 2020-04 (4 at-risk months in 2020), D 2020-01
    // (1 month), G 2020-07 (7 months). Every other row is at risk all 12 months.
    //   row  bits         exposure  events
    //   A    0, 1         4         1
    //   B    2            12        0
    //   C    3, 4         12        0
    //   D    5            1         1
    //   E    none         12        0
    //   G    6            7         1     (an event on bit 6 alone)
    //   H    3, 6         12        0
    const ev = initiationEvents(
      [
        hist('hA', ['A'], { filed: d('2020-04-02') }),
        hist('hD', ['D'], { filed: d('2020-01-15') }),
        hist('hG', ['G'], { filed: d('2020-07-20') })
      ],
      new Map(),
      noArea
    );
    const res = await aggregatePanel(
      source([2020], () => [
        row('A', { imputed: 0b0000011 }),
        row('B', { imputed: 0b0000100 }),
        row('C', { imputed: 0b0011000 }),
        row('D', { imputed: 0b0100000 }),
        row('E', { imputed: 0 }),
        row('G', { imputed: 0b1000000 }),
        row('H', { imputed: 0b1001000 })
      ]),
      ev,
      EDGES
    );
    expect(res.exposureMonths).toBe(60);
    expect(res.events).toEqual({ record: 3, permit: 0 });
    expect(res.mask.exposure).toEqual([4, 4, 12, 24, 12, 1, 19]);
    expect(res.mask.events).toEqual([1, 1, 0, 0, 0, 1, 1]);
    expect(res.mask.anyExposure).toBe(48);
    expect(res.mask.anyEvents).toBe(3);
  });

  it('counts excluded parcel-years: non-hostable rows, timeline parcels with no row', async () => {
    // Timeline parcels: A (event 2016-03) and Z (no row in any year).
    const ev = initiationEvents(
      [hist('h', ['A'], { filed: d('2016-03-10') }), hist('z', ['Z'], { filed: d('2016-05-01') })],
      new Map(),
      noArea
    );
    const res = await aggregatePanel(
      source([2015, 2016, 2017], (y) =>
        y === 2017
          ? [row('A'), row('B', { hostableBase: false })]
          : [row('A', { hostableBase: y !== 2016 }), row('B', { hostableBase: false })]
      ),
      ev,
      EDGES
    );
    // 2015: B + Z; 2016: A + B + Z; 2017: B + Z.
    expect(res.parcelYearsExcludedByYear).toEqual({ 2015: 2, 2016: 3, 2017: 2 });
    expect(res.parcelYearsExcluded).toBe(7);
    expect(res.parcelYears).toBe(2);
  });

  it('throws CalibrationError on imputed bit 7', async () => {
    const run = aggregatePanel(
      source([2020], () => [row('A'), row('B', { imputed: 0x81 })]),
      initiationEvents([], new Map(), noArea),
      EDGES
    );
    await expect(run).rejects.toThrow(CalibrationError);
    await expect(
      aggregatePanel(
        source([2020], () => [row('B', { imputed: 0x80 })]),
        initiationEvents([], new Map(), noArea),
        EDGES
      )
    ).rejects.toThrow('panel imputed bit 7 set: B 2020');
  });

  it('rejects rows out of mapblklot order', async () => {
    await expect(
      aggregatePanel(
        source([2020], () => [row('B'), row('A')]),
        initiationEvents([], new Map(), noArea),
        EDGES
      )
    ).rejects.toThrow(CalibrationError);
  });
});

describe('duckPanelSource', () => {
  let db: Duck | undefined;
  afterAll(() => db?.close());

  it('reads scenario_panel one roll year at a time into the same result', async () => {
    db = await openDuck();
    const cols: [string, string][] = [
      ['mapblklot', 'VARCHAR'],
      ['roll_year', 'INTEGER'],
      ['hostable_base', 'BOOLEAN'],
      ['imputed', 'UTINYINT'],
      ['potential_ratio_base', 'FLOAT'],
      ['existing_units', 'INTEGER'],
      ['lot_area_m2', 'INTEGER'],
      ['year_built', 'INTEGER'],
      ['stories_gap_base', 'INTEGER'],
      ['improvement_share', 'FLOAT'],
      ['rent_control_likely', 'BOOLEAN'],
      ['land_use_class', 'INTEGER']
    ];
    const rows: CellValue[][] = [];
    for (const y of [2006, 2015, 2016, 2026]) {
      for (const p of ['B', 'A']) {
        rows.push([
          p,
          y,
          p === 'A' || y !== 2016,
          p === 'B' ? 4 : 0,
          3.5,
          2,
          300,
          1925,
          7,
          0.25,
          true,
          5
        ]);
      }
    }
    await createTableFromRows(db, 'scenario_panel', cols, rows);
    const src = await duckPanelSource(db);
    expect(src.years).toEqual([2015, 2016]);
    const r2015 = await src.read(2015);
    expect(r2015.map((r) => r.mapblklot)).toEqual(['A', 'B']);
    // Every feature and `imputed` has a distinct value, so a swapped column mapping fails.
    expect(r2015[1]).toEqual({
      mapblklot: 'B',
      hostableBase: true,
      imputed: 4,
      features: {
        potentialRatio: 3.5,
        existingUnits: 2,
        lotAreaM2: 300,
        yearBuilt: 1925,
        storiesGap: 7,
        improvementShare: 0.25,
        rentControlLikely: 1,
        landUseClass: 5
      }
    });

    const ev = initiationEvents([hist('h', ['A'], { filed: d('2016-03-10') })], new Map(), noArea);
    const fromDuck = await aggregatePanel(src, ev, EDGES);
    expect(fromDuck.exposureMonths).toBe(12 + 12 + 3);
    expect(fromDuck.events).toEqual({ record: 1, permit: 0 });
    expect(fromDuck.mask.exposure[2]).toBe(12);
    expect(fromDuck.years).toEqual([2015, 2016]);
    expect(fromDuck.parcelYearsExcludedByYear).toEqual({ 2015: 0, 2016: 1 });

    // A null hostable_base breaks the T13 contract (BOOLEAN, never null).
    await db.run(
      "UPDATE scenario_panel SET hostable_base = NULL WHERE mapblklot = 'A' AND roll_year = 2015"
    );
    await expect(src.read(2015)).rejects.toThrow(CalibrationError);
    await expect(src.read(2015)).rejects.toThrow('panel hostable_base null: A 2015');
  });
});
