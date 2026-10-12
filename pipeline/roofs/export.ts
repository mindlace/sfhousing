import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { gzipSync } from 'node:zlib';
import proj4 from 'proj4';
import { getDistanceScales, lngLatToWorld } from '@math.gl/web-mercator';
import { encodeRoofChunk, decodeRoofChunk } from '../../src/lib/data/roof-codec';
import {
  ROOF_CHUNK_MAX_BYTES,
  ROOF_HEADER_MAX_BYTES,
  parseRoofHeader,
  parseRoofIndex,
  type RoofIndex,
  type RoofHeader,
  type RoofChunkRef
} from '../../src/lib/data/building-roofs';
import type { BuildingRoofsDescriptor } from '../../src/lib/data/manifest';
import type { RoofAudit } from '../../src/lib/data/roof-audit';
import type { Duck } from '../lib/duck';
import { canonicalJson } from '../lib/lock';
import { cellIdFor } from '../lib/rings';
import type { RoofArchive, ProcessedBuilding, RoofInputPiece, RoofMesh } from './job';
import { clipRoofPieces } from './run';
import { buildRoofAudit, writeRoofAudit, type AuditBuilding } from './audit';

proj4.defs(
  'EPSG:7131',
  '+proj=tmerc +lat_0=37.75 +lon_0=-122.45 +k=1.000007 +x_0=48000 +y_0=24000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'
);
const geographic = (xy: number[]) => proj4('EPSG:7131', 'EPSG:4326', xy) as [number, number];
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const json = (value: unknown) => Buffer.from(JSON.stringify(value));
const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";

/** Exact offline inverse of deck 9.4 METER_OFFSETS XY (including its y-dependent scale). */
export function projectedToLocal(
  position: [number, number, number],
  anchor: [number, number]
): [number, number, number] {
  const world = lngLatToWorld(geographic(position.slice(0, 2)));
  const origin = lngLatToWorld(anchor);
  const { unitsPerMeter, unitsPerMeter2 } = getDistanceScales({
    longitude: anchor[0],
    latitude: anchor[1],
    highPrecision: true
  });
  const north = (world[1] - origin[1]) / unitsPerMeter[1];
  const east = (world[0] - origin[0]) / (unitsPerMeter[0] + unitsPerMeter2![0] * north);
  return [east, north, position[2]];
}
export interface ExportPiece {
  pieceId: string;
  buildingId: string;
  parcelId: string | null;
  method: 'lidar_only' | 'lidar_aerial' | 'landmark';
  cellId: string;
  projectedOrigin: [number, number];
  anchor: [number, number];
  bbox: [number, number, number, number];
  /** Local east/north/up vertices; each face is split for sharp-edge normals during encoding. */
  mesh: RoofMesh;
}
export interface RoofBuildResult {
  descriptor: BuildingRoofsDescriptor;
  index: RoofIndex;
  audit: RoofAudit;
  archives: RoofArchive[];
  counts: Record<string, number>;
}

export class InvalidRoofGeometryError extends Error {
  constructor() {
    super('invalid serialized roof geometry');
  }
}

