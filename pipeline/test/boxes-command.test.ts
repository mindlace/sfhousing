import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDuck, type Duck } from '../lib/duck';
import {
  BOXES_FILES,
  BOXES_ID,
  boxesInputsOf,
  boxesLockProblem,
  boxesStaleWarnings,
  boxesUpstreamVersion,
  configHash,
  entryHash,
  parseBoxesUpstreamVersion,
  type BoxesInputs
} from '../lib/lidar/artifact';
import { openLidarMosaic } from '../lib/lidar/mosaic';
import { rawPath, readLock, sha256File, type Lock, type LockEntry } from '../lib/lock';
import { runSql } from '../lib/sql';
import { LIDAR_LOCK, lidarTilesOf, readLidarLock } from '../sources/lidar';
import { StreetIndex } from '../lib/lidar/streets';
import type { Part } from '../lib/lidar/parts';
import { area, type MultiPoly, type Ring } from '../geom';
import { boxesCommand, buildingBoxes, deriveBuildingBoxes, loadBoxRows } from '../steps/boxes';
import { MINI, openMiniDuck } from './helpers';
import { fpOf, rect, shiftOf, synthWindow, type SynthScene } from './lidar-synth';

const RAW = join(MINI, 'raw');

interface BoxRow {
  bid: string;
  k: number;
  src: string;
  base_m: number;
  height_m: number;
  geom: Uint8Array | null;
}

interface RoofRow {
  bid: string;
  roof: string;
  eave_m: number | null;
  ridge_m: number | null;
  ground_m: number | null;
  ground_min_m: number | null;
  shift_dx: number | null;
  shift_dy: number | null;
  shift_source: string | null;
  fallback: string | null;
  n_step: number;
  n_parts: number;
  uncovered_dropped: number;
  [k: string]: unknown;
}

const miniLidar = () => openLidarMosaic(lidarTilesOf(readLidarLock(LIDAR_LOCK.fixture), RAW, true));

/** The mini lock as make-fixture.ts writes it (no building-boxes entry). */
const miniLock = (): Lock => {
  const l = readLock(join(MINI, 'sources.lock.json'));
  return { sources: l.sources.filter((s) => s.id !== BOXES_ID) };
};

const near = (v: number | null | undefined, want: number, tol: number): boolean =>
  typeof v === 'number' && Math.abs(v - want) <= tol;

let db: Duck;
let snap: { boxes: BoxRow[]; roofs: RoofRow[] };
const readBoxes = () => db.all<BoxRow>('SELECT * FROM bx_boxes ORDER BY bid, k');
const readRoofs = () => db.all<RoofRow>('SELECT * FROM bx_roofs ORDER BY bid');
const work = () => mkdtempSync(join(tmpdir(), 'sfh-boxes-test-'));

/** [xmin, xmax] of a box's geometry, or of the building's footprint when geom is NULL. */
async function xRange(bid: string, k: number): Promise<[number, number]> {
  const [r] = await db.all<{ x0: number; x1: number }>(`
    SELECT ST_XMin(g) AS x0, ST_XMax(g) AS x1 FROM (
      SELECT coalesce(ST_GeomFromWKB(x.geom), b.geom) AS g
      FROM bx_boxes x JOIN buildings b USING (bid) WHERE x.bid = '${bid}' AND x.k = ${k})`);
  return [r.x0, r.x1];
}

async function footprintX(bid: string): Promise<[number, number]> {
  const [r] = await db.all<{ x0: number; x1: number }>(
    `SELECT ST_XMin(geom) AS x0, ST_XMax(geom) AS x1 FROM buildings WHERE bid = '${bid}'`
  );
  return [r.x0, r.x1];
}

beforeAll(async () => {
  db = await openMiniDuck({ roadLotInputs: false });
  await runSql(db, '50_clip.sql');
  await deriveBuildingBoxes({ db, lidar: miniLidar(), workDir: work() });
  snap = { boxes: await readBoxes(), roofs: await readRoofs() };
}, 120_000);

