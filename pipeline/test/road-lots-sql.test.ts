import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeParcelChunk, encodeParcelChunk } from '../../src/lib/data/parcel-chunk';
import type { Duck } from '../lib/duck';
import { readFreewayLandSet } from '../lib/lesscars/freeway-land';
import {
  loadRoadLotInputs,
  readRoadLots,
  ROAD_LOTS_JSON,
  roadLotProblems,
  type RoadLotsFile
} from '../lib/road-lots';
import { runSql } from '../lib/sql';
import { LESSCARS_FREEWAY_LAND_JSON } from '../lesscars-config';
import { readParcelRecords } from '../steps/chunks';
import { miniDuck, openMiniDuck } from './helpers';

const GOLDEN_PARCELS = 'e2e/fixtures/data/fixture-0/parcels';
const FIVE: [string, string][] = [
  ['3512020', 'r1n'],
  ['3512021', 'r2s'],
  ['3512022', 'r3'],
  ['3512023', 'r7'],
  ['3512024', 'override']
];

let db: Duck;
let counts: Record<string, number>;

const evalRow = async (id: string) => {
  const rows = await db.all<Record<string, unknown>>(
    `SELECT * FROM road_lot_eval WHERE id = '${id}'`
  );
  expect(rows, `road_lot_eval row for ${id}`).toHaveLength(1);
  return rows[0];
};
const inRoadLots = async (id: string) =>
  (await db.all(`SELECT 1 FROM road_lots WHERE id = '${id}'`)).length > 0;
const count = (key: string) => counts[key];
const readCounts = async () =>
  Object.fromEntries(
    (await db.all<{ key: string; value: number }>('SELECT key, value FROM report_counts')).map(
      (r) => [r.key, r.value]
    )
  );