/** Validate exactly the coordinates sent to the GPU, without repairing or deleting faces. */
export function prepareRoofPiece(piece: ExportPiece): ExportPiece {
  const fail = () => {
    throw new InvalidRoofGeometryError();
  };
  const vertices = piece.mesh.vertices.map((v) => v.map(Math.fround) as [number, number, number]);
  if (
    !vertices.length ||
    vertices.some((v) => v.length !== 3 || !v.every(Number.isFinite) || v[2] < 0 || v[2] > 340)
  )
    fail();
  const triangles = piece.mesh.triangles;
  if (!triangles.length) fail();
  const parent = triangles.map((_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const edges = new Map<string, { count: number; balance: number; face: number }>();
  const volumes: number[] = [];
  const origin = vertices[0];
  for (const [face, tri] of triangles.entries()) {
    if (
      tri.length !== 3 ||
      tri.some((i) => !Number.isSafeInteger(i) || i < 0 || i >= vertices.length)
    )
      fail();
    const points = tri.map((i) => vertices[i]);
    const [a, b, c] = points;
    const u = b.map((v, i) => v - a[i]),
      v = c.map((x, i) => x - a[i]);
    const area = Math.hypot(
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0]
    );
    if (!Number.isFinite(area) || area === 0) fail();
    const [x, y, z] = points.map((p) => p.map((v, i) => v - origin[i]));
    volumes.push(
      x[0] * (y[1] * z[2] - y[2] * z[1]) +
        x[1] * (y[2] * z[0] - y[0] * z[2]) +
        x[2] * (y[0] * z[1] - y[1] * z[0])
    );
    const ids = points.map((p) => p.join(','));
    for (let i = 0; i < 3; i++) {
      const a = ids[i],
        b = ids[(i + 1) % 3],
        key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const edge = edges.get(key) ?? { count: 0, balance: 0, face };
      edge.count++;
      edge.balance += a < b ? 1 : -1;
      parent[root(face)] = root(edge.face);
      edges.set(key, edge);
    }
  }
  if ([...edges.values()].some((e) => e.count !== 2 || e.balance !== 0)) fail();
  const components = new Map<number, number>();
  for (const [face, volume] of volumes.entries()) {
    const id = root(face);
    components.set(id, (components.get(id) ?? 0) + volume);
  }
  if ([...components.values()].some((v) => !Number.isFinite(v) || v <= 0)) fail();
  return { ...piece, mesh: { ...piece.mesh, vertices } };
}

class ChunkBudgetError extends Error {}

function encode(pieces: ExportPiece[], chunkId: string, datasetVersion: string) {
  const positions: number[] = [],
    normals: number[] = [],
    indices: number[] = [],
    slots: number[] = [];
  const table: RoofHeader['pieces'] = [];
  for (const [slot, p] of pieces.entries()) {
    const firstIndex = indices.length;
    for (const t of p.mesh.triangles) {
      const [a, b, c] = t.map((i) => p.mesh.vertices[i]);
      const u = b.map((v, i) => v - a[i]),
        v = c.map((v, i) => v - a[i]);
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const len = Math.hypot(...n);
      if (!Number.isFinite(len) || len <= 0) throw new Error('degenerate export face');
      for (const vertex of [a, b, c]) {
        indices.push(slots.length);
        positions.push(...vertex);
        normals.push(...n.map((x) => x / len));
        slots.push(slot);
      }
    }
    table.push({
      pieceId: p.pieceId,
      buildingId: p.buildingId,
      parcelId: p.parcelId,
      method: p.method,
      firstIndex,
      indexCount: indices.length - firstIndex
    });
  }
  const empty = { offset: 0, count: 0 };
  const header: RoofHeader = {
    schemaVersion: 1,
    datasetVersion,
    chunkId,
    projectedOrigin: pieces[0].projectedOrigin,
    anchor: pieces[0].anchor,
    byteLength: 0,
    buffers: { positions: empty, normals: empty, indices: empty, pieceSlots: empty },
    pieces: table
  };
  let byteLength = 0;
  for (const [key, values] of Object.entries({ positions, normals, indices, pieceSlots: slots })) {
    header.buffers[key as keyof RoofHeader['buffers']] = {
      offset: byteLength,
      count: values.length
    };
    byteLength += values.length * 4;
  }
  header.byteLength = byteLength;
  if (
    json(header).length > ROOF_HEADER_MAX_BYTES ||
    byteLength + json(header).length > ROOF_CHUNK_MAX_BYTES
  )
    throw new ChunkBudgetError('roof chunk exceeds codec byte bounds');
  const encoded = encodeRoofChunk({
    header,
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    indices: Uint32Array.from(indices),
    pieceSlots: Uint32Array.from(slots)
  });
  const hb = json(encoded.header),
    bin = Buffer.from(encoded.buffer);
  const bbox: [number, number, number, number] = [
    Math.min(...pieces.map((p) => p.bbox[0])),
    Math.min(...pieces.map((p) => p.bbox[1])),
    Math.max(...pieces.map((p) => p.bbox[2])),
    Math.max(...pieces.map((p) => p.bbox[3]))
  ];
  const ref: RoofChunkRef = {
    chunkId,
    bbox,
    headerUrl: `/data/${datasetVersion}/roofs/${chunkId}.json`,
    meshUrl: `/data/${datasetVersion}/roofs/${chunkId}.bin`,
    headerSha256: sha(hb),
    meshSha256: sha(bin),
    headerBytes: hb.length,
    meshBytes: bin.length,
    gzipBytes: 0,
    pieceCount: pieces.length,
    modelCount: new Set(pieces.map((p) => p.buildingId)).size
  };
  // Exact reproducible total for the two independently served gzip-9 bodies.
  // Admission also includes the uncompressed index entry, avoiding circular gzip metadata.
  ref.gzipBytes = gzipSync(hb, { level: 9 }).length + gzipSync(bin, { level: 9 }).length;
  return {
    header: encoded.header,
    hb,
    bin,
    ref,
    decodedBytes: hb.length + bin.length + json(ref).length
  };
}

export async function encodeRoofArtifacts(
  pieces: ExportPiece[],
  opts: { outDir: string; datasetVersion: string; maxDecodedBytes?: number; maxGzipBytes?: number }
): Promise<RoofIndex> {
  const maxDecoded = Math.min(opts.maxDecodedBytes ?? ROOF_CHUNK_MAX_BYTES, ROOF_CHUNK_MAX_BYTES);
  const maxGzip = Math.min(opts.maxGzipBytes ?? 1024 * 1024, 1024 * 1024);
  const directory = join(opts.outDir, 'roofs');
  mkdirSync(directory, { recursive: true });
  const index: RoofIndex = { schemaVersion: 1, datasetVersion: opts.datasetVersion, chunks: [] };
  const ordered = pieces
    .map(prepareRoofPiece)
    .sort((a, b) => cmp(a.cellId, b.cellId) || cmp(a.pieceId, b.pieceId));
  if (new Set(ordered.map((p) => p.pieceId)).size !== ordered.length)
    throw new Error('duplicate export piece');
  let current: ExportPiece[] = [],
    part = 0;
  const id = () => `${current[0].cellId}-${String(part).padStart(3, '0')}`;
  const fits = (chunk: ReturnType<typeof encode>) =>
    chunk.decodedBytes <= maxDecoded &&
    chunk.ref.gzipBytes + json(chunk.ref).length <= maxGzip &&
    chunk.hb.length <= ROOF_HEADER_MAX_BYTES;
  function candidateFits(next: ExportPiece[]) {
    try {
      return fits(encode(next, id(), opts.datasetVersion));
    } catch (error) {
      if (error instanceof ChunkBudgetError) return false;
      throw error;
    }
  }
  function flush() {
    if (!current.length) return;
    const chunk = encode(current, id(), opts.datasetVersion);
    if (!fits(chunk))
      throw new Error(`single roof piece exceeds chunk budget: ${current[0].pieceId}`);
    parseRoofHeader(
      chunk.header,
      chunk.ref,
      opts.datasetVersion,
      chunk.hb.length,
      json(chunk.ref).length
    );
    decodeRoofChunk(chunk.header, Uint8Array.from(chunk.bin).buffer);
    writeFileSync(join(directory, `${id()}.json`), chunk.hb);
    writeFileSync(join(directory, `${id()}.bin`), chunk.bin);
    index.chunks.push(chunk.ref);
    current = [];
    part++;
  }
  for (const piece of ordered) {
    if (current.length && current[0].cellId !== piece.cellId) {
      flush();
      part = 0;
    }
    // Avoid allocating a candidate beyond the shared codec's hard bound.
    const size = [...current, piece].reduce((n, p) => n + p.mesh.triangles.length * 96, 0);
    if (current.length && (size > maxDecoded || !candidateFits([...current, piece]))) flush();
    current.push(piece);
  }
  flush();
  const checked = parseRoofIndex(index, opts.datasetVersion);
  writeFileSync(join(directory, 'index.json'), json(checked));
  return checked;
}

export async function writeRoofArtifacts(
  db: Duck,
  processed: ProcessedBuilding[],
  opts: { outDir: string; datasetVersion: string; archiveDir: string }
): Promise<RoofBuildResult> {
  const rel = relative(resolve(opts.outDir), resolve(opts.archiveDir));
  if (rel === '' || (rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel)))
    throw new Error('roof processing archives must be outside public output');
  const work = mkdtempSync(join(tmpdir(), 'sfh-roof-export-'));
  try {
    const rows = await db.all<{
      buildingId: string;
      parcelId: string | null;
      geometry: string;
      x: number;
      y: number;
      area_m2: number;
      bbox: [number, number, number, number];
    }>(
      `SELECT bid AS buildingId,pieces.parcel_id AS parcelId,area_m2,ST_AsGeoJSON(geom) AS geometry,ST_X(ST_PointOnSurface(geom)) AS x,ST_Y(ST_PointOnSurface(geom)) AS y,[ST_XMin(ST_GeomFromGeoJSON(geojson4326)),ST_YMin(ST_GeomFromGeoJSON(geojson4326)),ST_XMax(ST_GeomFromGeoJSON(geojson4326)),ST_YMax(ST_GeomFromGeoJSON(geojson4326))] AS bbox FROM pieces JOIN buildings_export USING(bid) WHERE pieces.parcel_id IS NOT DISTINCT FROM buildings_export.parcel_id ORDER BY bid, pieces.parcel_id NULLS LAST`
    );
    const input: RoofInputPiece[] = rows.map((r) => ({
      pieceId: '',
      buildingId: r.buildingId,
      parcelId: r.parcelId,
      geometry: JSON.parse(r.geometry)
    }));
    const clipped = await clipRoofPieces(processed, input, work);
    const metadata = await db.all<AuditBuilding>(
      `SELECT bid AS buildingId,height_m AS heightM,[ST_XMin(g),ST_YMin(g),ST_XMax(g),ST_YMax(g)] AS bbox,(SELECT n.nhood FROM nb7131 n WHERE ST_Intersects(b.geom,n.geom) ORDER BY ST_Area(ST_Intersection(b.geom,n.geom)) DESC,n.nhood LIMIT 1) AS neighborhood FROM (SELECT *,ST_Transform(geom,'EPSG:7131','EPSG:4326',always_xy:=true) g FROM buildings) b ORDER BY bid`
    );
    if (
      processed.length !== metadata.length ||
      new Set(processed.map((b) => b.buildingId)).size !== metadata.length
    )
      throw new Error('incomplete roof building ledger');
    const byId = new Map(processed.map((b) => [b.buildingId, b]));
    const lookup = new Map(rows.map((r) => [JSON.stringify([r.buildingId, r.parcelId]), r]));
    const exports: ExportPiece[] = [];
    const exportRejections = new Map<
      string,
      {
        pieceId: string;
        reason: 'invalid_geometry';
        stage: 'float32_export';
        mesh: RoofMesh;
        anchor: [number, number];
        projectedOrigin: [number, number];
      }[]
    >();
    await db.run(
      'ALTER TABLE buildings_export ADD COLUMN IF NOT EXISTS piece_id VARCHAR; ALTER TABLE buildings_export ADD COLUMN IF NOT EXISTS building_id VARCHAR; CREATE OR REPLACE TEMP TABLE roof_piece_identity(piece_id VARCHAR,building_id VARCHAR,parcel_id VARCHAR)'
    );
    // One join updates the city table; one UPDATE per piece would repeatedly scan every row.
    for (let offset = 0; offset < clipped.length; offset += 1000) {
      const values = clipped
        .slice(offset, offset + 1000)
        .map(
          (p) =>
            `(${quote(p.pieceId)},${quote(p.buildingId)},${p.parcelId === null ? 'NULL' : quote(p.parcelId)})`
        )
        .join(',');
      await db.run(`INSERT INTO roof_piece_identity VALUES ${values}`);
    }
    await db.run(
      `UPDATE buildings_export b SET piece_id=r.piece_id,building_id=r.building_id FROM roof_piece_identity r WHERE b.bid=r.building_id AND b.parcel_id IS NOT DISTINCT FROM r.parcel_id`
    );
    for (const p of clipped) {
      if (!p.mesh) continue;
      const row = lookup.get(JSON.stringify([p.buildingId, p.parcelId]))!;
      const cellId = cellIdFor(row.x, row.y),
        projectedOrigin: [number, number] = [
          Math.floor(row.x / 1000) * 1000 + 500,
          Math.floor(row.y / 1000) * 1000 + 500
        ],
        anchor = geographic(projectedOrigin);
      const method = byId.get(p.buildingId)!.method;
      if (method === 'footprint') throw new Error('fallback building emitted a roof');
      const candidate: ExportPiece = {
        ...p,
        method,
        mesh: { ...p.mesh, vertices: p.mesh.vertices.map((v) => projectedToLocal(v, anchor)) },
        cellId,
        projectedOrigin,
        anchor,
        bbox: row.bbox
      };
      try {
        exports.push(prepareRoofPiece(candidate));
      } catch (error) {
        if (!(error instanceof InvalidRoofGeometryError)) throw error;
        const rejected = exportRejections.get(p.buildingId) ?? [];
        rejected.push({
          pieceId: p.pieceId,
          reason: 'invalid_geometry',
          stage: 'float32_export',
          mesh: p.mesh,
          anchor,
          projectedOrigin
        });
        exportRejections.set(p.buildingId, rejected);
        p.mesh = null;
        p.reason = 'invalid_geometry';
      }
    }
    const index = await encodeRoofArtifacts(exports, opts);
    mkdirSync(opts.archiveDir, { recursive: true });
    function archive(name: string, bytes: Buffer): RoofArchive {
      const sha256 = sha(bytes),
        ref = {
          name,
          url: '',
          sha256,
          bytes: bytes.length,
          archiveKey: `roof-processing/${sha256}.${name.split('.').at(-1)}`
        };
      writeFileSync(join(opts.archiveDir, sha256), bytes);
      return ref;
    }
    const dependencies = ['clip.py', 'geometry.py', 'export.ts', 'audit.ts'].map((name) =>
      archive(name, readFileSync(new URL(name, import.meta.url)))
    );
    const grouped = new Map<string, typeof clipped>();
    for (const p of clipped) {
      const list = grouped.get(p.buildingId) ?? [];
      list.push(p);
      grouped.set(p.buildingId, list);
    }
    const evidence = processed.map((b) => ({
      ...b,
      archives: [
        ...b.archives,
        ...(grouped.has(b.buildingId)
          ? [
              archive(
                `${b.buildingId}-clip.json`,
                Buffer.from(
                  canonicalJson({
                    buildingId: b.buildingId,
                    pieces: grouped.get(b.buildingId),
                    exportRejections: exportRejections.get(b.buildingId) ?? [],
                    inputArtifactRefs: b.archives.map((a) => a.archiveKey),
                    dependencies
                  })
                )
              )
            ]
          : [])
      ]
    }));
    const pieceBboxes = new Map(
      clipped.map((p) => [p.pieceId, lookup.get(JSON.stringify([p.buildingId, p.parcelId]))!.bbox])
    );
    const audit = buildRoofAudit(
      evidence,
      clipped,
      metadata,
      opts.datasetVersion,
      opts.archiveDir,
      pieceBboxes
    );
    const archives = [
      ...new Map(
        [...dependencies, ...evidence.flatMap((b) => b.archives)].map((a) => [a.archiveKey, a])
      ).values()
    ].sort((a, b) => cmp(a.archiveKey, b.archiveKey));
    const counts: Record<string, number> = {
      'roofs.buildings': audit.buildings.length,
      'roofs.pieces': audit.pieces.length,
      'roofs.modelled': exports.length,
      'roofs.fallback': clipped.length - exports.length,
      'roofs.chunks': index.chunks.length,
      'roofs.archives': archives.length,
      'roofs.archive_bytes': archives.reduce((n, a) => n + a.bytes, 0)
    };
    const count = (key: string) => {
      counts[key] = (counts[key] ?? 0) + 1;
    };
    const metaById = new Map(metadata.map((m) => [m.buildingId, m]));
    for (const b of audit.buildings) {
      count(`roofs.building_outcome.${b.outcome}`);
      count(
        `roofs.neighborhood.${metaById.get(b.buildingId)!.neighborhood ?? 'unknown'}.${b.outcome}`
      );
    }
    for (const p of audit.pieces) {
      count(`roofs.method.${p.method}`);
      if (p.reason) count(`roofs.reason.${p.reason}`);
    }
    for (const p of clipped) {
      const key = p.mesh ? 'roofs.modelled_area_m2' : 'roofs.fallback_area_m2';
      counts[key] =
        (counts[key] ?? 0) + lookup.get(JSON.stringify([p.buildingId, p.parcelId]))!.area_m2;
    }
    for (const key of ['roofs.modelled_area_m2', 'roofs.fallback_area_m2'])
      counts[key] = Math.round((counts[key] ?? 0) * 1000) / 1000;
    const directory = join(opts.outDir, 'roofs');
    counts['roofs.audit_bytes'] = writeRoofAudit(join(directory, 'audit.json'), audit);
    writeFileSync(
      join(directory, 'report.json'),
      json({
        schemaVersion: 1,
        datasetVersion: opts.datasetVersion,
        counts,
        chunkSizes: index.chunks.map((c) => ({
          chunkId: c.chunkId,
          decodedBytes: c.meshBytes + c.headerBytes + json(c).length,
          gzipBytes: c.gzipBytes
        })),
        sourceAvailability: [...new Set(audit.pieces.flatMap((p) => p.flags))].sort(cmp)
      })
    );
    const base = `/data/${opts.datasetVersion}/roofs`;
    return {
      descriptor: {
        schemaVersion: 1,
        indexUrl: `${base}/index.json`,
        auditUrl: `${base}/audit.json`,
        reportUrl: `${base}/report.json`
      },
      index,
      audit,
      archives,
      counts
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