afterAll(() => db?.close());

describe('deriveBuildingBoxes', () => {
  it('the mini buildings get their boxes', async () => {
    const boxesOf = (bid: string) => snap.boxes.filter((b) => b.bid === bid);
    const roofOf = (bid: string) => snap.roofs.find((r) => r.bid === bid)!;

    const b01 = boxesOf('b01');
    expect(b01).toHaveLength(1);
    expect(b01[0]).toMatchObject({ src: 'base', geom: null, base_m: 0 });
    expect(near(b01[0].height_m, 12, 0.2)).toBe(true);
    expect(roofOf('b01').shift_source).toBe('fit');
    expect(near(roofOf('b01').shift_dx, 1.0, 0.1)).toBe(true);
    expect(near(roofOf('b01').shift_dy, -0.3, 0.1)).toBe(true);

    expect(boxesOf('b02').some((b) => b.src === 'front' && near(b.height_m, 16.5, 0.2))).toBe(true);
    expect(roofOf('b03').fallback).toBe('new_building');
    expect(boxesOf('b03')).toEqual([]);
    expect(boxesOf('b04').filter((b) => b.src === 'step')).toEqual([]);
    expect(roofOf('b13').roof).toBe('pitched');
    expect(near(roofOf('b13').ridge_m, 10, 0.3)).toBe(true);

    expect(roofOf('bbay').fallback).toBe('no_lidar');
    expect(boxesOf('bbay')).toEqual([]);

    // bpier is Salesforce in small: its skillion part is disputed by the LiDAR and rejected, and the
    // tapering tower is sliced into stacked terraces (heights are above the 12 m base).
    const pier = boxesOf('bpier');
    expect(roofOf('bpier')).toMatchObject({
      parts_checked: 1,
      parts_disputed: 1,
      parts_rejected: true,
      sliced: true,
      step_cap: 32,
      n_parts: 1,
      fallback: null
    });
    expect(pier.some((b) => b.src === 'part')).toBe(false);
    const steps = pier.filter((b) => b.src === 'step');
    expect(steps).toHaveLength(4);
    [24, 36, 48, 60].forEach((h, i) => {
      expect(near(steps[i].height_m, h, 0.3)).toBe(true);
      expect(near(steps[i].base_m, h - 12, 0.3)).toBe(true);
    });
    const areas = await db.all<{ k: number; a: number; x0: number; x1: number }>(`
      SELECT k, ST_Area(g) AS a, ST_XMin(g) AS x0, ST_XMax(g) AS x1 FROM (
        SELECT x.k, coalesce(ST_GeomFromWKB(x.geom), b.geom) AS g
        FROM bx_boxes x JOIN buildings b USING (bid) WHERE x.bid = 'bpier') ORDER BY k`);
    // Each terrace is the tier and everything above it, set back 2 m per side from the one below.
    expect(areas.map((a) => near(a.a, [160, 129, 97, 65, 33][a.k], 3))).toEqual(
      Array(5).fill(true)
    );
    for (let k = 2; k < 5; k++) {
      expect(near(areas[k].x0 - areas[k - 1].x0, 2, 0.2)).toBe(true);
      expect(near(areas[k - 1].x1 - areas[k].x1, 2, 0.2)).toBe(true);
    }
    const pierBase = pier.filter((b) => b.src === 'base');
    expect(pierBase).toHaveLength(1);
    expect(near(pierBase[0].height_m, 12, 0.2)).toBe(true);

    // b10: p10 covers x[95,100]; the LiDAR derives the uncovered x[100,105] with its 26 m step.
    const [fx0, fx1] = await footprintX('b10');
    const mid = (fx0 + fx1) / 2;
    const b10 = boxesOf('b10');
    const parts = b10.filter((b) => b.src === 'part');
    expect(parts).toHaveLength(1);
    const [px0, px1] = await xRange('b10', parts[0].k);
    expect(near(px0, fx0, 0.05) && near(px1, mid, 0.05)).toBe(true);
    const lidarBoxes = b10.filter((b) => b.src !== 'part');
    expect(lidarBoxes.length).toBeGreaterThan(0);
    for (const b of lidarBoxes) {
      expect(b.geom).not.toBeNull();
      const [x0, x1] = await xRange('b10', b.k);
      expect(x0).toBeGreaterThanOrEqual(mid - 0.05);
      expect(x1).toBeLessThanOrEqual(fx1 + 0.05);
    }
    expect(lidarBoxes.some((b) => b.src === 'step' && near(b.height_m, 26, 0.3))).toBe(true);
    expect(roofOf('b10').uncovered_dropped).toBe(0);

    const b14 = boxesOf('b14');
    expect(b14).toHaveLength(8);
    expect(b14.every((b) => b.src === 'part')).toBe(true);
    const r14 = roofOf('b14');
    expect(r14.n_parts).toBe(3);
    expect(r14.fallback).toBeNull();
    expect(r14.ground_m).not.toBeNull();
    expect(r14.ground_min_m!).toBeLessThan(r14.ground_m! - 0.2);

    // p14a is checked (p14b is tiered, p14leg small); p10 is checked and agrees.
    expect(r14).toMatchObject({ parts_checked: 1, parts_disputed: 0, parts_rejected: false });
    expect(roofOf('b10')).toMatchObject({
      parts_checked: 1,
      parts_disputed: 0,
      parts_rejected: false
    });
    for (const r of snap.roofs.filter(
      (x) => x.bid !== 'b14' && x.bid !== 'b10' && x.bid !== 'bpier'
    ))
      expect([r.bid, r.parts_checked, r.parts_disputed, r.parts_rejected]).toEqual([
        r.bid,
        0,
        0,
        false
      ]);
    for (const r of snap.roofs.filter((x) => x.n_parts === 0))
      expect([r.bid, r.sliced, r.step_cap]).toEqual([r.bid, false, 4]);
  });

  it('keeps boxes ordered with k from 0 and heights inside the range', () => {
    const byBid = new Map<string, number[]>();
    for (const b of snap.boxes) byBid.set(b.bid, [...(byBid.get(b.bid) ?? []), b.k]);
    for (const ks of byBid.values()) expect(ks).toEqual(ks.map((_, i) => i));
    for (const b of snap.boxes) {
      expect(b.height_m).toBeGreaterThanOrEqual(2.5);
      expect(b.height_m).toBeLessThanOrEqual(340);
      expect(b.base_m).toBeGreaterThanOrEqual(0);
      expect(b.base_m).toBeLessThan(b.height_m);
      expect(Math.round(b.height_m * 10) / 10).toBe(b.height_m);
    }
  });

  it('bx_roofs has one row per kept building', async () => {
    const bids = await db.all<{ bid: string }>('SELECT bid FROM buildings ORDER BY bid');
    expect(snap.roofs).toHaveLength(12);
    expect(snap.roofs.map((r) => r.bid)).toEqual(bids.map((b) => b.bid));
    for (const r of snap.roofs) {
      expect(typeof r.lng).toBe('number');
      expect(typeof r.lat).toBe('number');
    }
  });

  it('without a LiDAR lock every building falls back', async () => {
    await deriveBuildingBoxes({ db, lidar: null, workDir: work() });
    const roofs = await readRoofs();
    const boxes = await readBoxes();
    expect(roofs).toHaveLength(12);
    for (const r of roofs) {
      // b14 and bpier are covered by their parts, which need no LiDAR (unchecked, drawn as given).
      if (r.bid === 'b14' || r.bid === 'bpier') expect(r.fallback).toBeNull();
      else expect([r.bid, r.fallback]).toEqual([r.bid, 'no_lidar']);
      expect(r.shift_source).toBeNull();
    }
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.every((b) => b.src === 'part')).toBe(true);
    // b10's uncovered half has no LiDAR: dropped and counted, never drawn at height_m.
    expect(roofs.find((r) => r.bid === 'b10')!.uncovered_dropped).toBeGreaterThan(40);
  });

  it('deterministic', async () => {
    await deriveBuildingBoxes({ db, lidar: miniLidar(), workDir: work() });
    expect(await readBoxes()).toEqual(snap.boxes);
    expect(await readRoofs()).toEqual(snap.roofs);
    await deriveBuildingBoxes({ db, lidar: miniLidar(), workDir: work() });
    expect(await readBoxes()).toEqual(snap.boxes);
    expect(await readRoofs()).toEqual(snap.roofs);
  });

  it('the committed mini artifact is current', async () => {
    const hint = 'run npm run pipeline -- boxes --fixture';
    for (const f of [BOXES_FILES.boxes, BOXES_FILES.roofs])
      expect(existsSync(join(RAW, f)), `${f} missing: ${hint}`).toBe(true);
    const boxes = await db.all<BoxRow>(
      `SELECT * FROM read_parquet('${join(RAW, BOXES_FILES.boxes)}') ORDER BY bid, k`
    );
    const roofs = await db.all<RoofRow>(
      `SELECT * FROM read_parquet('${join(RAW, BOXES_FILES.roofs)}') ORDER BY bid`
    );
    expect(boxes, hint).toEqual(snap.boxes);
    expect(roofs, hint).toEqual(snap.roofs);
  });
});

