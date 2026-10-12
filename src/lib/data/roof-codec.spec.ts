import { expect, it } from 'vitest';
import { encodeRoofChunk, decodeRoofChunk } from './roof-codec';
import { fixture } from './roof-test-fixture';
it('round trips two distinct contiguous piece ranges', () => {
  const c = fixture();
  const e = encodeRoofChunk(c);
  expect(decodeRoofChunk(e.header, e.buffer).indices).toEqual(c.indices);
  expect(decodeRoofChunk(e.header, e.buffer).pieceSlots).toEqual(c.pieceSlots);
});
it('rejects truncated and oversized bodies', () => {
  const e = encodeRoofChunk(fixture());
  expect(() => decodeRoofChunk(e.header, e.buffer.slice(0, 188))).toThrow();
  expect(() => decodeRoofChunk(e.header, new ArrayBuffer(4194305))).toThrow();
});
it.each(['overlap', 'misalign', 'overflow', 'range', 'duplicate'])(
  'rejects hostile %s headers before views',
  (kind) => {
    const e = encodeRoofChunk(fixture());
    if (kind === 'overlap') e.header.buffers.normals.offset = 0;
    if (kind === 'misalign') e.header.buffers.normals.offset = 73;
    if (kind === 'overflow') e.header.buffers.indices.count = Number.MAX_SAFE_INTEGER;
    if (kind === 'range') e.header.pieces[1].firstIndex = 0;
    if (kind === 'duplicate') e.header.pieces[1].pieceId = 'a';
    expect(() => decodeRoofChunk(e.header, e.buffer)).toThrow();
  }
);
it.each(['vertex', 'slot', 'mixed', 'nan', 'infinity'])('rejects invalid %s payloads', (kind) => {
  const c = fixture();
  if (kind === 'vertex') c.indices[0] = 6;
  if (kind === 'slot') c.pieceSlots[0] = 2;
  if (kind === 'mixed') c.pieceSlots[0] = 1;
  if (kind === 'nan') c.positions[0] = NaN;
  if (kind === 'infinity') c.normals[0] = Infinity;
  expect(() => encodeRoofChunk(c)).toThrow();
});
it('canonicalizes input offsets while preserving little-endian values', () => {
  const c = fixture();
  c.header.buffers.positions.offset = 999;
  const e = encodeRoofChunk(c);
  expect(e.header.buffers.positions.offset).toBe(0);
  expect(new DataView(e.buffer).getFloat32(8, true)).toBe(1);
  expect(new DataView(e.buffer).getUint32(164, true)).toBe(5);
});
