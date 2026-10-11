// Test harness for the worker host (spec §6 host.spec.ts). Test-only: may use node:fs and zod.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { parseManifest, type Manifest } from '$lib/data/manifest';
import type { ParcelRecord } from '$lib/data/parcel';
import { decodeParcelChunk } from '$lib/data/parcel-chunk';
import type { GeneratedBuilding } from '$lib/generator';
import { TYPOLOGY_ORDER, type GeneratedUpdate, type PackedCell } from '$lib/map/types';
import type { Envelope } from '$lib/plan';
import { M1_TARGETS, score, type Score } from '$lib/scoreboard';
import type { FetchLike } from '../chunks';
import { createSimHost, type SimHost, type SimHostDeps } from '../host';
import type { DiffResponse, SimResponse } from '../protocol';

type Resp = Awaited<ReturnType<FetchLike>>;

export interface Reconstructed {
  parcels: Map<
    string,
    { cellId: string; units: number; existingUnits: number; stories: number; typology: number }
  >;
  hidden: Set<string>;
}

export interface Harness {
  host: SimHost;
  sent: SimResponse[];
  fetches: string[];
  /** Every record the harness can serve, by id (for rebuilding score entries). */
  records: Map<string, ParcelRecord>;
  /** 'auto': every fetch resolves on the next microtask; 'manual': resolve(cellId) releases it. */
  release(cellId: string): void;
  fail(cellId: string, times: number): void; // next `times` fetches of cellId fail with 500
  flush(): Promise<void>; // await enough turns so fetch→json→onLoaded completes
  next(): number; // next rev, starting at 1
  diffs(): DiffResponse[];
  display(): Reconstructed; // reconstructed from every render in order
}

const FIXTURE_DIR = join(import.meta.dirname, '..', 'fixtures', 'data', 'fixture-1');
const readJson = (p: string): unknown => JSON.parse(readFileSync(join(FIXTURE_DIR, p), 'utf8'));

function loadFixture1(): { manifest: Manifest; chunks: Record<string, unknown> } {
  const manifest = parseManifest(readJson('manifest.json'));
  const chunks: Record<string, unknown> = {};
  for (const c of manifest.chunks) chunks[c.cellId] = readJson(`parcels/${c.cellId}.json`);
  return { manifest, chunks };
}

/** fixture-1: the manifest and each chunk's raw JSON body, keyed by cellId. */
export const FIXTURE_1: { manifest: Manifest; chunks: Record<string, unknown> } = loadFixture1();

/** cellId of every fixture-1 parcel. */
export const FIXTURE_1_CELL_OF: ReadonlyMap<string, string> = new Map(
  Object.entries(FIXTURE_1.chunks).flatMap(([cellId, body]) =>
    decodeParcelChunk(body).map((r): [string, string] => [r.id, cellId])
  )
);

export const MIDRISE = TYPOLOGY_ORDER.indexOf('midrise');

/** Stub generator (spec §6): units = maxStories when maxStories > 2, else null. */
export function stubGenerate(p: ParcelRecord, env: Envelope): GeneratedBuilding | null {
  const s = env.maxStories;
  if (s <= 2) return null;
  const [lng, lat] = p.labelPoint;
  const d = 1e-5;
  return {
    parcelId: p.id,
    source: 'user',
    composition: 'simple',
    typology: 'midrise',
    parts: [
      {
        footprint: [
          [lng - d, lat - d],
          [lng - d, lat + d],
          [lng + d, lat + d],
          [lng + d, lat - d]
        ],
        role: 'occupied',
        tone: 0,
        baseM: 0,
        topM: 3.1 * s
      }
    ],
    stories: s,
    units: s,
    floorAreaM2: 100 * s,
    replacesExisting: true
  };
}

function unpack(p: PackedCell, into: Reconstructed['parcels']): void {
  p.parcelIds.forEach((id, slot) => {
    const m = p.parcelMeta;
    into.set(id, {
      cellId: p.cellId,
      units: m[4 * slot],
      existingUnits: m[4 * slot + 1],
      stories: m[4 * slot + 2],
      typology: m[4 * slot + 3]
    });
  });
}

