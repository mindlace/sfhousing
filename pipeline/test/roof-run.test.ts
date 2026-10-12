import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { runRoofJob, validateRoofResult } from '../roofs/run';
import type { RoofJob } from '../roofs/job';

const building: RoofJob['buildings'][number] = {
  buildingId: 'outside',
  footprintHash: '0'.repeat(64),
  footprint: {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0]
      ]
    ]
  },
  horizontalCrs: 'EPSG:7131',
  heightM: 10,
  baseM: 0,
  hs: 0,
  bbox: [0, 0, 10, 10],
  neighborhood: null,
  sourceDates: { acquisitionStart: null, acquisitionEnd: null }
};

test('real offline runner retains no-coverage buildings and verifies processing archives', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roof-run-'));
  try {
    const result = await runRoofJob({
      schemaVersion: 1,
      datasetVersion: 'test',
      buildings: [building],
      sources: [],
      sourceStatus: [],
      configPath: resolve('pipeline/roofs/config.json'),
      toolchainHash: '0'.repeat(64),
      workDir: dir
    });
    expect(result.buildings.map((b) => [b.buildingId, b.method, b.reason])).toEqual([
      ['outside', 'footprint', 'not_in_coverage']
    ]);
    expect(result.archives.length).toBeGreaterThan(3);
    expect(result.archives.every((a) => a.archiveKey.startsWith('roof-processing/'))).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runner rejects omitted outcomes, duplicate identities, and corrupt mesh results', () => {
  expect(() => validateRoofResult({ buildings: [], archives: [] }, [building])).toThrow('building');
  const fallback = {
    buildingId: 'outside',
    footprintHash: building.footprintHash,
    method: 'footprint',
    mesh: null,
    selectedCandidate: null,
    reason: 'not_in_coverage',
    flags: [],
    candidates: [],
    ground: null,
    archives: []
  };
  expect(() =>
    validateRoofResult({ buildings: [fallback, fallback], archives: [] }, [building])
  ).toThrow('building');
  expect(() =>
    validateRoofResult(
      {
        buildings: [
          {
            ...fallback,
            method: 'lidar_only',
            reason: null,
            mesh: { vertices: [[0, 0, NaN]], triangles: [[0, 0, 0]], semantics: ['RoofSurface'] }
          }
        ],
        archives: []
      },
      [building]
    )
  ).toThrow('mesh');
});

test('runner rejects a model with missing selected candidate or measured ground evidence', () => {
  const mesh = {
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 3]
    ],
    triangles: [
      [0, 2, 1],
      [0, 1, 3],
      [1, 2, 3],
      [2, 0, 3]
    ],
    semantics: ['GroundSurface', 'WallSurface', 'RoofSurface', 'WallSurface']
  };
  const model = {
    buildingId: building.buildingId,
    footprintHash: building.footprintHash,
    method: 'lidar_only',
    mesh,
    selectedCandidate: null,
    reason: null,
    flags: [],
    candidates: [],
    ground: null,
    archives: []
  };
  expect(() => validateRoofResult({ buildings: [model], archives: [] }, [building])).toThrow(
    'candidate'
  );
});
