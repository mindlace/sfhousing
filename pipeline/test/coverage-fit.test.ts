import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BLOCK_FIT, fitBlockCoverage } from '../lib/coverage-fit';
import { createTableFromRows, openDuck, type Duck } from '../lib/duck';

/** A lon/lat rectangle in San Francisco, as WKT. */
const box = (x0: number, y0: number, x1: number, y1: number) =>
  `POLYGON((${x0} ${y0}, ${x1} ${y0}, ${x1} ${y1}, ${x0} ${y1}, ${x0} ${y0}))`;
const LON = -122.42;
const LAT = 37.77;
const W = 0.0004;
/** Lot i: a W × W degree square; its footprint covers `share` of it (cut across longitude). */
const lot = (i: number) => box(LON + i * 0.001, LAT, LON + i * 0.001 + W, LAT + W);
const footprint = (i: number, share: number) =>
  box(LON + i * 0.001, LAT, LON + i * 0.001 + W * share, LAT + W);

let db: Duck;

describe('fitBlockCoverage', () => {
  beforeAll(async () => {
    db = await openDuck();
    const year = 2024;
    // [id (blklot and mapblklot), roll rows as [stories, built], footprint share (null: none)]
    const lots: [string, [number, number][], number | null][] = [
      ['0000001', [[20, 2010]], 0.5],
      ['0000002', [[13, 2005]], 0.8],
      ['0000003', [[40, 2016]], 0.9],
      ['0000004', [[12, 2010]], 0.1], // too low
      ['0000005', [[20, 2004]], 0.1], // too old
      ['0000006', [[20, 2017]], 0.1], // after the footprint capture
      ['0000007', [[999, 2010]], 0.1], // a roll entry error
      ['0000008', [[20, 2010]], null] // no footprint
    ];
    await createTableFromRows(
      db,
      'src_roll',
      [
        ['closed_roll_year', 'INTEGER'],
        ['parcel_number', 'VARCHAR'],
        ['number_of_stories', 'INTEGER'],
        ['year_property_built', 'INTEGER']
      ],
      [
        ...lots.flatMap(([id, rows]) => rows.map(([s, b]) => [year, id, s, b])),
        // a condo unit of lot 1, and an older roll year that never counts
        [year, '0000001A', 20, 2010],
        [year - 1, '0000004', 20, 2010]
      ]
    );
    await createTableFromRows(
      db,
      'src_parcels_raw',
      [
        ['mapblklot', 'VARCHAR'],
        ['blklot', 'VARCHAR'],
        ['active', 'BOOLEAN'],
        ['wkt', 'VARCHAR']
      ],
      [...lots.map(([id], i) => [id, id, true, lot(i)]), ['0000001', '0000001A', true, lot(0)]]
    );
    await db.run(
      'CREATE TABLE src_parcels AS SELECT mapblklot, blklot, active, ST_GeomFromText(wkt) AS geom FROM src_parcels_raw'
    );
    const fps = lots.flatMap(([, , share], i) => (share === null ? [] : [[footprint(i, share)]]));
    await createTableFromRows(db, 'src_footprints_raw', [['wkt', 'VARCHAR']], fps);
    await db.run(
      'CREATE TABLE src_footprints AS SELECT ST_GeomFromText(wkt) AS geom FROM src_footprints_raw'
    );
  });
  afterAll(() => db?.close());

  it('takes the median footprint share of lots with tall buildings built 2005 to 2016', async () => {
    expect(BLOCK_FIT).toEqual({ minStories: 13, minYear: 2005, footprintYear: 2016 });
    const fit = await fitBlockCoverage(db);
    expect(fit.n).toBe(3);
    expect(fit.median).toBeCloseTo(0.8, 3);
  });
});
