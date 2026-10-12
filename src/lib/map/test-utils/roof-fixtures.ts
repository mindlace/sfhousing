import type { DecodedRoofChunk, RoofChunkRef } from '$lib/data/building-roofs';
import { encodeRoofChunk, decodeRoofChunk } from '$lib/data/roof-codec';
export function roofFixture(id = 'a') {
  const encoded = encodeRoofChunk({
    positions: new Float32Array([0, 0, 10, 1, 0, 10, 0, 1, 10]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    pieceSlots: new Uint32Array([0, 0, 0]),
    header: {
      schemaVersion: 1,
      datasetVersion: 'fixture-0',
      chunkId: id,
      projectedOrigin: [0, 0],
      anchor: [-122.4, 37.78],
      byteLength: 0,
      buffers: {},
      pieces: [
        {
          pieceId: `piece-${id}`,
          buildingId: `building-${id}`,
          parcelId: `parcel-${id}`,
          method: 'lidar_only',
          firstIndex: 0,
          indexCount: 3
        }
      ]
    }
  } as DecodedRoofChunk);
  const headerBytes = new TextEncoder().encode(JSON.stringify(encoded.header));
  const ref: RoofChunkRef = {
    chunkId: id,
    bbox: [0, 0, 1, 1],
    headerUrl: `/data/fixture-0/roofs/${id}.json`,
    meshUrl: `/data/fixture-0/roofs/${id}.bin`,
    headerSha256: '0'.repeat(64),
    meshSha256: '0'.repeat(64),
    headerBytes: headerBytes.length,
    meshBytes: encoded.buffer.byteLength,
    gzipBytes: 100,
    pieceCount: 1,
    modelCount: 1
  };
  return {
    ref,
    headerBytes,
    buffer: encoded.buffer,
    chunk: decodeRoofChunk(encoded.header, encoded.buffer)
  };
}
