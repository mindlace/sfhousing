import type { DecodedRoofChunk } from './building-roofs';
export function fixture(): DecodedRoofChunk {
  return {
    header: {
      schemaVersion: 1,
      datasetVersion: 'fixture-0',
      chunkId: '0_0',
      projectedOrigin: [0, 0],
      anchor: [-122, 37],
      byteLength: 192,
      buffers: {
        positions: { offset: 0, count: 18 },
        normals: { offset: 72, count: 18 },
        indices: { offset: 144, count: 6 },
        pieceSlots: { offset: 168, count: 6 }
      },
      pieces: [
        {
          pieceId: 'a',
          buildingId: 'b',
          parcelId: 'p',
          method: 'lidar_only',
          firstIndex: 0,
          indexCount: 3
        },
        {
          pieceId: 'c',
          buildingId: 'b',
          parcelId: null,
          method: 'lidar_only',
          firstIndex: 3,
          indexCount: 3
        }
      ]
    },
    positions: new Float32Array([0, 0, 1, 1, 0, 1, 0, 1, 1, 2, 0, 1, 3, 0, 1, 2, 1, 1]),
    normals: new Float32Array(18).fill(1),
    indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    pieceSlots: new Uint32Array([0, 0, 0, 1, 1, 1])
  };
}