describe('55_road_lots on the mini fixture', () => {
  beforeAll(async () => {
    db = await miniDuck();
    await runSql(db);
    counts = await readCounts();
  });

  it('flags one mini lot per reason, and lot 24 by its road row', async () => {
    expect(await db.all('SELECT id, reason FROM road_lots ORDER BY id')).toEqual(
      FIVE.map(([id, reason]) => ({ id, reason }))
    );
  });

  it('lot 22 is R3 alone with cover between 0.05 and 0.25', async () => {
    const r = await evalRow('3512022');
    expect(r).toMatchObject({ r3: true, r1n: false, r2s: false, r7: false, raw: true });
    expect(r.cover).toBeGreaterThan(0.05);
    expect(r.cover).toBeLessThan(0.25);
    expect(r).toMatchObject({ nearest_layer: 'FREEWAYS' });
    expect(r.nearest_m).toBeCloseTo(28.5, 0);
  });

  it('lot 21 is public by roll class only and lot 23 by City Lands only', async () => {
    expect(await evalRow('3512021')).toMatchObject({
      zoning_code: 'RH-2',
      roll_class: 'VPUB',
      land_name: null,
      r2s: true
    });
    expect(await evalRow('3512023')).toMatchObject({
      zoning_code: 'RH-1',
      roll_class: null,
      land_name: 'SLOPE PROTECTION AT FIXTURE AVE',
      r7: true
    });
    // 53 m from I-80: not R3.
    expect(await evalRow('3512023')).toMatchObject({ r3: false });
  });

  it('lot 20 is R1n: a strip narrower than 3.5 m in radius, away from every street band', async () => {
    const r = await evalRow('3512020');
    expect(r).toMatchObject({ r1n: true, r2s: false, r3: false, r7: false, raw: true });
    expect(r.mic_r).toBeCloseTo(2.5, 1);
  });

  it('a keep row by block keeps every flagged lot of the block', async () => {
    expect(await evalRow('3513001')).toMatchObject({
      raw: true,
      r1n: true,
      kept_by: 'Fixture: a housing site on a strip'
    });
    expect(await inRoadLots('3513001')).toBe(false);
    expect(count('road_like.kept')).toBe(1);
  });

  it('catalog land is never road-like (lot 19 fires R3)', async () => {
    expect(await evalRow('3512019')).toMatchObject({ r3: true, in_catalog: true, raw: false });
    expect(await inRoadLots('3512019')).toBe(false);
    expect(count('road_like.catalog_excluded')).toBe(1);
  });

  it('a City Lands row covering a tenth of lot 1 does not name it; two rows name no lot', async () => {
    expect(await db.all("SELECT 1 FROM road_lot_eval WHERE id = '3512001'")).toEqual([]);
    expect(count('road_like.city_lands.rows')).toBe(4);
    expect(count('road_like.city_lands.named_lots')).toBe(2);
    expect(count('road_like.city_lands.unmatched')).toBe(2);
  });

  it('lot 12 (P, 7 homes) and lots 7 and 9 (P, no building) are not road-like', async () => {
    expect(await evalRow('3512012')).toMatchObject({ units: 7, raw: false });
    for (const id of ['3512007', '3512009']) {
      expect(await evalRow(id), id).toMatchObject({
        units: 0,
        cover: 0,
        r7: false,
        r1n: false,
        r2s: false,
        r3: false,
        raw: false
      });
    }
    for (const id of ['3512007', '3512009', '3512012']) expect(await inRoadLots(id)).toBe(false);
  });

  it('reports the rule counts', () => {
    // P lots 7, 9, 12, 19, 20, 22, 24 and 25 (3513001); lot 21 by roll class; lot 23 by City Lands.
    expect(count('road_like.candidates')).toBe(10);
    expect(count('road_like.raw')).toBe(5);
    expect(count('road_like.raw.r7')).toBe(1);
    expect(count('road_like.raw.r1n')).toBe(2);
    expect(count('road_like.raw.r2s')).toBe(1);
    expect(count('road_like.raw.r3')).toBe(1);
    expect(count('road_like.listed')).toBe(1);
    expect(count('road_like.lots')).toBe(5);
    for (const [, reason] of FIVE) expect(count(`road_like.lots.${reason}`), reason).toBe(1);
  });

  it('tallies sd.parcels.road-like over every parcel', async () => {
    expect(
      await db.all(
        `SELECT fired::INTEGER AS fired, "of"::INTEGER AS n FROM quality_tally
         WHERE rule_id = 'sd.parcels.road-like'`
      )
    ).toEqual([{ fired: 5, n: 25 }]);
    expect(
      (
        await db.all<{ id: string }>(
          `SELECT record_id AS id FROM quality_sample WHERE rule_id = 'sd.parcels.road-like'
           ORDER BY record_id`
        )
      ).map((r) => r.id)
    ).toEqual(FIVE.map(([id]) => id));
  });

  it('road-like lots are ineligible in parcel_out and carry the reason; outline and units unchanged', async () => {
    expect(await db.all('SELECT count(*)::INTEGER AS n FROM parcel_out')).toEqual([{ n: 25 }]);
    const rows = await db.all<{ id: string; eligible: boolean; road_like: string; ew: boolean }>(
      `SELECT o.id, o.eligible, o.road_like, r.eligible_without AS ew
       FROM parcel_out o JOIN road_lots r USING (id) ORDER BY o.id`
    );
    expect(rows).toEqual(
      FIVE.map(([id, reason]) => ({ id, eligible: false, road_like: reason, ew: true }))
    );
    expect(
      await db.all('SELECT count(*)::INTEGER AS n FROM parcel_out WHERE road_like IS NOT NULL')
    ).toEqual([{ n: 5 }]);
    const golden = new Map(
      fs
        .readdirSync(GOLDEN_PARCELS)
        .flatMap((f) => decodeParcelChunk(fs.readFileSync(path.join(GOLDEN_PARCELS, f), 'utf8')))
        .map((r) => [r.id, r])
    );
    const recs = await readParcelRecords(db);
    for (const [id] of FIVE) {
      const { rec, cellId } = recs.find((r) => r.rec.id === id)!;
      const [round] = decodeParcelChunk(encodeParcelChunk('x', cellId, [rec]));
      expect(round.existingUnits, id).toBe(0);
      expect(round.polygon, id).toEqual(golden.get(id)!.polygon);
      expect(round.existingUnits, id).toBe(golden.get(id)!.existingUnits);
    }
  });

  it('chunk records carry roadLike', async () => {
    const recs = await readParcelRecords(db);
    expect(recs.filter((r) => r.rec.roadLike).map((r) => [r.rec.id, r.rec.roadLike])).toEqual(FIVE);
  });

  it('roadLotProblems is empty on the fixture inputs', async () => {
    expect(await roadLotProblems(db)).toEqual([]);
  });

  describe('bad override rows', () => {
    afterAll(async () => {
      await loadRoadLotInputs(
        db,
        readFreewayLandSet(LESSCARS_FREEWAY_LAND_JSON.fixture),
        readRoadLots(ROAD_LOTS_JSON.fixture)
      );
      await runSql(db);
    });

    it('roadLotProblems names each bad override row', async () => {
      const bad: RoadLotsFile = {
        keep: [
          { parcel: '9999999', reason: 'unknown parcel' },
          { block: '9998', reason: 'unknown block' },
          { parcel: '3512001', reason: 'stale' }
        ],
        road: [
          { parcel: '3512020', reason: 'already flagged' },
          { parcel: '3512019', reason: 'catalog' }
        ]
      };
      await loadRoadLotInputs(db, readFreewayLandSet(LESSCARS_FREEWAY_LAND_JSON.fixture), bad);
      await runSql(db);
      const problems = await roadLotProblems(db);
      expect(problems).toHaveLength(5);
      expect(problems).toEqual([...problems].sort());
      for (const want of [
        /keep parcel 9999999.*no parcel/,
        /keep block 9998.*no parcel/,
        /keep parcel 3512001.*does not flag/,
        /road parcel 3512020.*already flags/,
        /road parcel 3512019.*catalog/
      ]) {
        expect(
          problems.some((p) => want.test(p)),
          String(want)
        ).toBe(true);
      }
      // The catalog parcel stays out of road_lots even when listed.
      expect(await inRoadLots('3512019')).toBe(false);
    });
  });
});

describe('55_road_lots without loaded inputs', () => {
  it('runSql runs with no catalog and no overrides', async () => {
    const fresh = await openMiniDuck({ roadLotInputs: false });
    try {
      await runSql(fresh);
      const rows = await fresh.all<{ id: string; reason: string }>(
        'SELECT id, reason FROM road_lots ORDER BY id'
      );
      // No keep row: lot 25 (3513001) is road-like; no catalog: lot 19 (3512019) is R3; no road
      // row: lot 24 is not.
      expect(rows).toEqual([
        { id: '3512019', reason: 'r3' },
        { id: '3512020', reason: 'r1n' },
        { id: '3512021', reason: 'r2s' },
        { id: '3512022', reason: 'r3' },
        { id: '3512023', reason: 'r7' },
        { id: '3513001', reason: 'r1n' }
      ]);
      expect(await roadLotProblems(fresh)).toEqual([]);
    } finally {
      fresh.close();
    }
  });
});
