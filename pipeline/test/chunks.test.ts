import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { decodeParcelChunk } from '../../src/lib/data/parcel-chunk';
import type { ParcelRecord } from '../../src/lib/data/parcel';
import type { Duck } from '../lib/duck';
import { Report } from '../lib/report';
import { runSql } from '../lib/sql';
import { writeChunks, writeNeighborhoods } from '../steps/chunks';
import { miniDuck } from './helpers';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sfh-chunks-'));
const V = 'fixture-1';

describe('writeChunks / writeNeighborhoods on the mini fixture', () => {
  let db: Duck;
  let dirA: string;
  let outs: Awaited<ReturnType<typeof writeChunks>>;
  let report: Report;
  beforeAll(async () => {
    db = await miniDuck();
    await runSql(db);
    dirA = tmp();
    report = new Report();
    outs = await writeChunks(db, dirA, V, report);
  });

  it('puts every parcel in exactly one decodable chunk', async () => {
    const ids = (await db.all<{ id: string }>('SELECT id FROM parcel_out ORDER BY id')).map(
      (r) => r.id
    );
    const seen: ParcelRecord[] = [];
    expect(outs.map((o) => o.cellId)).toEqual([...outs.map((o) => o.cellId)].sort());
    for (const o of outs) {
      const recs = decodeParcelChunk(fs.readFileSync(path.join(dirA, o.path), 'utf8'));
      expect(recs).toHaveLength(o.parcelCount);
      seen.push(...recs);
    }
    expect(seen.map((r) => r.id).sort()).toEqual(ids);
    expect(new Set(seen.map((r) => r.id)).size).toBe(ids.length);
    const byId = new Map(seen.map((r) => [r.id, r]));
    expect(byId.has('0026T001A')).toBe(true);
    expect(byId.has('8711023C')).toBe(true);
    expect(byId.get('3512007')!.eligible).toBe(false);
    expect(byId.get('3512009')!.eligible).toBe(false);
    expect(report.counts['chunks.empty_polygon']).toBe(0);
    expect(report.counts['chunks.label_outside_local']).toBe(0);
  });

  it('rounds bbox outward to 1e-6 around every member extent; records sizes', async () => {
    const ext = await db.all<{
      id: string;
      x0: number;
      y0: number;
      xmin: number;
      ymin: number;
      xmax: number;
      ymax: number;
    }>('SELECT id, x0, y0, xmin, ymin, xmax, ymax FROM parcel_out');
    for (const o of outs) {
      const recs = decodeParcelChunk(fs.readFileSync(path.join(dirA, o.path), 'utf8'));
      const ids = new Set(recs.map((r) => r.id));
      const mem = ext.filter((e) => ids.has(e.id));
      const [w, s, e, n] = o.bbox;
      expect(w).toBeLessThanOrEqual(Math.min(...mem.map((m) => m.xmin)));
      expect(s).toBeLessThanOrEqual(Math.min(...mem.map((m) => m.ymin)));
      expect(e).toBeGreaterThanOrEqual(Math.max(...mem.map((m) => m.xmax)));
      expect(n).toBeGreaterThanOrEqual(Math.max(...mem.map((m) => m.ymax)));
      for (const v of o.bbox) expect(Math.abs(Math.round(v * 1e6) - v * 1e6)).toBeLessThan(1e-6);
      expect(w).toBeGreaterThan(Math.min(...mem.map((m) => m.xmin)) - 1e-6);
      expect(o.path).toBe(`parcels/${o.cellId}.json`);
      expect(o.rawBytes).toBe(fs.statSync(path.join(dirA, o.path)).size);
      expect(o.gzipBytes).toBeGreaterThan(0);
      expect(o.gzipBytes).toBeLessThan(o.rawBytes);
    }
  });

  it('is byte-deterministic across output dirs', async () => {
    const dirB = tmp();
    await writeChunks(db, dirB, V, new Report());
    const list = fs.readdirSync(path.join(dirA, 'parcels')).sort();
    expect(fs.readdirSync(path.join(dirB, 'parcels')).sort()).toEqual(list);
    for (const f of list) {
      expect(
        fs
          .readFileSync(path.join(dirB, 'parcels', f))
          .equals(fs.readFileSync(path.join(dirA, 'parcels', f)))
      ).toBe(true);
    }
  });

  it('writes neighborhoods.geojson with no whitespace', async () => {
    const bytes = await writeNeighborhoods(db, dirA);
    const raw = fs.readFileSync(path.join(dirA, 'neighborhoods.geojson'), 'utf8');
    expect(Buffer.byteLength(raw)).toBe(bytes);
    expect(raw).not.toMatch(/[\n\r\t]/);
    expect(raw).not.toMatch(/": /);
    expect(raw).not.toMatch(/, "/);
    const fc = JSON.parse(raw);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features.map((f: { properties: { name: string } }) => f.properties.name)).toEqual([
      'Bayview Hunters Point',
      'Mission',
      'Noe Valley'
    ]);
    expect(raw).toBe(JSON.stringify(fc));
  });
});

describe('writeChunks edge cases (stub db)', () => {
  const row = (over: Record<string, unknown>) => ({
    id: '1',
    label_lng: -122.4,
    label_lat: 37.7,
    x0: 500,
    y0: 500,
    units: 1,
    floor_area_m2: 10,
    height_m: 3,
    land_use: 'SFH',
    eligible: true,
    neighborhood: 'Mission',
    xmin: -122.4001,
    ymin: 37.6999,
    xmax: -122.3999,
    ymax: 37.7001,
    geojson7131: JSON.stringify({
      type: 'Polygon',
      coordinates: [
        [
          [490, 490],
          [510, 490],
          [510, 510],
          [490, 510],
          [490, 490]
        ]
      ]
    }),
    ...over
  });
  const stub = (rows: unknown[]): Duck => ({
    run: async () => {},
    all: async <T>() => rows as T[],
    close: () => {}
  });
  const collapsed = JSON.stringify({
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [0.001, 0],
        [0.001, 0.001],
        [0, 0]
      ]
    ]
  });

  it('keeps numeric-looking ids as strings, JS-sorted; negative and boundary cells', async () => {
    const dir = tmp();
    const rep = new Report();
    const outs = await writeChunks(
      stub([
        row({ id: '10', x0: 999.99, y0: 1000 }),
        row({ id: '9', x0: 1000, y0: 1000 }),
        row({ id: '100', x0: 1000.5, y0: 1999.99 }),
        row({ id: '2', x0: -0.01, y0: -1000 })
      ]),
      dir,
      V,
      rep
    );
    expect(outs.map((o) => o.cellId)).toEqual(['-1_-1', '0_1', '1_1']);
    const recs = decodeParcelChunk(fs.readFileSync(path.join(dir, 'parcels/1_1.json'), 'utf8'));
    expect(recs.map((r) => r.id)).toEqual(['100', '9']);
    expect(typeof recs[0].id).toBe('string');
  });

  it('counts but still emits parcels whose rings all collapse', async () => {
    const dir = tmp();
    const rep = new Report();
    const outs = await writeChunks(stub([row({ id: 'A', geojson7131: collapsed })]), dir, V, rep);
    expect(rep.counts['chunks.empty_polygon']).toBe(1);
    expect(rep.counts['chunks.label_outside_local']).toBe(1);
    expect(outs[0].parcelCount).toBe(1);
    const recs = decodeParcelChunk(fs.readFileSync(path.join(dir, outs[0].path), 'utf8'));
    expect(recs[0].polygon).toEqual([]);
    expect(recs[0].areaM2).toBe(0);
  });

  it('counts a label that is not strictly inside after quantisation', async () => {
    const rep = new Report();
    // label (500,500) vs polygon spanning 600..610: label outside.
    const g = JSON.stringify({
      type: 'Polygon',
      coordinates: [
        [
          [600, 600],
          [610, 600],
          [610, 610],
          [600, 610],
          [600, 600]
        ]
      ]
    });
    await writeChunks(stub([row({ geojson7131: g })]), tmp(), V, rep);
    expect(rep.counts['chunks.empty_polygon']).toBe(0);
    expect(rep.counts['chunks.label_outside_local']).toBe(1);
  });
});
