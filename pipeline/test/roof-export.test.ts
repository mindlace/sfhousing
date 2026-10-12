import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { addMetersToLngLat } from '@math.gl/web-mercator';
import { encodeRoofArtifacts, projectedToLocal } from '../roofs/export';
import { parseRoofHeader, parseRoofIndex } from '../../src/lib/data/building-roofs';
import { decodeRoofChunk } from '../../src/lib/data/roof-codec';

// Geodetic 100m east/north reference at latitude 37.76, generated independently with pyproj.Geod.
it('reprojects projected XY to east/north physical metres with zero-ground Z', () => {
  const anchor: [number, number] = [-122.4195, 37.76];
  const east = projectedToLocal([50787.61651362021, 25110.396867044445, 0], anchor);
  const north = projectedToLocal([50687.58321191377, 25210.364973165542, 17], anchor);
  expect(east[0]).toBeGreaterThan(99);
  expect(Math.abs(east[1])).toBeLessThan(0.01);
  expect(east[2]).toBe(0);
  expect(Math.abs(north[0])).toBeLessThan(0.01);
  expect(north[1]).toBeGreaterThan(99);
  expect(north[2]).toBe(17);
  const e = addMetersToLngLat(anchor, east),
    n = addMetersToLngLat(anchor, north);
  expect(e[0]).toBeCloseTo(-122.41836515722402, 8);
  expect(e[1]).toBeCloseTo(37.7599999945362, 8);
  expect(n[0]).toBeCloseTo(-122.4195, 8);
  expect(n[1]).toBeCloseTo(37.760900966253324, 8);
  const corner = addMetersToLngLat(
    anchor,
    projectedToLocal([51187.61580970496, 25610.364269584024, 0], anchor)
  );
  expect(corner[0]).toBeCloseTo(-122.41382363289522, 8);
  expect(corner[1]).toBeCloseTo(37.76450319242007, 8);
});

it.each([
  { decoded: 1600, gzip: 1024 },
  { decoded: 4194304, gzip: 850 }
])(
  'splits real encoded chunks deterministically at $decoded/$gzip bytes and decodes every slot',
  async (budget) => {
    const out = mkdtempSync(join(tmpdir(), 'roof-export-'));
    const pieces = Array.from({ length: 5 }, (_, i) => ({
      pieceId: `p-${i}`,
      buildingId: `b-${i}`,
      parcelId: i === 0 ? null : `parcel-${i}`,
      method: 'lidar_only' as const,
      cellId: '100_200',
      projectedOrigin: [100500, 200500] as [number, number],
      anchor: [-122.42, 37.76] as [number, number],
      bbox: [-122.421, 37.759, -122.419, 37.761] as [number, number, number, number],
      mesh: {
        vertices: [
          [i, 0, 0],
          [i + 1, 0, 10],
          [i, 1, 10]
        ] as [number, number, number][],
        triangles: [[0, 1, 2]] as [number, number, number][],
        semantics: ['RoofSurface']
      }
    }));
    const a = await encodeRoofArtifacts(pieces, {
      outDir: join(out, 'a'),
      datasetVersion: 'fixture-4',
      maxDecodedBytes: budget.decoded,
      maxGzipBytes: budget.gzip
    });
    const b = await encodeRoofArtifacts([...pieces].reverse(), {
      outDir: join(out, 'b'),
      datasetVersion: 'fixture-4',
      maxDecodedBytes: budget.decoded,
      maxGzipBytes: budget.gzip
    });
    expect(a).toEqual(b);
    expect(a.chunks.length).toBeGreaterThan(1);
    expect(a.chunks[0].chunkId).toBe('100_200-000');
    parseRoofIndex(a, 'fixture-4');
    for (const ref of a.chunks) {
      const hb = readFileSync(join(out, 'a/roofs', `${ref.chunkId}.json`));
      const bin = readFileSync(join(out, 'a/roofs', `${ref.chunkId}.bin`));
      const header = parseRoofHeader(
        JSON.parse(hb.toString()),
        ref,
        'fixture-4',
        hb.length,
        Buffer.byteLength(JSON.stringify(ref))
      );
      const decoded = decodeRoofChunk(header, Uint8Array.from(bin).buffer);
      expect(
        ref.meshBytes + ref.headerBytes + Buffer.byteLength(JSON.stringify(ref))
      ).toBeLessThanOrEqual(budget.decoded);
      expect(ref.gzipBytes).toBe(
        gzipSync(hb, { level: 9 }).length + gzipSync(bin, { level: 9 }).length
      );
      expect(ref.gzipBytes + Buffer.byteLength(JSON.stringify(ref))).toBeLessThanOrEqual(
        budget.gzip
      );
      expect([...decoded.indices]).toEqual(
        Array.from({ length: decoded.indices.length }, (_, i) => i)
      );
      expect(new DataView(decoded.positions.buffer).getFloat32(8, true)).toBe(0);
      expect(ref.bbox).toEqual([-122.421, 37.759, -122.419, 37.761]);
    }
    for (const f of readdirSync(join(out, 'a/roofs')))
      expect(readFileSync(join(out, 'a/roofs', f))).toEqual(readFileSync(join(out, 'b/roofs', f)));
  }
);

it('splits before the shared codec hard bound, including header bytes', async () => {
  const out = mkdtempSync(join(tmpdir(), 'roof-budget-'));
  const mesh = {
    vertices: [
      [0, 0, 0],
      [1, 0, 1],
      [0, 1, 1]
    ] as [number, number, number][],
    triangles: Array.from({ length: 21845 }, () => [0, 1, 2] as [number, number, number]),
    semantics: Array(21845).fill('RoofSurface')
  };
  const pieces = [0, 1].map((i) => ({
    pieceId: `budget-${i}`,
    buildingId: `b-${i}`,
    parcelId: null,
    method: 'landmark' as const,
    cellId: '50_25',
    projectedOrigin: [50500, 25500] as [number, number],
    anchor: [-122.42, 37.76] as [number, number],
    bbox: [-122.42, 37.76, -122.41, 37.77] as [number, number, number, number],
    mesh
  }));
  const index = await encodeRoofArtifacts(pieces, { outDir: out, datasetVersion: 'fixture-4' });
  expect(index.chunks).toHaveLength(2);
  expect(
    index.chunks.every(
      (c) => c.meshBytes + c.headerBytes + Buffer.byteLength(JSON.stringify(c)) <= 4194304
    )
  ).toBe(true);
});
