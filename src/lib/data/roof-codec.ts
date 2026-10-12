import { validateRoofHeader, type DecodedRoofChunk, type RoofHeader } from './building-roofs';
const keys = ['positions', 'normals', 'indices', 'pieceSlots'] as const;
/** Read explicitly little-endian, independently of the host's typed-array byte order. */
export function decodeRoofChunk(header: RoofHeader, buffer: ArrayBuffer): DecodedRoofChunk {
  const h = validateRoofHeader(header);
  if (buffer.byteLength !== h.byteLength) throw new Error('roof payload length');
  const view = new DataView(buffer);
  // Validate payload before allocating any output arrays.
  const vertices = h.buffers.pieceSlots.count;
  for (const key of ['positions', 'normals'] as const) {
    const s = h.buffers[key];
    for (let i = 0; i < s.count; i++)
      if (!Number.isFinite(view.getFloat32(s.offset + i * 4, true)))
        throw new Error('nonfinite roof value');
  }
  const slots = h.buffers.pieceSlots;
  for (let i = 0; i < slots.count; i++)
    if (view.getUint32(slots.offset + i * 4, true) >= h.pieces.length)
      throw new Error('roof slot range');
  for (let slot = 0; slot < h.pieces.length; slot++) {
    const p = h.pieces[slot];
    for (let i = p.firstIndex; i < p.firstIndex + p.indexCount; i++) {
      const vertex = view.getUint32(h.buffers.indices.offset + i * 4, true);
      if (vertex >= vertices || view.getUint32(slots.offset + vertex * 4, true) !== slot)
        throw new Error('roof vertex/triangle slot mismatch');
    }
  }
  const result = { header: h } as DecodedRoofChunk;
  for (const key of keys) {
    const s = h.buffers[key];
    const floats = key === 'positions' || key === 'normals';
    const out = floats ? new Float32Array(s.count) : new Uint32Array(s.count);
    for (let i = 0; i < s.count; i++)
      out[i] = floats
        ? view.getFloat32(s.offset + i * 4, true)
        : view.getUint32(s.offset + i * 4, true);
    Object.assign(result, { [key]: out });
  }
  return result;
}
export function encodeRoofChunk(chunk: DecodedRoofChunk): {
  header: RoofHeader;
  buffer: ArrayBuffer;
} {
  let offset = 0;
  const buffers = { ...chunk.header.buffers };
  for (const key of keys) {
    buffers[key] = { offset, count: chunk[key].length };
    offset += chunk[key].byteLength;
  }
  const header = validateRoofHeader({ ...chunk.header, buffers, byteLength: offset });
  const buffer = new ArrayBuffer(offset);
  const view = new DataView(buffer);
  for (const key of keys) {
    const floats = key === 'positions' || key === 'normals';
    for (let i = 0; i < chunk[key].length; i++) {
      const at = buffers[key].offset + i * 4;
      if (floats) view.setFloat32(at, chunk[key][i], true);
      else view.setUint32(at, chunk[key][i], true);
    }
  }
  decodeRoofChunk(header, buffer);
  return { header, buffer };
}
