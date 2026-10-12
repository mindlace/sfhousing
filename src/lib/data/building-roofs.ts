import { z } from 'zod';
import { DATASET_VERSION_RE } from './dataset-version';
export const ROOF_CHUNK_MAX_BYTES = 4 * 1024 * 1024;
export const ROOF_INDEX_MAX_BYTES = 8 * 1024 * 1024;
export const ROOF_HEADER_MAX_BYTES = 256 * 1024;
export const RoofMethodSchema = z.enum(['lidar_aerial', 'lidar_only', 'landmark']);
const id = z.string().min(1);
const uint = z.number().int().nonnegative().max(0xffffffff);
export const RoofBboxSchema = z
  .tuple([z.number(), z.number(), z.number(), z.number()])
  .refine(([w, s, e, n]) => w >= -180 && e <= 180 && s >= -90 && n <= 90 && w <= e && s <= n);
export function roofUrlSchema(version: string) {
  return z
    .string()
    .startsWith(`/data/${version}/`)
    .refine((u) =>
      u
        .slice(`/data/${version}/`.length)
        .split('/')
        .every((s) => /^[A-Za-z0-9._-]+$/.test(s) && s !== '.' && s !== '..')
    );
}
const hash = z.string().regex(/^[0-9a-f]{64}$/);
function refSchema(version: string) {
  return z
    .object({
      chunkId: id,
      bbox: RoofBboxSchema,
      headerUrl: roofUrlSchema(version),
      meshUrl: roofUrlSchema(version),
      headerSha256: hash,
      meshSha256: hash,
      headerBytes: uint.max(ROOF_HEADER_MAX_BYTES).positive(),
      meshBytes: uint.max(ROOF_CHUNK_MAX_BYTES),
      gzipBytes: uint.max(1024 * 1024),
      pieceCount: uint,
      modelCount: uint
    })
    .refine(
      (r) =>
        r.headerBytes + r.meshBytes + jsonBytes(r) <= ROOF_CHUNK_MAX_BYTES &&
        r.modelCount <= r.pieceCount
    );
}
export type RoofChunkRef = z.infer<ReturnType<typeof refSchema>>;
const section = z.object({ offset: uint, count: uint });
export const RoofHeaderSchema = z.object({
  schemaVersion: z.literal(1),
  datasetVersion: z.string().regex(DATASET_VERSION_RE),
  chunkId: id,
  projectedOrigin: z.tuple([z.number(), z.number()]),
  anchor: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
  byteLength: uint.max(ROOF_CHUNK_MAX_BYTES),
  buffers: z.object({
    positions: section,
    normals: section,
    indices: section,
    pieceSlots: section
  }),
  pieces: z.array(
    z.object({
      pieceId: id,
      buildingId: id,
      parcelId: id.nullable(),
      method: RoofMethodSchema,
      firstIndex: uint,
      indexCount: uint.positive()
    })
  )
});
export type RoofHeader = z.infer<typeof RoofHeaderSchema>;
export type RoofIndex = { schemaVersion: 1; datasetVersion: string; chunks: RoofChunkRef[] };
export type DecodedRoofChunk = {
  header: RoofHeader;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  pieceSlots: Uint32Array;
};
export function jsonBytes(raw: unknown): number {
  return new TextEncoder().encode(JSON.stringify(raw)).byteLength;
}
export function validateRoofHeader(raw: unknown): RoofHeader {
  if (jsonBytes(raw) > ROOF_HEADER_MAX_BYTES) throw new Error('roof header too large');
  const h = RoofHeaderSchema.parse(raw);
  let end = 0;
  for (const key of ['positions', 'normals', 'indices', 'pieceSlots'] as const) {
    const s = h.buffers[key];
    if (s.offset !== end || s.offset % 4 !== 0) throw new Error('noncontiguous roof buffers');
    end += s.count * 4;
    if (end > ROOF_CHUNK_MAX_BYTES) throw new Error('roof buffer overflow');
  }
  const b = h.buffers;
  if (
    end !== h.byteLength ||
    end + jsonBytes(h) > ROOF_CHUNK_MAX_BYTES ||
    b.positions.count % 3 !== 0 ||
    b.normals.count !== b.positions.count ||
    b.pieceSlots.count !== b.positions.count / 3 ||
    b.indices.count % 3 !== 0
  )
    throw new Error('roof buffer counts');
  let first = 0;
  const seen = new Set<string>();
  for (const piece of h.pieces) {
    if (seen.has(piece.pieceId) || piece.firstIndex !== first || piece.indexCount % 3 !== 0)
      throw new Error('invalid roof piece range');
    seen.add(piece.pieceId);
    first += piece.indexCount;
  }
  if (first !== b.indices.count) throw new Error('incomplete roof ranges');
  return h;
}
export function parseRoofIndex(raw: unknown, datasetVersion: string): RoofIndex {
  if (!DATASET_VERSION_RE.test(datasetVersion) || jsonBytes(raw) > ROOF_INDEX_MAX_BYTES)
    throw new Error('invalid roof index');
  const index = z
    .object({
      schemaVersion: z.literal(1),
      datasetVersion: z.literal(datasetVersion),
      chunks: z.array(refSchema(datasetVersion))
    })
    .parse(raw);
  if (new Set(index.chunks.map((c) => c.chunkId)).size !== index.chunks.length)
    throw new Error('duplicate roof chunk');
  return index;
}
export function parseRoofHeader(
  raw: unknown,
  ref: RoofChunkRef,
  datasetVersion: string
): RoofHeader {
  const r = refSchema(datasetVersion).parse(ref);
  const h = validateRoofHeader(raw);
  if (
    h.datasetVersion !== datasetVersion ||
    h.chunkId !== r.chunkId ||
    h.byteLength !== r.meshBytes ||
    h.pieces.length !== r.pieceCount ||
    new Set(h.pieces.map((p) => p.buildingId)).size !== r.modelCount
  )
    throw new Error('roof identity/count mismatch');
  return h;
}