/** Applies render updates in order, asserting the gap-free revision chain. */
export function reconstruct(updates: GeneratedUpdate[]): Reconstructed {
  const r: Reconstructed = { parcels: new Map(), hidden: new Set() };
  let prev = -1;
  const dropCell = (cellId: string) => {
    for (const [id, v] of r.parcels) if (v.cellId === cellId) r.parcels.delete(id);
  };
  for (const u of updates) {
    if (u.revision !== 0 && u.revision !== prev + 1) {
      throw new Error(`revision gap: ${prev} → ${u.revision}`);
    }
    prev = u.revision;
    if (u.revision === 0) {
      r.parcels.clear();
      r.hidden.clear();
    }
    for (const { settled, rising } of u.cells) {
      dropCell(settled.cellId);
      unpack(settled, r.parcels);
      if (rising) unpack(rising, r.parcels);
    }
    for (const c of u.removedCells) dropCell(c);
    for (const id of u.hide.add) r.hidden.add(id);
    for (const id of u.hide.remove) r.hidden.delete(id);
  }
  return r;
}

/** Order-independent string form, for deep comparison. */
export function serialise(r: Reconstructed): string {
  const parcels = [...r.parcels].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return JSON.stringify({ parcels, hidden: [...r.hidden].sort() });
}

const cellOfUrl = (url: string): string => url.slice(url.lastIndexOf('/') + 1, -'.json'.length);

export function makeHarness(opts?: {
  mode?: 'auto' | 'manual';
  generate?: SimHostDeps['generate'];
  retryDelaysMs?: readonly number[];
  batchParcels?: number;
  /** Extra or replacement response bodies, keyed by url. */
  bodies?: Record<string, unknown>;
}): Harness {
  const mode = opts?.mode ?? 'auto';
  const sent: SimResponse[] = [];
  const fetches: string[] = [];
  const bodies = new Map<string, unknown>();
  for (const c of FIXTURE_1.manifest.chunks) bodies.set(c.url, FIXTURE_1.chunks[c.cellId]);
  for (const [url, body] of Object.entries(opts?.bodies ?? {})) bodies.set(url, body);
  const records = new Map<string, ParcelRecord>();
  for (const body of bodies.values()) for (const r of decodeParcelChunk(body)) records.set(r.id, r);

  const failures = new Map<string, number>();
  const held = new Map<string, (() => void)[]>();
  let rev = 0;

  const fetch: FetchLike = (url) => {
    fetches.push(url);
    const cellId = cellOfUrl(url);
    const left = failures.get(cellId) ?? 0;
    if (left > 0) {
      failures.set(cellId, left - 1);
      return Promise.resolve<Resp>({ ok: false, status: 500, json: async () => ({}) });
    }
    const body = bodies.get(url);
    const resp: Resp =
      body === undefined
        ? { ok: false, status: 404, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => structuredClone(body) };
    if (mode === 'auto') return Promise.resolve(resp);
    return new Promise<Resp>((resolve) => {
      const list = held.get(cellId) ?? [];
      list.push(() => resolve(resp));
      held.set(cellId, list);
    });
  };

  const host = createSimHost({
    fetch,
    post: (msg) => sent.push(msg),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
    generate: opts?.generate ?? ((p, e) => stubGenerate(p, e)),
    ...(opts?.retryDelaysMs ? { retryDelaysMs: opts.retryDelaysMs } : {}),
    ...(opts?.batchParcels ? { batchParcels: opts.batchParcels } : {})
  });

  const diffs = () => sent.filter((m): m is DiffResponse => m.type === 'diff');
  return {
    host,
    sent,
    fetches,
    records,
    release(cellId) {
      const list = held.get(cellId);
      if (!list?.length) throw new Error(`no held fetch for ${cellId}`);
      held.delete(cellId);
      for (const go of list) go();
    },
    fail(cellId, times) {
      failures.set(cellId, times);
    },
    async flush() {
      // Microtasks only, so it also works under fake timers.
      for (let i = 0; i < 100; i++) await Promise.resolve();
    },
    next: () => ++rev,
    diffs,
    display: () => reconstruct(diffs().map((d) => d.render))
  };
}

function comparable(s: Score) {
  return { ...s, targets: s.targets.map((t) => ({ id: t.target.id, fraction: t.fraction })) };
}

/** (h): every diff's score equals score() over the display reconstructed at that diff. */
export function assertScores(h: Harness): void {
  const ds = h.diffs();
  for (let k = 0; k < ds.length; k++) {
    const r = reconstruct(ds.slice(0, k + 1).map((d) => d.render));
    const entries: [ParcelRecord, GeneratedBuilding][] = [];
    for (const [id, p] of r.parcels) {
      const rec = h.records.get(id);
      if (!rec) throw new Error(`no record for ${id}`);
      const b = stubGenerate(rec, { maxStories: p.stories });
      if (b) entries.push([rec, b]);
    }
    expect(comparable(ds[k].score)).toEqual(comparable(score(entries, M1_TARGETS)));
  }
}