describe('recorded inputs', () => {
  const code = 'c'.repeat(64);

  it('records the full hashes and round-trips their prefixes', () => {
    const lock = miniLock();
    const lidarLock = readLidarLock(LIDAR_LOCK.fixture);
    const i = boxesInputsOf(lock, lidarLock, code);
    const entry = (l: Lock | null, id: string) => l?.sources.find((s) => s.id === id);
    expect(i.schema).toBe(2);
    expect(i.code).toBe(code);
    expect(i.config).toBe(configHash());
    expect(i.config).toMatch(/^[0-9a-f]{64}$/);
    expect(i.sources['overture-buildings']).toBe(entryHash(entry(lock, 'overture-buildings')));
    expect(i.sources['overture-buildings']).toMatch(/^[0-9a-f]{64}$/);
    expect(i.sources['usgs-lidar-sf']).toBe(entryHash(entry(lidarLock, 'usgs-lidar-sf')));
    expect(i.sources['usgs-lidar-sf']).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(i.sources)).toEqual([
      'overture-buildings',
      'overture-building-parts',
      'usgs-lidar-sf',
      'datasf-parcels',
      'datasf-streets',
      'datasf-neighborhoods'
    ]);

    const noParts = { sources: lock.sources.filter((s) => s.id !== 'overture-building-parts') };
    const j = boxesInputsOf(noParts, lidarLock, code);
    expect(j.sources['overture-building-parts']).toBe('');
    const v = boxesUpstreamVersion(j);
    expect(v).toMatch(/^boxes\/2 code=c{12} config=[0-9a-f]{12} overture-buildings=[0-9a-f]{12} /);
    expect(v).toContain(' overture-building-parts=- ');
    const p = parseBoxesUpstreamVersion(v);
    expect(p.code).toBe(code.slice(0, 12));
    expect(p.config).toBe(j.config.slice(0, 12));
    for (const [id, h] of Object.entries(j.sources))
      expect(p.sources[id]).toBe(h === '' ? '-' : h.slice(0, 12));
    expect(entryHash(undefined)).toBe('');
    expect(() => parseBoxesUpstreamVersion(v.replace('boxes/2', 'boxes/1'))).toThrow('not boxes/2');
    // A lock recording a boxes/1 artifact is stale and names the command that rebuilds it.
    const old = withEntry(lock, j);
    const e = old.sources.find((x) => x.id === BOXES_ID)!;
    e.upstreamVersion = e.upstreamVersion.replace('boxes/2', 'boxes/1');
    expect(boxesLockProblem(old)).toContain('npm run pipeline -- boxes');
  });
});

