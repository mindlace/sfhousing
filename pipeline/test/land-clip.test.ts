import { describe, expect, it } from 'vitest';
import type { Duck } from '../lib/duck';
import { landCounts, landDb, type LandInput, type Rect } from './land-helpers';

/** The shared earth tile, its feature the whole tile. */
const T: Rect = [0, 0, 100, 100];
const EARTH = [{ layer: 'earth' as const, tile: T, rect: T }];

const one = (rect: Rect, extra: Partial<LandInput> = {}) =>
  landDb({ lots: [{ id: 'L', rect }], land: EARTH, ...extra });

interface LotRow {
  status: string;
  orig_m2: number;
  dry_m2: number;
  removed_m2: number;
  n_pieces: number;
  same: boolean;
  underwater: boolean;
  label_inside: boolean;
  orig_area: number;
  label_lng: number;
  label_lat: number;
}

async function lot(db: Duck, id = 'L'): Promise<LotRow> {
  const [r] = await db.all<LotRow>(
    `SELECT l.status, l.orig_m2, l.dry_m2, l.removed_m2, l.n_pieces,
            hex(ST_AsWKB(p.geom)) = hex(ST_AsWKB(p.geom_orig)) AS same, p.underwater,
            ST_Contains(p.geom, ST_Point(p.x0, p.y0)) AS label_inside,
            ST_Area(p.geom_orig) AS orig_area, p.label_lng, p.label_lat
     FROM parcel_land l JOIN parcels p USING (id) WHERE id = '${id}'`
  );
  return r;
}

