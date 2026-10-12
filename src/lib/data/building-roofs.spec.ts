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
  headerBytes: 1000,
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
      { schemaVersion: 1, datasetVersion: 'fixture-0', chunks: [{ ...ref, meshBytes: 4193304 }] },
      'fixture-0'
    )
  ).toThrow();
});