/** A lock whose building-boxes entry records `inputs`. */
function withEntry(lock: Lock, inputs: BoxesInputs): Lock {
  const entry: LockEntry = {
    id: BOXES_ID,
    files: [],
    retrievedAt: '2026-10-10T00:00:00.000Z',
    upstreamVersion: boxesUpstreamVersion(inputs),
    rowCount: 0,
    license: 'ODbL-1.0',
    homepage: 'https://www.usgs.gov/3d-elevation-program'
  };
  return { sources: [...lock.sources.filter((s) => s.id !== BOXES_ID), entry] };
}

/** A deep copy of `lock` with the first file sha256 of `id` replaced. */
function changed(lock: Lock, id: string): Lock {
  const l = structuredClone(lock);
  const e = l.sources.find((s) => s.id === id)!;
  e.files[0].sha256 = 'f'.repeat(64);
  return l;
}

describe('buildingBoxes', () => {
  const part = (id: string, ring: Ring, o: Partial<Part> = {}): Part => ({
    id,
    buildingId: 'b1',
    shape: [[ring]] as MultiPoly,
    heightM: 20,
    minHeightM: null,
    roofShape: null,
    roofHeightM: null,
    ...o
  });
  const win = (scene: SynthScene, ring: Ring) => {
    const xs = ring.map((q) => q[0]);
    const ys = ring.map((q) => q[1]);
    return synthWindow(scene, {
      x0: Math.min(...xs) - 4,
      y0: Math.min(...ys) - 4,
      x1: Math.max(...xs) + 4,
      y1: Math.max(...ys) + 4
    });
  };
  const streets = new StreetIndex([]);

  it('a rejected building takes the plain LiDAR derivation', () => {
    const ring = rect(100, 200, 130, 220);
    const cake: SynthScene = {
      ground: () => 15,
      boxes: [
        { ring, top: 12 },
        { ring: rect(101, 201, 129, 219), top: 24 },
        { ring: rect(103, 203, 127, 217), top: 36 },
        { ring: rect(105, 205, 125, 215), top: 48 },
        { ring: rect(107, 207, 123, 213), top: 60 }
      ]
    };
    // Drawn too low: a skillion topping at 15 m over the cake's 24-60 m.
    const p = part('a', rect(100, 200, 120, 208), {
      heightM: 20,
      roofShape: 'skillion',
      roofHeightM: 10
    });
    const r = buildingBoxes(win(cake, ring), fpOf([[ring]]), shiftOf(), streets, [p]);
    expect(r.check?.rejected).toBe(true);
    expect(r.boxes.some((b) => b.src === 'part')).toBe(false);
    expect(r.boxes.some((b) => b.src === 'base')).toBe(true);
    expect(r.roof.sliced).toBe(true);
    expect(r.roof.fallback).toBeNull();
    expect(r.boxes.length).toBeGreaterThan(0);
    expect(r.nParts).toBe(1);
    expect(r.dropped).toBe(0);
  });

  it('a rejected building whose LiDAR falls back stores no rows', () => {
    const ring = rect(100, 200, 120, 210); // 200 m2
    const pr = rect(100, 200, 106, 205); // 30 m2
    const scene: SynthScene = { ground: () => 15, boxes: [{ ring: pr, top: 10 }] };
    const r = buildingBoxes(win(scene, ring), fpOf([[ring]]), shiftOf(), streets, [
      part('a', pr, { heightM: 3 }) // drawn 7 m under the LiDAR's 10 m
    ]);
    expect(area([[pr]])).toBe(30);
    expect(r.check).toMatchObject({ disputed: 1, rejected: true });
    expect(r.roof.fallback).toBe('new_building');
    expect(r.boxes).toEqual([]);
    expect(r.nParts).toBe(1);
  });
});