describe('45_land', () => {
  it('leaves an inland lot byte-identical', async () => {
    const before = await landDb({ lots: [{ id: 'L', rect: [10, 10, 40, 40] }], land: [] });
    const [b] = await before.all<{ label_lng: number; label_lat: number }>(
      'SELECT label_lng, label_lat FROM parcels'
    );
    const r = await lot(await one([10, 10, 40, 40]));
    expect(r.status).toBe('unchanged');
    expect(r.same).toBe(true);
    expect(r.underwater).toBe(false);
    expect([r.label_lng, r.label_lat]).toEqual([b.label_lng, b.label_lat]);
  });

  it('clips a shoreline lot to its dry part and relabels it', async () => {
    const r = await lot(await one([80, 10, 120, 40]));
    expect(r.status).toBe('clipped');
    expect(r.dry_m2).toBeCloseTo(600, 0);
    expect(Math.abs(r.dry_m2 - 600)).toBeLessThanOrEqual(0.5);
    expect(r.removed_m2).toBeCloseTo(600, 0);
    expect(r.n_pieces).toBe(1);
    expect(r.label_inside).toBe(true);
    expect(r.orig_area).toBeCloseTo(1200, 3);
    expect(r.underwater).toBe(false);
  });

  it('clips each feature to its own tile', async () => {
    const db = await landDb({
      lots: [{ id: 'L', rect: [80, 10, 120, 40] }],
      land: [{ layer: 'earth', tile: T, rect: [0, 0, 115, 100] }]
    });
    const r = await lot(db);
    expect(r.status).toBe('clipped');
    expect(Math.abs(r.dry_m2 - 600)).toBeLessThanOrEqual(0.5);
  });

  it('closes the seam between adjacent tiles', async () => {
    const a: Rect = [0, 0, 50, 100];
    const b: Rect = [50.02, 0, 100, 100];
    const db = await landDb({
      lots: [{ id: 'L', rect: [40, 10, 60, 40] }],
      land: [
        { layer: 'earth', tile: a, rect: a },
        { layer: 'earth', tile: b, rect: b }
      ]
    });
    expect(await db.all('SELECT ST_NumGeometries(geom)::INTEGER n FROM land_mask')).toEqual([
      { n: 1 }
    ]);
    expect((await lot(db)).status).toBe('unchanged');
  });

  it('keeps a lot that loses less than 5 m² exactly as it was', async () => {
    const db = await one([70, 50, 100.1, 80]);
    const r = await lot(db);
    expect(r.status).toBe('jitter');
    expect(r.same).toBe(true);
    // About 3 m² (0.1 m × 30 m), plus the skew of the tile's meridian against the 7131 grid.
    expect(Math.abs(r.removed_m2 - 3)).toBeLessThan(0.5);
    const c = await landCounts(db);
    expect(c['land.jitter_kept']).toBe(1);
    expect(c['land.clipped']).toBe(0);
  });

  it('flags a lot with no dry land as underwater and keeps its outline', async () => {
    const db = await one([120, 10, 140, 40]);
    const r = await lot(db);
    expect(r.status).toBe('underwater');
    expect(r.underwater).toBe(true);
    expect(r.same).toBe(true);
    expect(r.dry_m2).toBe(0);
    expect(r.n_pieces).toBe(0);
    const c = await landCounts(db);
    expect(c['land.underwater']).toBe(1);
    expect(c['land.underwater_m2']).toBeCloseTo(600, 3);
  });

  it('counts land under an existing building as dry and keeps every dry piece', async () => {
    const db = await one([80, 10, 120, 40], { buildings: [[105, 15, 111, 25]] });
    const r = await lot(db);
    expect(r.status).toBe('clipped');
    expect(Math.abs(r.dry_m2 - 660)).toBeLessThanOrEqual(0.5);
    expect(r.n_pieces).toBe(2);
    expect(await db.all('SELECT ST_NumGeometries(geom)::INTEGER n FROM parcels')).toEqual([
      { n: 2 }
    ]);
    expect((await landCounts(db))['land.building_kept_m2']).toBeCloseTo(60, 1);
  });

  it('counts a pier polygon as land', async () => {
    const db = await landDb({
      lots: [{ id: 'L', rect: [100, 50, 110, 60] }],
      land: [...EARTH, { layer: 'pier', tile: [100, 0, 200, 100], rect: [100, 50, 110, 60] }]
    });
    const r = await lot(db);
    expect(r.status).toBe('unchanged');
    expect(r.same).toBe(true);
  });

  it('treats dry pieces under 2 m² as water', async () => {
    const r = await lot(await one([99.5, 10, 120, 12]));
    expect(r.status).toBe('underwater');
    expect(r.underwater).toBe(true);
  });

  it('builds the same mask and lots twice', async () => {
    const input: LandInput = {
      lots: [
        { id: 'A', rect: [10, 10, 40, 40] },
        { id: 'B', rect: [80, 10, 120, 40] },
        { id: 'C', rect: [120, 50, 140, 60] }
      ],
      land: [
        { layer: 'earth', tile: [0, 0, 50, 100], rect: [0, 0, 50, 100] },
        { layer: 'earth', tile: [50.02, 0, 100, 100], rect: [50.02, 0, 100, 100] }
      ],
      buildings: [[105, 15, 111, 25]]
    };
    const snap = async (db: Duck) => [
      await db.all('SELECT hex(ST_AsWKB(geom)) h FROM land_mask'),
      await db.all('SELECT id, hex(ST_AsWKB(geom)) h FROM parcels ORDER BY id'),
      await db.all('SELECT * FROM parcel_land')
    ];
    expect(await snap(await landDb(input))).toEqual(await snap(await landDb(input)));
  });

  it('counts lots outside the tile coverage', async () => {
    const c = await landCounts(await one([300, 0, 320, 20]));
    expect(c['land.outside_tiles']).toBe(1);
    expect(c['land.tiles']).toBe(1);
  });

  it('counts a lot partly outside the tile coverage', async () => {
    const c = await landCounts(await one([80, 10, 120, 40]));
    expect(c['land.outside_tiles']).toBe(1);
  });

  it('reports every land count', async () => {
    const db = await landDb({
      lots: [
        { id: 'A', rect: [10, 10, 40, 40] },
        { id: 'B', rect: [80, 10, 120, 40] },
        { id: 'C', rect: [120, 50, 140, 60] }
      ],
      land: EARTH
    });
    const c = await landCounts(db);
    expect(Object.keys(c).sort()).toEqual([
      'land.building_kept_m2',
      'land.clipped',
      'land.jitter_kept',
      'land.mask_area_m2',
      'land.outside_tiles',
      'land.removed_m2',
      'land.tiles',
      'land.underwater',
      'land.underwater_m2'
    ]);
    // The tile's corners are cut a little by its meridians and parallels (skewed against 7131).
    expect(Math.abs(c['land.mask_area_m2'] - 10000)).toBeLessThan(5);
    expect(c['land.clipped']).toBe(1);
    expect(c['land.underwater']).toBe(1);
    expect(c['land.removed_m2']).toBeCloseTo(600, 0);
    expect(c['land.underwater_m2']).toBeCloseTo(200, 3);
    expect(c['land.outside_tiles']).toBe(2);
    expect(await db.all('SELECT id, status FROM parcel_land')).toEqual([
      { id: 'A', status: 'unchanged' },
      { id: 'B', status: 'clipped' },
      { id: 'C', status: 'underwater' }
    ]);
  });

  it('tallies the land-clip and underwater rules', async () => {
    const db = await landDb({
      lots: [
        { id: 'A', rect: [10, 10, 40, 40] },
        { id: 'B', rect: [80, 10, 120, 40] },
        { id: 'C', rect: [120, 50, 140, 60] },
        { id: 'D', rect: [70, 50, 100.1, 80] }
      ],
      land: EARTH
    });
    expect(await db.all('SELECT * FROM quality_tally ORDER BY rule_id')).toEqual([
      { rule_id: 'sd.parcels.land-clip', fired: 1, of: 4, units: null, units_of: null },
      { rule_id: 'sd.parcels.underwater', fired: 1, of: 4, units: null, units_of: null }
    ]);
    expect(await db.all('SELECT * FROM quality_sample ORDER BY rule_id, record_id')).toEqual([
      { rule_id: 'sd.parcels.land-clip', record_id: 'B' },
      { rule_id: 'sd.parcels.underwater', record_id: 'C' }
    ]);
  });
});
