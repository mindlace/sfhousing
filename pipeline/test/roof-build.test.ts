import { afterAll, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { miniDuck, MINI } from './helpers';
import { runSql, runSqlRange } from '../lib/sql';
import { writeRoofArtifacts } from '../roofs/export';
import type { ProcessedBuilding } from '../roofs/job';
import { writeChunks } from '../steps/chunks';
import { Report } from '../lib/report';
import * as auditExport from '../roofs/audit';
import { parseRoofAudit } from '../../src/lib/data/roof-audit';
import { buildManifest } from '../steps/manifest';
import { readLock } from '../lib/lock';

afterAll(async () => {
  (await miniDuck()).close();
});

it('continues SQL without resetting counts or recalculating full building heights', async () => {
  const db = await miniDuck();
  await runSql(db, '40_heights.sql');
  await db.run("UPDATE buildings SET height_m=17 WHERE bid='b10'");
  await runSqlRange(db, { from: '50_clip.sql', to: '70_export.sql', resetCounts: false });
  expect(await db.all("SELECT height_m FROM pieces WHERE bid='b10'")).toEqual([
    { height_m: 17 },
    { height_m: 17 }
  ]);
  expect(await db.all("SELECT value FROM report_counts WHERE key='buildings.kept'")).toEqual([
    { value: 10 }
  ]);
});

it('audits every fallback and zero-piece parent without changing parcel bytes or heights', async () => {
  const db = await miniDuck();
  const out = mkdtempSync(join(tmpdir(), 'roof-build-'));
  await runSql(db, '40_heights.sql');
  await db.run(
    "INSERT INTO buildings SELECT * REPLACE ('tiny' AS bid, ST_Buffer(ST_Centroid(geom),0.1) AS geom) FROM buildings LIMIT 1"
  );
  const ids = await db.all<{ bid: string }>('SELECT bid FROM buildings ORDER BY bid');
  await runSqlRange(db, { from: '50_clip.sql', to: '70_export.sql', resetCounts: false });
  const before = await db.all('SELECT * FROM parcel_out');
  const heights = await db.all('SELECT bid,parcel_id,height_m,base_m,hs FROM buildings_export');
  await writeChunks(db, join(out, 'before'), 'fixture-4', new Report());
  const processed: ProcessedBuilding[] = ids.map(({ bid }) => ({
    buildingId: bid,
    footprintHash: 'a'.repeat(64),
    method: 'footprint',
    mesh: null,
    selectedCandidate: null,
    reason: 'not_in_coverage',
    flags: ['aerial_missing'],
    candidates: [],
    ground: null,
    archives: [],
    followUp: { revisit: true, reasons: ['not_in_coverage'] }
  }));
  const result = await writeRoofArtifacts(db, processed, {
    outDir: out,
    datasetVersion: 'fixture-4',
    archiveDir: mkdtempSync(join(tmpdir(), 'roof-archive-'))
  });
  expect(parseRoofAudit(result.audit, 'fixture-4').buildings).toHaveLength(11);
  const chunks = [...auditExport.roofAuditJsonChunks(result.audit)];
  expect(chunks.every((chunk) => Buffer.byteLength(chunk) < 8192)).toBe(true);
  expect(JSON.parse(chunks.join(''))).toEqual(result.audit);
  expect(result.audit.buildings.find((b) => b.buildingId === 'tiny')).toMatchObject({
    outcome: 'all_fallback',
    pieceIds: [],
    parcelIds: [],
    followUp: { revisit: true }
  });
  expect(result.index.chunks).toEqual([]);
  expect(
    result.audit.pieces.every(
      (p) => p.outcome === 'footprint_fallback' && p.reason === 'not_in_coverage'
    )
  ).toBe(true);
  expect(await db.all('SELECT * FROM parcel_out')).toEqual(before);
  expect(await db.all('SELECT bid,parcel_id,height_m,base_m,hs FROM buildings_export')).toEqual(
    heights
  );
  const ex = await db.all<{ piece_id: string; building_id: string }>(
    'SELECT piece_id,building_id FROM buildings_export'
  );
  expect(new Set(ex.map((p) => p.piece_id)).size).toBe(ex.length);
  expect(ex.every((p) => p.building_id && p.piece_id.startsWith('p-'))).toBe(true);
  await writeChunks(db, join(out, 'after'), 'fixture-4', new Report());
  for (const f of readdirSync(join(out, 'before/parcels')))
    expect(readFileSync(join(out, 'after/parcels', f))).toEqual(
      readFileSync(join(out, 'before/parcels', f))
    );
  const manifest = buildManifest({
    datasetVersion: 'fixture-4',
    builtAt: '2026-01-01T00:00:00Z',
    lock: readLock(join(MINI, 'sources.lock.json')),
    chunks: [],
    overtureContrib: [],
    buildingRoofs: result.descriptor
  });
  expect(manifest.buildingRoofs).toEqual(result.descriptor);
  expect(Buffer.byteLength(JSON.stringify(manifest))).toBeLessThan(65536);
});

it('runs a roof-enabled offline build with stable reports, archived evidence and typed fallback tile identities', async () => {
  const { build } = await import('../steps/build');
  const { FIXTURE_PROFILE } = await import('../config');
  const { writeFileSync, existsSync } = await import('node:fs');
  const { run } = await import('../lib/exec');
  const root = mkdtempSync(join(tmpdir(), 'roof-full-build-'));
  const lock = readLock(join(MINI, 'sources.lock.json'));
  lock.sources = lock.sources.filter((s) => !s.id.startsWith('roof-'));
  lock.sources.push({
    id: 'roof-lidar',
    files: [],
    retrievedAt: '2026-01-01',
    upstreamVersion: 'synthetic',
    rowCount: 0,
    license: 'public-domain',
    homepage: 'https://example.org/lidar',
    spatial: {
      horizontalCrs: 'EPSG:7131',
      verticalCrs: null,
      horizontalUnits: 'm',
      verticalUnits: 'm',
      acquisitionStart: null,
      acquisitionEnd: null,
      coverage: [{ id: 'empty', bbox: [-122.51, 37.7, -122.5, 37.71] }],
      supportBufferM: 50,
      permission: 'confirmed',
      alignment: 'not-applicable',
      objects: []
    }
  });
  const lockPath = join(root, 'lock.json');
  writeFileSync(lockPath, JSON.stringify(lock));
  const opts = {
    lockPath,
    rawDir: join(MINI, 'raw'),
    rawByName: true,
    datasetVersion: 'fixture-4',
    profile: FIXTURE_PROFILE
  };
  const a = await build({ ...opts, outRoot: join(root, 'a') });
  const b = await build({ ...opts, outRoot: join(root, 'b') });
  const manifest = JSON.parse(readFileSync(join(a.outDir, 'manifest.json'), 'utf8'));
  expect(manifest.buildingRoofs).toMatchObject({
    schemaVersion: 1,
    indexUrl: '/data/fixture-4/roofs/index.json'
  });
  const audit = parseRoofAudit(
    JSON.parse(readFileSync(join(a.outDir, 'roofs/audit.json'), 'utf8')),
    'fixture-4'
  );
  expect(audit.buildings).toHaveLength(10);
  expect(audit.buildings.find((b) => b.buildingId === 'besri')?.pieceIds).toEqual([]);
  expect(audit.pieces.every((p) => p.reason === 'not_in_coverage')).toBe(true);
  expect(audit.buildings.every((b) => b.followUp.inputArtifactRefs.length > 0)).toBe(true);
  const report = JSON.parse(readFileSync(join(a.outDir, 'report.json'), 'utf8'));
  expect(report.roofArchives.length).toBeGreaterThan(10);
  expect(report.license.artifacts).toContain('roofs/*');
  expect(report.timings).toBeUndefined();
  expect(manifest.sources.some((s: { id: string }) => s.id === 'roof-lidar')).toBe(false);
  expect(existsSync(join(a.outDir, 'roof-processing'))).toBe(false);
  for (const path of [
    'manifest.json',
    'report.json',
    'roofs/index.json',
    'roofs/audit.json',
    'roofs/report.json',
    'parcels/50_25.json'
  ])
    expect(readFileSync(join(a.outDir, path))).toEqual(readFileSync(join(b.outDir, path)));
  const meta = JSON.parse(
    (await run('pmtiles', ['show', join(a.outDir, 'buildings.pmtiles'), '--metadata'])).stdout
  );
  expect(meta.vector_layers[0].fields).toMatchObject({
    pieceId: 'String',
    buildingId: 'String',
    parcelId: 'String',
    heightM: 'Number',
    baseM: 'Number',
    hs: 'Number'
  });
}, 30000);

it('exports accepted parcel meshes while retaining failed candidate metrics and partial-parent evidence', async () => {
  const db = await miniDuck();
  await runSql(db);
  const root = mkdtempSync(join(tmpdir(), 'roof-accepted-'));
  const ids = await db.all<{ bid: string }>('SELECT bid FROM buildings ORDER BY bid');
  const [bounds] = await db.all<{ w: number; s: number; e: number; n: number }>(
    "SELECT ST_XMin(geom) w,ST_YMin(geom) s,ST_XMax(geom) e,ST_YMax(geom) n FROM pieces WHERE bid='b10' ORDER BY parcel_id LIMIT 1"
  );
  const { w, s, e, n } = bounds;
  const mesh = {
    vertices: [
      [w, s, 0],
      [e, s, 0],
      [e, n, 0],
      [w, n, 0],
      [w, s, 10],
      [e, s, 12],
      [e, n, 12],
      [w, n, 10]
    ] as [number, number, number][],
    triangles: [
      [0, 2, 1],
      [0, 3, 2],
      [4, 5, 6],
      [4, 6, 7],
      [0, 1, 5],
      [0, 5, 4],
      [1, 2, 6],
      [1, 6, 5],
      [2, 3, 7],
      [2, 7, 6],
      [3, 0, 4],
      [3, 4, 7]
    ] as [number, number, number][],
    semantics: [
      'GroundSurface',
      'GroundSurface',
      'RoofSurface',
      'RoofSurface',
      ...Array(8).fill('WallSurface')
    ]
  };
  const processed: ProcessedBuilding[] = ids.map(({ bid }) => ({
    buildingId: bid,
    footprintHash: 'a'.repeat(64),
    method: 'footprint',
    mesh: null,
    selectedCandidate: null,
    reason: 'fit_failed',
    flags: [],
    candidates: [
      {
        name: 'simplified',
        mesh: null,
        metrics: {
          reason: 'fit_failed',
          spikes: 0,
          maeM: null,
          validationSamples: 25,
          validationCoverage: null
        }
      }
    ],
    ground: null,
    archives: []
  }));
  const b = processed.find((b) => b.buildingId === 'b10')!;
  Object.assign(b, {
    method: 'lidar_only',
    flags: ['aerial_missing'],
    diagnostics: { vegetation: ['aerial_partial_coverage'] },
    mesh,
    selectedCandidate: 'reference',
    reason: null,
    ground: { groundM: 31, method: 'near_ground', count: 50 },
    returnCounts: { before: 100, retained: 90, rejected: 10, roofTraining: 60, validation: 25 }
  });
  b.candidates.push({
    name: 'reference',
    mesh,
    metrics: {
      reason: null,
      spikes: 0,
      maeM: 0.2,
      validationSamples: 25,
      validationCoverage: 1,
      roofCoverage: 1,
      maxHeightM: 12,
      triangleCount: 12,
      roofSections: 1
    }
  });
  const result = await writeRoofArtifacts(db, processed, {
    outDir: join(root, 'public'),
    archiveDir: join(root, 'archive'),
    datasetVersion: 'fixture-4'
  });
  const parent = result.audit.buildings.find((b) => b.buildingId === 'b10')!;
  expect(parent.outcome).toBe('partly_modelled');
  expect(parent.sources.imageryCoverage).toBe('partial');
  expect(parent.processing.attempts.map((a) => a.outcome)).toEqual(['failed', 'accepted']);
  expect(parent.quality.validationMae).toEqual({ value: 0.2, unavailableReason: null });
  expect(parent.followUp).toMatchObject({ revisit: true, reasons: ['parcel_clip_failed'] });
  expect(
    result.audit.pieces
      .filter((p) => p.buildingId === 'b10')
      .map((p) => p.outcome)
      .sort()
  ).toEqual(['footprint_fallback', 'modelled']);
  expect(result.index.chunks).toHaveLength(1);
  expect(result.archives.some((a) => a.name.endsWith('-clip.json'))).toBe(true);
  const header = JSON.parse(
    readFileSync(join(root, 'public/roofs', result.index.chunks[0].chunkId + '.json'), 'utf8')
  );
  expect(header.pieces).toHaveLength(1);
  expect(header.pieces[0].buildingId).toBe('b10');
  const modelled = result.audit.pieces.find(
    (p) => p.buildingId === 'b10' && p.outcome === 'modelled'
  )!;
  expect(modelled.bbox).not.toEqual(parent.bbox);
});