describe('boxesLockProblem', () => {
  const code = 'c'.repeat(64);
  const lidarLock = readLidarLock(LIDAR_LOCK.fixture);

  it('is null without the entry and when consistent', () => {
    const lock = miniLock();
    expect(boxesLockProblem(lock)).toBeNull();
    expect(boxesLockProblem(withEntry(lock, boxesInputsOf(lock, lidarLock, code)))).toBeNull();
  });

  it.each(['overture-buildings', 'overture-building-parts'])(
    'names both %s prefixes when that source changed',
    (id) => {
      const lock = miniLock();
      const recorded = boxesInputsOf(lock, lidarLock, code);
      const now = changed(withEntry(lock, recorded), id);
      const msg = boxesLockProblem(now);
      expect(msg).not.toBeNull();
      const was = recorded.sources[id].slice(0, 12);
      const is = entryHash(now.sources.find((s) => s.id === id)).slice(0, 12);
      expect(was).not.toBe(is);
      expect(msg).toContain(`building-boxes were derived from ${id} ${was}, the lock has ${is}`);
      expect(msg).toMatch(/: run npm run pipeline -- boxes$/);
    }
  );

  it('ignores the non-gated sources', () => {
    const lock = miniLock();
    const now = changed(withEntry(lock, boxesInputsOf(lock, lidarLock, code)), 'datasf-streets');
    expect(boxesLockProblem(now)).toBeNull();
  });
});

