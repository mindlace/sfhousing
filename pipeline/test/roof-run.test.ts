import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import {
  runRoofJob,
  validateRoofResult,
  readRoofResultRecords,
  clipRoofPieces
} from '../roofs/run';
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
      buildings: [building, { ...building, buildingId: 'outside2' }],
      sources: [],
      sourceStatus: [],
      configPath: resolve('pipeline/roofs/config.json'),
      toolchainHash: '0'.repeat(64),
      workDir: dir
    });
    expect(result.buildings.map((b) => [b.buildingId, b.method, b.reason])).toEqual([
      ['outside', 'footprint', 'not_in_coverage'],
      ['outside2', 'footprint', 'not_in_coverage']
    ]);
    expect(existsSync(join(dir, 'result.json'))).toBe(false);
    const lines = readFileSync(join(dir, 'result.ndjson'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(result.archives.length + 3);
    expect(lines.every((line) => Buffer.byteLength(line) < 16384)).toBe(true);
    expect(JSON.parse(lines.at(-1)!)).toEqual({
      type: 'end',
      buildingCount: 2,
      archiveCount: result.archives.length
    });
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

test('runner flags obey the shared reason contract while internal details remain diagnostics', () => {
  const fallback = {
    buildingId: building.buildingId,
    footprintHash: building.footprintHash,
    method: 'footprint',
    mesh: null,
    selectedCandidate: null,
    reason: 'lidar_sparse',
    flags: ['pca_insufficient'],
    candidates: [],
    ground: null,
    archives: []
  };
  expect(() => validateRoofResult({ buildings: [fallback], archives: [] }, [building])).toThrow(
    'flag'
  );
  const supported = {
    ...fallback,
    flags: ['vegetation_ambiguous'],
    diagnostics: { vegetation: ['pca_insufficient'] }
  };
  expect(
    validateRoofResult({ buildings: [supported], archives: [] }, [building]).buildings[0].flags
  ).toEqual(['vegetation_ambiguous']);
});

test('streamed results require complete terminal counts and consistent cross-record archives', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roof-records-'));
  const path = join(dir, 'result.ndjson');
  const b = {
    buildingId: building.buildingId,
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
  const record = JSON.stringify({ type: 'building', value: b });
  try {
    writeFileSync(path, record + '\n');
    await expect(readRoofResultRecords(path, [building])).rejects.toThrow('incomplete');
    writeFileSync(
      path,
      record + '\n' + JSON.stringify({ type: 'end', buildingCount: 2, archiveCount: 0 }) + '\n'
    );
    await expect(readRoofResultRecords(path, [building])).rejects.toThrow('counts');
    writeFileSync(
      path,
      record + '\n' + JSON.stringify({ type: 'end', buildingCount: 1, archiveCount: 0 }) + '\n'
    );
    expect((await readRoofResultRecords(path, [building])).buildings[0]).toEqual(b);
    writeFileSync(
      path,
      record +
        '\n' +
        JSON.stringify({ type: 'end', buildingCount: 1, archiveCount: 0 }) +
        '\n' +
        record +
        '\n'
    );
    await expect(readRoofResultRecords(path, [building])).rejects.toThrow('after');
    const bad = {
      ...b,
      archives: [
        {
          name: 'input.json',
          sha256: 'a'.repeat(64),
          bytes: 1,
          url: '',
          archiveKey: 'roof-processing/' + 'a'.repeat(64) + '.json'
        }
      ]
    };
    writeFileSync(
      path,
      JSON.stringify({ type: 'building', value: bad }) +
        '\n' +
        JSON.stringify({ type: 'end', buildingCount: 1, archiveCount: 0 }) +
        '\n'
    );
    await expect(readRoofResultRecords(path, [building])).rejects.toThrow('archive');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('clip exchange streams complete piece records and omits large reconstruction evidence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roof-clip-records-'));
  try {
    const result = await clipRoofPieces(
      [
        {
          buildingId: 'outside',
          footprintHash: 'a'.repeat(64),
          method: 'footprint',
          mesh: null,
          selectedCandidate: null,
          reason: 'not_in_coverage',
          flags: [],
          candidates: [],
          ground: null,
          archives: []
        }
      ],
      [
        {
          pieceId: '',
          buildingId: 'outside',
          parcelId: null,
          geometry: {
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
          }
        }
      ],
      dir
    );
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe('not_in_coverage');
    expect(existsSync(join(dir, 'clip-job.json'))).toBe(false);
    const inputs = readFileSync(join(dir, 'clip-job.ndjson'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(inputs.map((r) => r.type)).toEqual(['building', 'piece', 'end']);
    expect(inputs[0].value).toEqual({
      buildingId: 'outside',
      mesh: null,
      reason: 'not_in_coverage'
    });
    const lines = readFileSync(join(dir, 'result.ndjson'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1])).toEqual({ type: 'end', pieceCount: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
