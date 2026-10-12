import precision from './fixtures/roof-quantization.json';
import type { ExportPiece } from '../roofs/export';
import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { addMetersToLngLat } from '@math.gl/web-mercator';
import { encodeRoofArtifacts, projectedToLocal, prepareRoofPiece } from '../roofs/export';
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
          [i + 1, 0, 0],
          [i, 1, 0],
          [i, 0, 10]
        ] as [number, number, number][],
        triangles: [
          [0, 2, 1],
          [0, 1, 3],
          [1, 2, 3],
          [2, 0, 3]
        ] as [number, number, number][],
        semantics: ['GroundSurface', 'WallSurface', 'RoofSurface', 'WallSurface']
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
      let nextIndex = 0;
      for (const [slot, piece] of header.pieces.entries()) {
        expect(piece.firstIndex).toBe(nextIndex);
        for (let i = piece.firstIndex; i < piece.firstIndex + piece.indexCount; i++)
          expect(decoded.pieceSlots[decoded.indices[i]]).toBe(slot);
        nextIndex += piece.indexCount;
      }
      expect(nextIndex).toBe(decoded.indices.length);
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
  // 5461 disjoint outward tetrahedra: 21844 real, closed faces near the codec bound.
  const mesh = {
    vertices: [] as [number, number, number][],
    triangles: [] as [number, number, number][],
    semantics: [] as string[]
  };
  for (let i = 0; i < 5461; i++) {
    const at = mesh.vertices.length,
      x = (i % 100) * 2,
      y = Math.floor(i / 100) * 2;
    mesh.vertices.push([x, y, 0], [x + 1, y, 0], [x, y + 1, 0], [x, y, 1]);
    mesh.triangles.push(
      ...[
        [0, 2, 1],
        [0, 1, 3],
        [1, 2, 3],
        [2, 0, 3]
      ].map((t) => t.map((v) => v + at) as [number, number, number])
    );
    mesh.semantics.push('GroundSurface', 'WallSurface', 'RoofSurface', 'WallSurface');
  }
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

it('rejects the actual post-clip mesh whose valid double faces collapse in Float32', async () => {
  const p = precision.piece;
  const piece = {
    ...p,
    method: 'lidar_only',
    cellId: '49_24',
    anchor: precision.anchor as [number, number],
    projectedOrigin: precision.projectedOrigin as [number, number],
    bbox: [-122.44, 37.75, -122.42, 37.76],
    mesh: {
      ...p.mesh,
      triangles: p.mesh.triangles as [number, number, number][],
      vertices: p.mesh.vertices.map((v) =>
        projectedToLocal(v as [number, number, number], precision.anchor as [number, number])
      )
    }
  } as ExportPiece;
  await expect(
    encodeRoofArtifacts([piece], {
      outDir: mkdtempSync(join(tmpdir(), 'roof-precision-')),
      datasetVersion: 'fixture-4'
    })
  ).rejects.toThrow('invalid serialized roof geometry');
});
it.each(precision.corners)(
  'rejects Float32 repeated or collinear corners from $pieceId/$triangle',
  async (corner) => {
    const cross = (vs: number[][]) => {
      const [a, b, c] = vs;
      const u = b.map((v, i) => v - a[i]),
        w = c.map((v, i) => v - a[i]);
      return Math.hypot(
        u[1] * w[2] - u[2] * w[1],
        u[2] * w[0] - u[0] * w[2],
        u[0] * w[1] - u[1] * w[0]
      );
    };
    expect(cross(corner.local)).toBeGreaterThan(0);
    expect(cross(corner.local.map((v) => v.map(Math.fround)))).toBe(0);
    const piece = {
      pieceId: corner.pieceId,
      buildingId: 'b',
      parcelId: null,
      method: 'lidar_only',
      cellId: '49_24',
      anchor: precision.anchor as [number, number],
      projectedOrigin: precision.projectedOrigin as [number, number],
      bbox: [-122.44, 37.75, -122.42, 37.76],
      mesh: { vertices: corner.local, triangles: [[0, 1, 2]], semantics: ['WallSurface'] }
    } as ExportPiece;
    await expect(
      encodeRoofArtifacts([piece], {
        outDir: mkdtempSync(join(tmpdir(), 'roof-corner-')),
        datasetVersion: 'fixture-4'
      })
    ).rejects.toThrow('invalid serialized roof geometry');
  }
);

it.each(['open', 'inward component', 'overflow'])(
  'rejects unsafe final topology: %s',
  (failure) => {
    const vertices: [number, number, number][] = [
      [0, 0, 0],
      [2, 0, 0],
      [0, 2, 0],
      [0, 0, 2]
    ];
    const triangles: [number, number, number][] = [
      [0, 2, 1],
      [0, 1, 3],
      [1, 2, 3],
      [2, 0, 3]
    ];
    if (failure === 'open') triangles.pop();
    if (failure === 'overflow') vertices[0][0] = 1e40;
    if (failure === 'inward component') {
      vertices.push([5, 0, 0], [6, 0, 0], [5, 1, 0], [5, 0, 1]);
      triangles.push(
        ...triangles.map(([a, b, c]) => [a + 4, c + 4, b + 4] as [number, number, number])
      );
    }
    const piece: ExportPiece = {
      pieceId: 'p',
      buildingId: 'b',
      parcelId: null,
      method: 'lidar_only',
      cellId: '49_24',
      anchor: [-122.42, 37.76],
      projectedOrigin: [49500, 24500],
      bbox: [-122.44, 37.75, -122.42, 37.76],
      mesh: { vertices, triangles, semantics: triangles.map(() => 'RoofSurface') }
    };
    expect(() => prepareRoofPiece(piece)).toThrow('invalid serialized roof geometry');
  }
);
