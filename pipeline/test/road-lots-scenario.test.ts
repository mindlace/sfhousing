// Road-like lots in the scenario step (road-lots Task 6): the scenario.road_like.* counts, the
// T11 and panel rows of lots 20-24, and the review list road-lots.csv, on the mini build.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ROAD_LIKE_REASONS } from '../../src/lib/data/parcel';
import { readRoadLotRows, ROAD_LOTS_CSV, writeRoadLotsCsv } from '../lib/road-lots';
import { lesscarsMini, type LessCarsMini } from './lesscars-helpers';

const FIVE: [string, string][] = [
  ['3512020', 'r1n'],
  ['3512021', 'r2s'],
  ['3512022', 'r3'],
  ['3512023', 'r7'],
  ['3512024', 'override']
];
const KEPT = '3513001';

let mini: LessCarsMini;
let counts: Record<string, number>;
beforeAll(async () => {
  mini = await lesscarsMini();
  counts = mini.counts;
});

describe('road-like lots in the scenario step', () => {
  it('counts road-like lots per reason and what the rule removed', () => {
    expect(counts['scenario.road_like.lots']).toBe(5);
    for (const r of ROAD_LIKE_REASONS) expect(counts[`scenario.road_like.lots.${r}`], r).toBe(1);
    expect(counts['scenario.road_like.net_removed']).toBe(
      ROAD_LIKE_REASONS.reduce((s, r) => s + counts[`scenario.road_like.net_removed.${r}`], 0)
    );
    expect(counts['scenario.road_like.unhostable']).toBe(
      ROAD_LIKE_REASONS.reduce((s, r) => s + counts[`scenario.road_like.unhostable.${r}`], 0)
    );
    // Lots 23 and 24 are 18 m x 16-20 m under 40//65-R-4: hostable but for the rule.
    expect(counts['scenario.road_like.net_removed']).toBeGreaterThan(0);
    expect(counts['scenario.road_like.unhostable.r7']).toBe(1);
    expect(counts['scenario.road_like.unhostable.override']).toBe(1);
  });

  it('road-like rows are ineligible and unhostable on T11 and on the panel; their homes are kept', async () => {
    const p = mini.parcels;
    const recs = new Map(mini.records.map(({ rec }) => [rec.id, rec]));
    for (const [id] of FIVE) {
      const i = p.index.get(id);
      expect(i, id).toBeDefined();
      expect([p.eligible[i!], p.hostable[i!], p.hostableBase[i!]], id).toEqual([0, 0, 0]);
      expect(p.existingUnits[i!], id).toBe(recs.get(id)!.existingUnits);
    }
    const panel = await mini.db.all<{ roll_year: number; hostable_base: boolean }>(
      `SELECT roll_year, hostable_base FROM scenario_panel WHERE mapblklot = '3512021'`
    );
    expect(panel.length).toBeGreaterThan(0);
    expect(panel.every((r) => r.hostable_base === false)).toBe(true);
  });

  it('counts road-like lots with roll homes', () => {
    expect(counts['scenario.road_like.with_roll_units']).toBe(0);
  });

  it('reads road_lots with each lot reason and its eligibility without the rule', async () => {
    const rows = await readRoadLotRows(mini.db);
    expect([...rows].map(([id, r]) => [id, r.reason])).toEqual(FIVE);
    expect([...rows.values()].every((r) => r.eligibleWithout)).toBe(true);
  });

  it('writes road-lots.csv with the raw-flagged, kept and listed lots', () => {
    const text = readFileSync(join(mini.derivedDir, ROAD_LOTS_CSV), 'utf8');
    const [head, ...lines] = text.trimEnd().split('\n');
    const cols = head.split(',');
    expect(cols.slice(0, 4)).toEqual(['id', 'reason', 'r7', 'r1n']);
    const rows = lines.map((l) => Object.fromEntries(l.split(',').map((v, k) => [cols[k], v])));
    expect(rows.map((r) => r.id).sort()).toEqual([...FIVE.map(([id]) => id), KEPT].sort());
    for (const [id, reason] of FIVE) {
      expect(
        rows.find((r) => r.id === id),
        id
      ).toMatchObject({ reason, keptBy: '' });
    }
    expect(rows.find((r) => r.id === KEPT)).toMatchObject({
      reason: '',
      keptBy: 'Fixture: a housing site on a strip',
      r1n: 'true'
    });
    expect(rows.find((r) => r.id === '3512024')).toMatchObject({ listed: 'true' });
    // Sorted by net homes, largest first.
    const net = rows.map((r) => Number(r.netHomes));
    expect(net).toEqual([...net].sort((a, b) => b - a));
    expect(net[0]).toBeGreaterThan(0);
  });
});

describe('writeRoadLotsCsv', () => {
  it('sorts by net homes then id, rounds to 3 decimals (label point 6) and quotes text', () => {
    const row = {
      id: '0001001',
      reason: 'r7' as const,
      r7: true,
      r1n: false,
      r2s: false,
      r3: false,
      keptBy: null,
      listed: false,
      landName: 'DPW "ROW", REMAINDER',
      department: null,
      zoning: 'P',
      rollClass: null,
      cover: 0.0123456,
      micR: null,
      streetShare: 1,
      nearestStreet: 'MAIN ST',
      nearestM: 3.14159,
      areaM2: 100.0004,
      netHomes: 3,
      lng: -122.4123456,
      lat: 37.7654321
    };
    const file = join(mkdtempSync(join(tmpdir(), 'sfh-road-csv-')), 'road-lots.csv');
    writeRoadLotsCsv(file, [
      { ...row, id: '0001003', netHomes: 0 },
      { ...row, id: '0001002' },
      row
    ]);
    const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(4);
    expect(lines.slice(1).map((l) => l.split(',')[0])).toEqual(['0001001', '0001002', '0001003']);
    expect(lines[1]).toContain('"DPW ""ROW"", REMAINDER"');
    expect(lines[1]).toContain(',0.012,');
    expect(lines[1]).toContain(',3.142,');
    expect(lines[1]).toContain(',-122.412346,37.765432');
  });
});
