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
it.each(['vertex', 'slot', 'mixed', 'nan', 'infinity'])(
  'rejects invalid %s incoming payloads',
  (kind) => {
    const e = encodeRoofChunk(fixture());
    const view = new DataView(e.buffer);
    if (kind === 'vertex') view.setUint32(144, 6, true);
    if (kind === 'slot') view.setUint32(168, 2, true);
    if (kind === 'mixed') view.setUint32(168, 1, true);
    if (kind === 'nan') view.setFloat32(0, NaN, true);
    if (kind === 'infinity') view.setFloat32(72, Infinity, true);
    expect(() => decodeRoofChunk(e.header, e.buffer)).toThrow();
  }
);
it('canonicalizes input offsets while preserving little-endian values', () => {
  const c = fixture();
  c.header.buffers.positions.offset = 999;
  const e = encodeRoofChunk(c);
  expect(e.header.buffers.positions.offset).toBe(0);
  expect(new DataView(e.buffer).getFloat32(8, true)).toBe(1);
  expect(new DataView(e.buffer).getUint32(164, true)).toBe(5);
});
