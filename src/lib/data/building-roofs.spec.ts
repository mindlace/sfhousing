import { expect, it } from 'vitest';
import { parseRoofIndex, parseRoofHeader, type RoofChunkRef } from './building-roofs';
import { fixture } from './roof-test-fixture';
const ref: RoofChunkRef = {
  chunkId: '0_0',
  bbox: [-122, 37, -121, 38],
  headerUrl: '/data/fixture-0/roofs/0_0.json',
  meshUrl: '/data/fixture-0/roofs/0_0.bin',
  headerSha256: 'a'.repeat(64),
  meshSha256: 'b'.repeat(64),
  headerBytes: new TextEncoder().encode(JSON.stringify(fixture().header)).length,
  meshBytes: 192,
  gzipBytes: 100,
  pieceCount: 2,
  modelCount: 1
};
it('accepts supported same-version references and matching headers', () => {
  expect(
    parseRoofIndex({ schemaVersion: 1, datasetVersion: 'fixture-0', chunks: [ref] }, 'fixture-0')
      .chunks
  ).toHaveLength(1);
  expect(parseRoofHeader(fixture().header, ref, 'fixture-0').pieces).toHaveLength(2);
});
it('rejects unknown versions, duplicate chunks and foreign URLs', () => {
  expect(() =>
    parseRoofIndex({ schemaVersion: 99, datasetVersion: 'fixture-0', chunks: [] }, 'fixture-0')
  ).toThrow();
  expect(() =>
    parseRoofIndex(
      { schemaVersion: 1, datasetVersion: 'fixture-0', chunks: [ref, ref] },
      'fixture-0'
    )
  ).toThrow();
  expect(() =>
    parseRoofIndex(
      {
        schemaVersion: 1,
        datasetVersion: 'fixture-0',
        chunks: [{ ...ref, meshUrl: '/data/fixture-1/x' }]
      },
      'fixture-0'
    )
  ).toThrow();
});
it.each(['bbox', 'origin', 'identity', 'counts', 'size'])('rejects invalid %s metadata', (kind) => {
  const h = fixture().header;
  if (kind === 'bbox') {
    expect(() =>
      parseRoofIndex(
        {
          schemaVersion: 1,
          datasetVersion: 'fixture-0',
          chunks: [{ ...ref, bbox: [NaN, 37, -121, 38] }]
        },
        'fixture-0'
      )
    ).toThrow();
  } else {
    if (kind === 'origin') h.projectedOrigin[0] = Infinity;
    if (kind === 'identity') h.chunkId = 'foreign';
    if (kind === 'counts') h.buffers.positions.count = 0xffffffff;
    if (kind === 'size') h.byteLength = 4194304;
    expect(() => parseRoofHeader(h, ref, 'fixture-0')).toThrow();
  }
});
it('includes index and header metadata in the decoded chunk budget', () => {
  expect(() =>
    parseRoofIndex(
      {
        schemaVersion: 1,
        datasetVersion: 'fixture-0',
        chunks: [{ ...ref, headerBytes: 1000, meshBytes: 4193304 }]
      },
      'fixture-0'
    )
  ).toThrow();
});
it('rejects understated header declarations', () => {
  expect(() =>
    parseRoofHeader(fixture().header, { ...ref, headerBytes: 1 }, 'fixture-0')
  ).toThrow();
});
it('uses verified incoming header bytes instead of reserialized JSON bytes', () => {
  const h = fixture().header;
  const body = JSON.stringify(h, null, 2);
  const bytes = new TextEncoder().encode(body).length;
  expect(
    parseRoofHeader(JSON.parse(body), { ...ref, headerBytes: bytes }, 'fixture-0', bytes).pieces
  ).toHaveLength(2);
  expect(() =>
    parseRoofHeader(h, { ...ref, headerBytes: bytes - 1 }, 'fixture-0', bytes)
  ).toThrow();
});
it('rejects actual combined bytes beyond the chunk boundary despite understated declaration', () => {
  const h = fixture().header;
  h.pieces = [{ ...h.pieces[0], indexCount: 3 }];
  const vertices = 149760;
  h.buffers = {
    positions: { offset: 0, count: vertices * 3 },
    normals: { offset: vertices * 12, count: vertices * 3 },
    indices: { offset: vertices * 24, count: 3 },
    pieceSlots: { offset: vertices * 24 + 12, count: vertices }
  };
  h.byteLength = vertices * 28 + 12;
  const padded = { ...h, padding: 'x'.repeat(1000) };
  const boundaryRef = { ...ref, headerBytes: 1, meshBytes: h.byteLength, pieceCount: 1 };
  expect(() => parseRoofHeader(padded, boundaryRef, 'fixture-0')).toThrow();
});

it('includes measured index-entry bytes in the actual combined boundary', () => {
  expect(() =>
    parseRoofHeader(
      fixture().header,
      ref,
      'fixture-0',
      ref.headerBytes,
      4194304 - ref.headerBytes - ref.meshBytes + 1
    )
  ).toThrow();
  expect(
    parseRoofHeader(
      fixture().header,
      ref,
      'fixture-0',
      ref.headerBytes,
      4194304 - ref.headerBytes - ref.meshBytes
    ).pieces
  ).toHaveLength(2);
});
it.each([NaN, Infinity, -1, 0, 0.5, 262145])(
  'rejects invalid measured header length %s',
  (bytes) => {
    expect(() => parseRoofHeader(fixture().header, ref, 'fixture-0', bytes)).toThrow();
  }
);