describe('boxesStaleWarnings', () => {
  const code = 'c'.repeat(64);
  const lidarLock = readLidarLock(LIDAR_LOCK.fixture);
  const tail = 'run npm run pipeline -- boxes to refresh';

  it('is empty when everything matches, and without an entry', () => {
    const lock = miniLock();
    expect(boxesStaleWarnings(lock, lidarLock, code)).toEqual([]);
    const ok = withEntry(lock, boxesInputsOf(lock, lidarLock, code));
    expect(boxesStaleWarnings(ok, lidarLock, code)).toEqual([]);
  });

  it('warns once each for a changed street source, code hash and config hash', () => {
    const lock = miniLock();
    const recorded = boxesInputsOf(lock, lidarLock, code);
    const streets = boxesStaleWarnings(
      changed(withEntry(lock, recorded), 'datasf-streets'),
      lidarLock,
      code
    );
    expect(streets).toHaveLength(1);
    expect(streets[0]).toContain('datasf-streets');
    expect(streets[0].endsWith(tail)).toBe(true);

    const codeW = boxesStaleWarnings(withEntry(lock, recorded), lidarLock, 'd'.repeat(64));
    expect(codeW).toHaveLength(1);
    expect(codeW[0]).toContain('code');
    expect(codeW[0].endsWith(tail)).toBe(true);

    const cfg = boxesStaleWarnings(
      withEntry(lock, { ...recorded, config: 'e'.repeat(64) }),
      lidarLock,
      code
    );
    expect(cfg).toHaveLength(1);
    expect(cfg[0]).toContain('config');
    expect(cfg[0].endsWith(tail)).toBe(true);

    expect(boxesStaleWarnings(withEntry(lock, recorded), null, code)).toEqual([
      expect.stringContaining('usgs-lidar-sf')
    ]);
  });
});

describe('boxesCommand', () => {
  /** A copy of the mini fixture's locks and raw files in a temp dir. */
  function miniCopy(): { dir: string; lockPath: string; lidarLockPath: string; rawDir: string } {
    const dir = mkdtempSync(join(tmpdir(), 'sfh-boxes-cmd-'));
    cpSync(join(MINI, 'sources.lock.json'), join(dir, 'sources.lock.json'));
    cpSync(join(MINI, 'lidar.lock.json'), join(dir, 'lidar.lock.json'));
    cpSync(RAW, join(dir, 'raw'), { recursive: true });
    return {
      dir,
      lockPath: join(dir, 'sources.lock.json'),
      lidarLockPath: join(dir, 'lidar.lock.json'),
      rawDir: join(dir, 'raw')
    };
  }

  it('on a copy of the mini fixture writes the artifact and its lock entry', async () => {
    const c = miniCopy();
    const lines: string[] = [];
    const errs: string[] = [];
    const run = (now?: Date) =>
      boxesCommand({
        lockPath: c.lockPath,
        lidarLockPath: c.lidarLockPath,
        rawDir: c.rawDir,
        byName: true,
        repoRoot: process.cwd(),
        fixture: true,
        now,
        out: (l) => lines.push(l),
        err: (l) => errs.push(l)
      });
    expect(await run(new Date('2026-11-01T00:00:00.000Z'))).toBe(0);
    expect(errs).toEqual([]);
    expect(lines).toContain('boxes.outside_footprint 0');
    expect(lines.some((l) => l.startsWith('boxes.buildings 12'))).toBe(true);
    const lock = readLock(c.lockPath);
    const entry = lock.sources.find((s) => s.id === BOXES_ID)!;
    expect(entry).toMatchObject({
      rowCount: 12,
      retrievedAt: '2026-11-01T00:00:00.000Z',
      license: 'ODbL-1.0',
      label: 'Building boxes (USGS 3DEP LiDAR 2023 and Overture)',
      homepage: 'https://www.usgs.gov/3d-elevation-program'
    });
    expect(entry.files.map((f) => f.name)).toEqual([
      BOXES_FILES.boxes,
      BOXES_FILES.roofs,
      BOXES_FILES.inputs
    ]);
    for (const f of entry.files) {
      const p = rawPath(c.rawDir, f, true);
      expect(existsSync(p)).toBe(true);
      expect(await sha256File(p)).toBe(f.sha256);
    }
    const inputs = JSON.parse(readFileSync(rawPath(c.rawDir, entry.files[2], true), 'utf8'));
    expect(entry.upstreamVersion).toBe(boxesUpstreamVersion(inputs));
    expect(boxesLockProblem(lock)).toBeNull();

    const first = readFileSync(c.lockPath, 'utf8');
    expect(await run(new Date('2026-11-02T00:00:00.000Z'))).toBe(0);
    const second = readFileSync(c.lockPath, 'utf8');
    const mask = (s: string) => s.replaceAll(/"retrievedAt": "2026-11-0[12]T[^"]*"/g, 'R');
    expect(second).not.toBe(first);
    expect(mask(second)).toBe(mask(first));

    // --fixture stamps the mini fixture's fixed date (ruling F1).
    expect(await run()).toBe(0);
    const fixed = readLock(c.lockPath).sources.find((s) => s.id === BOXES_ID)!;
    expect(fixed.retrievedAt).toBe('2026-10-10T00:00:00.000Z');
    rmSync(c.dir, { recursive: true, force: true });
  }, 180_000);

  it('--probe prints the named buildings and writes nothing', async () => {
    const c = miniCopy();
    const lockBefore = readFileSync(c.lockPath);
    const lines: string[] = [];
    const errs: string[] = [];
    const code = await boxesCommand({
      lockPath: c.lockPath,
      lidarLockPath: c.lidarLockPath,
      rawDir: c.rawDir,
      byName: true,
      repoRoot: process.cwd(),
      fixture: true,
      probe: ['bpier', 'b14', 'nope'],
      out: (l) => lines.push(l),
      err: (l) => errs.push(l)
    });
    expect(code).toBe(0);
    const rows = lines.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
    expect(rows.map((r) => r.bid)).toEqual(['bpier', 'b14']);
    const [pier, b14] = rows;
    expect(pier).toMatchObject({ partsRejected: true, sliced: true });
    expect(pier.topM).toBeCloseTo(60, 0);
    expect(Math.abs(pier.topM - 60)).toBeLessThanOrEqual(0.3);
    expect(pier.parts).toHaveLength(1);
    expect(pier.parts[0].disputed).toBe(true);
    expect(b14.parts).toHaveLength(3);
    expect(b14.parts.find((p: { id: string }) => p.id === 'p14a').checked).toBe(true);
    expect(errs.join('\n')).toContain('nope');
    expect(readFileSync(c.lockPath).equals(lockBefore)).toBe(true);
    rmSync(c.dir, { recursive: true, force: true });
  }, 180_000);

  it('--probe reads its building ids from a file with @path', async () => {
    const c = miniCopy();
    const f = join(c.dir, 'bids.txt');
    writeFileSync(f, 'b14\n\n  bpier \n');
    const lines: string[] = [];
    const code = await boxesCommand({
      lockPath: c.lockPath,
      lidarLockPath: c.lidarLockPath,
      rawDir: c.rawDir,
      byName: true,
      repoRoot: process.cwd(),
      fixture: true,
      probe: [`@${f}`],
      out: (l) => lines.push(l),
      err: () => {}
    });
    expect(code).toBe(0);
    expect(lines.map((l) => JSON.parse(l).bid)).toEqual(['b14', 'bpier']);
    rmSync(c.dir, { recursive: true, force: true });
  }, 180_000);

  it('without the LiDAR tiles exits 1 and names fetch --restore --lidar', async () => {
    const c = miniCopy();
    rmSync(join(c.rawDir, 'usgs-lidar-sf'), { recursive: true, force: true });
    const errs: string[] = [];
    const code = await boxesCommand({
      lockPath: c.lockPath,
      lidarLockPath: c.lidarLockPath,
      rawDir: c.rawDir,
      byName: true,
      repoRoot: process.cwd(),
      fixture: true,
      out: () => {},
      err: (l) => errs.push(l)
    });
    expect(code).toBe(1);
    expect(errs.join('\n')).toContain('fetch --restore --lidar');
    rmSync(c.dir, { recursive: true, force: true });
  });
});

describe('loadBoxRows', () => {
  // A live false-front strip (city run, 2026-11-14): clipper's mm rounding left a spike whose
  // edges cross, so GEOS threw "side location conflict" in the outside-footprint check.
  const SPIKE = {
    type: 'Polygon',
    coordinates: [
      [
        [43992.553, 21768.224],
        [43992.35, 21768.951],
        [43992.347, 21768.95],
        [43992.274, 21769.184],
        [43992.273, 21769.184],
        [43992.419, 21768.706],
        [43988.566, 21767.631],
        [43988.701, 21767.149],
        [43992.553, 21768.224]
      ]
    ]
  };
  const SQUARE = {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
        [0, 0]
      ]
    ]
  };

  it('makes invalid box geometry valid and keeps valid geometry and NULLs as they are', async () => {
    const dir = work();
    const path = join(dir, 'bx_boxes.ndjson');
    const row = (bid: string, k: number, src: string, g: object | null) =>
      JSON.stringify({ bid, k, src, base_m: 0, height_m: 10, g: g && JSON.stringify(g) });
    writeFileSync(
      path,
      [row('a', 0, 'base', null), row('a', 1, 'front', SPIKE), row('b', 0, 'base', SQUARE)].join(
        '\n'
      ) + '\n'
    );
    const d = await openDuck();
    try {
      await loadBoxRows(d, path, 'bx_test');
      const rows = await d.all<{ bid: string; k: number; valid: boolean | null; a: number | null }>(
        `SELECT bid, k, ST_IsValid(ST_GeomFromWKB(geom)) AS valid,
                ST_Area(ST_GeomFromWKB(geom)) AS a
         FROM bx_test ORDER BY bid, k`
      );
      expect(rows.map((r) => [r.bid, r.k, r.valid])).toEqual([
        ['a', 0, null],
        ['a', 1, true],
        ['b', 0, true]
      ]);
      expect(rows[1].a).toBeGreaterThan(1.9);
      expect(rows[2].a).toBe(16);
      const [{ same }] = await d.all<{ same: boolean }>(
        `SELECT geom = ST_AsWKB(ST_GeomFromGeoJSON('${JSON.stringify(SQUARE)}'))::BLOB AS same
         FROM bx_test WHERE bid = 'b'`
      );
      expect(same).toBe(true);
    } finally {
      d.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
