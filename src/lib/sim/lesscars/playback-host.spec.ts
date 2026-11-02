// The playback host against fixture-0's own files, served from disk by a fake fetch, with a
// fake clock and timers (the scenario-host harness pattern) and the real generator.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { idsHash, inflateRawBody } from '$lib/data/column-file';
import {
  LESSCARS_FORMAT,
  decodeTimelinePayload,
  encodeTimelinePayload,
  parsePlanFile,
  parseSitesFile,
  type InitiativeBuild,
  type LessCarsPlanFile,
  type LessCarsTimeline
} from '$lib/data/lesscars/codec';
import { LESSCARS_HORIZON } from '$lib/data/lesscars/schedule';
import type { Manifest } from '$lib/data/manifest';
import type { BBox } from '$lib/plan';
import type { ParcelId } from '$lib/data/parcel';
import { readScenarioParcels, type ScenarioParcels } from '$lib/data/scenario-codec';
import type { TimedPackedCell, TimelineUpdate } from '$lib/map/types';
import type { Day } from '$lib/timelapse/time';
import type { ScenarioResponse } from '../scenario/types';
import { SITES_CELL } from './builds';
import { createPlaybackHost, type PlaybackHostDeps } from './playback-host';
import type { PlaybackCard, PlaybackResponse } from './types';

const ROOT = join(process.cwd(), 'e2e/fixtures/data/fixture-0');
const VERSION = 'fixture-0';
const PREFIX = `/data/${VERSION}/`;
const file = (url: string) => join(ROOT, url.slice(PREFIX.length));
const readJson = (url: string): unknown => JSON.parse(readFileSync(file(url), 'utf8'));

const fixtureManifest = readJson(`${PREFIX}manifest.json`) as Manifest;
const LC = fixtureManifest.scenarios!.lesscars!;
const FZP = fixtureManifest.scenarios!.fzp!;
const fixturePlan = parsePlanFile(readJson(LC.plan));
const fixtureSites = parseSitesFile(readJson(LC.sites));
const timelineBin = new Uint8Array(readFileSync(file(LC.timeline)));
let fixtureParcels: ScenarioParcels;
let fixtureTimeline: LessCarsTimeline;

const fixtureBBox = (() => {
  const b: BBox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const c of fixtureManifest.chunks) {
    b[0] = Math.min(b[0], c.bbox[0]);
    b[1] = Math.min(b[1], c.bbox[1]);
    b[2] = Math.max(b[2], c.bbox[2]);
    b[3] = Math.max(b[3], c.bbox[3]);
  }
  return b;
})();

/** The parcels the plan names: parking conversions and edge garages on a parcel. */
function planParcels(f: LessCarsPlanFile): ParcelId[] {
  const out: ParcelId[] = [];
  for (const p of f.plan.projects) {
    if (p.kind === 'parking-conversion') out.push(p.parcel);
    if (p.kind === 'edge-garage' && 'parcel' in p.site) out.push(p.site.parcel);
  }
  return out;
}
const projectOf = (kind: string) => fixturePlan.plan.projects.find((p) => p.kind === kind)!;
const P = (() => {
  const p = projectOf('parking-conversion');
  return p.kind === 'parking-conversion' ? p.parcel : '';
})();
const G = (() => {
  const p = projectOf('edge-garage');
  return p.kind === 'edge-garage' && 'parcel' in p.site ? p.site.parcel : '';
})();
const planTimes = (id: string) => fixturePlan.times.find((t) => t.id === id)!;

beforeAll(async () => {
  fixtureParcels = await readScenarioParcels(new Uint8Array(readFileSync(file(FZP.parcels))));
  fixtureTimeline = decodeTimelinePayload(inflateRawSync(timelineBin), fixtureParcels);
});

/** A hand-built timeline on fixture-0's parcels.bin, deflated as timeline.bin. */
function handBuilt(o: { parkingKept?: boolean; garageKept?: boolean }): Uint8Array {
  const ids = fixtureParcels.id;
  const builds: InitiativeBuild[] = [];
  const reservations: { row: number; kept: boolean }[] = [];
  if (o.parkingKept !== undefined) {
    const r = fixtureParcels.index.get(P)!;
    const t = planTimes(projectOf('parking-conversion').id).build!;
    if (o.parkingKept) {
      builds.push({
        siteId: P,
        projectId: projectOf('parking-conversion').id,
        parcelRow: r,
        units: 12,
        stories: 4,
        existing: 0,
        startDay: t.startDay,
        completeDay: t.completeDay
      });
    }
    reservations.push({ row: r, kept: o.parkingKept });
  }
  if (o.garageKept !== undefined)
    reservations.push({ row: fixtureParcels.index.get(G)!, kept: o.garageKept });
  reservations.sort((a, b) => a.row - b.row);
  const t: LessCarsTimeline = {
    format: LESSCARS_FORMAT,
    datasetVersion: VERSION,
    count: ids.length,
    idsHash: idsHash(ids),
    seed: 7,
    schedules: [],
    builds,
    reservations
  };
  return new Uint8Array(deflateRawSync(encodeTimelinePayload(t, ids)));
}

type Posted = PlaybackResponse | ScenarioResponse;
type Of<T extends Posted['type']> = Extract<Posted, { type: T }>;

function harness(
  opts: {
    timeline?: Uint8Array;
    timelineBytes?: Uint8Array;
    dropTimeline?: boolean;
    noTimelineBody?: boolean;
    planVersion?: string;
  } = {}
) {
  const posts: Posted[] = [];
  const warnings: string[] = [];
  let clock = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const running = new Set<Promise<unknown>>();
  const track = <T>(p: Promise<T>): Promise<T> => {
    const done = p.then(
      () => undefined,
      () => undefined
    );
    running.add(done);
    void done.then(() => running.delete(done));
    return p;
  };
  const body = (url: string): Uint8Array | undefined => {
    if (url === LC.timeline) {
      if (opts.noTimelineBody) return undefined;
      return opts.timelineBytes ?? opts.timeline ?? timelineBin;
    }
    try {
      return new Uint8Array(readFileSync(file(url)));
    } catch {
      return undefined;
    }
  };
  const deps: PlaybackHostDeps = {
    fetch: async (url) => {
      const b = body(url);
      return b === undefined
        ? { ok: false, status: 404, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => JSON.parse(new TextDecoder().decode(b)) };
    },
    fetchBytes: async (url) => {
      const b = body(url);
      return b === undefined
        ? { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }
        : { ok: true, status: 200, arrayBuffer: async () => b.slice().buffer };
    },
    post: (msg) => posts.push(msg),
    setTimeout: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { at: clock + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout: (h) => {
      timers.delete(h as number);
    },
    now: () => clock,
    warn: (msg) => warnings.push(msg),
    retryDelaysMs: [],
    decodeParcels: (bytes) => track(readScenarioParcels(bytes)),
    inflate: (bytes) => track(inflateRawBody(bytes))
  };
  const host = createPlaybackHost(deps);
  const turn = () => new Promise<void>((r) => setImmediate(r));
  async function flush(): Promise<void> {
    for (let round = 0; round < 10_000; round++) {
      await turn();
      await turn();
      if (running.size === 0) return;
      await Promise.all(running);
    }
    throw new Error('flush: decodes never settled');
  }
  async function settle(): Promise<void> {
    await flush();
    for (let k = 0; k < 10_000; k++) {
      let best: [number, { at: number; fn: () => void }] | null = null;
      for (const e of timers)
        if (!best || e[1].at < best[1].at || (e[1].at === best[1].at && e[0] < best[0])) best = e;
      if (!best) return;
      timers.delete(best[0]);
      clock = Math.max(clock, best[1].at);
      best[1].fn();
      await flush();
    }
    throw new Error('settle: timers never drained');
  }
  const manifest = (): Manifest => {
    const m = structuredClone(fixtureManifest);
    if (opts.dropTimeline) {
      const lc = { ...m.scenarios!.lesscars! } as Partial<typeof LC>;
      delete lc.timeline;
      m.scenarios = { ...m.scenarios!, lesscars: lc as typeof LC };
    }
    return m;
  };
  let rev = 0;
  let reqId = 0;
  const posted = <T extends Posted['type']>(type: T): Of<T>[] =>
    posts.filter((m): m is Of<T> => m.type === type);
  const h = {
    posts,
    warnings,
    settle,
    posted,
    init() {
      host.handle({
        type: 'initPlayback',
        rev: ++rev,
        manifest: manifest(),
        plan: { ...fixturePlan, datasetVersion: opts.planVersion ?? fixturePlan.datasetVersion },
        sites: fixtureSites
      });
    },
    async initAndSettle() {
      h.init();
      await settle();
      return h;
    },
    prefetch(bbox: BBox) {
      host.handle({ type: 'prefetch', bbox });
    },
    revision0(): TimelineUpdate {
      return posted('playback').find((p) => p.render.revision === 0)!.render;
    },
    allCells(): TimedPackedCell[] {
      return posted('playback').flatMap((p) => p.render.cells);
    },
    card(projectId: string, day: Day): PlaybackCard | null {
      const id = ++reqId;
      host.handle({ type: 'playbackCard', reqId: id, projectId, day });
      return posted('playbackCard').find((c) => c.reqId === id)!.card;
    },
    dispose: () => host.dispose()
  };
  return h;
}

const slotIds = (cells: TimedPackedCell[]) => cells.flatMap((c) => c.slotProjectIds);

describe('playback host', () => {
  it('initPlayback posts ready, playbackLoaded with places and reservations, then revision 0', async () => {
    const h = await harness().initAndSettle();
    expect(h.posted('error')).toEqual([]);
    expect(h.posted('ready')).toHaveLength(1);
    expect(h.posts[0].type).toBe('ready');
    const loaded = h.posted('playbackLoaded')[0];
    expect(loaded.seed).toBe(fixtureTimeline.seed);
    expect(loaded.reservations).toEqual(
      fixtureTimeline.reservations.map((r) => ({
        parcelId: fixtureParcels.id[r.row],
        kept: r.kept
      }))
    );
    expect(Object.keys(loaded.places).sort()).toEqual(planParcels(fixturePlan).sort());
    const i = fixtureParcels.index.get(G)!;
    expect(loaded.places[G]).toEqual([
      fixtureParcels.labelPoint[2 * i],
      fixtureParcels.labelPoint[2 * i + 1]
    ]);
    const r0 = h.posted('playback')[0].render;
    expect(r0.revision).toBe(0);
    expect(r0.cells.map((c) => c.cellId)).toContain(SITES_CELL);
    expect(h.posts.indexOf(loaded)).toBeLessThan(h.posts.indexOf(h.posted('playback')[0]));
  });

  it('the sites cell holds one slot per freed build', async () => {
    const h = await harness().initAndSettle();
    const cell = h.revision0().cells.find((c) => c.cellId === SITES_CELL)!;
    expect(cell.slotProjectIds).toEqual(
      fixtureTimeline.builds
        .filter((x) => x.parcelRow === null)
        .map((x) => `lc-build:${x.siteId}`)
        .sort()
    );
    expect(cell.slotProjectIds.length).toBeGreaterThan(0);
  });

  it('chunk cells pack after prefetch, one revision per slice, demolish only in revision 0', async () => {
    const h = await harness().initAndSettle();
    h.prefetch(fixtureBBox);
    await h.settle();
    const all = h.posted('playback');
    const later = all.slice(1);
    expect(later.length).toBeGreaterThan(0);
    expect(all.map((p) => p.render.revision)).toEqual(all.map((_, k) => k));
    expect(later.every((p) => p.render.demolish.length === 0)).toBe(true);
    expect(later.at(-1)!.complete).toBe(true);
    // every market schedule anchored in a loaded cell is drawn
    const drawn = new Set(slotIds(h.allCells()));
    const market = fixtureTimeline.schedules.filter((s) =>
      s.parcelIds.some((id) => fixtureParcels.index.has(id))
    );
    expect(market.length).toBeGreaterThan(0);
    for (const s of market) expect(drawn.has(s.projectId)).toBe(true);
  });

  it('a prefetch before the load still lands its cells in revision 0', async () => {
    const h = harness();
    h.init();
    h.prefetch(fixtureBBox);
    await h.settle();
    const r0 = h.revision0();
    expect(r0.cells.length).toBeGreaterThan(1);
    expect(h.posted('playback').at(-1)!.complete).toBe(true);
  });

  it('a kept parking build is drawn and its lot demolished at the conversion start; a voided one is not', async () => {
    const kept = harness({ timeline: handBuilt({ parkingKept: true }) });
    const voided = harness({ timeline: handBuilt({ parkingKept: false }) });
    for (const x of [kept, voided]) {
      x.init();
      x.prefetch(fixtureBBox);
      await x.settle();
      expect(x.posted('error')).toEqual([]);
    }
    const conversion = projectOf('parking-conversion').id;
    expect(slotIds(kept.allCells())).toContain(`lc-build:${P}`);
    expect(kept.revision0().demolish).toContainEqual({
      parcelId: P,
      day: planTimes(conversion).startDay
    });
    expect(kept.card(`lc-build:${P}`, LESSCARS_HORIZON)).toMatchObject({
      kind: 'parking',
      planLabel: projectOf('parking-conversion').label,
      units: 12,
      stories: 4,
      status: 'complete'
    });
    expect(slotIds(voided.allCells())).not.toContain(`lc-build:${P}`);
    expect(voided.revision0().demolish.map((d) => d.parcelId)).not.toContain(P);
    expect(voided.posted('playbackLoaded')[0].reservations).toEqual([{ parcelId: P, kept: false }]);
    expect(voided.card(`lc-build:${P}`, LESSCARS_HORIZON)).toBeNull();
  });

  it('a kept garage-parcel reservation is reported but demolishes nothing', async () => {
    const g = harness({ timeline: handBuilt({ garageKept: true }) });
    g.init();
    await g.settle();
    expect(g.posted('playbackLoaded')[0].reservations).toEqual([{ parcelId: G, kept: true }]);
    expect(g.revision0().demolish.map((d) => d.parcelId)).not.toContain(G);
    // no freed builds: no sites cell
    expect(g.revision0().cells.map((c) => c.cellId)).not.toContain(SITES_CELL);
  });

  it('playbackCard answers a freed build and null for an unknown id', async () => {
    const h = harness();
    expect(h.card('lc-build:lc:hwy:1', LESSCARS_HORIZON)).toBeNull(); // no session yet
    await h.initAndSettle();
    expect(h.card('lc-build:lc:hwy:1', LESSCARS_HORIZON)).toMatchObject({
      kind: 'freed',
      where: 'lc:hwy:1',
      planLabel: fixturePlan.plan.projects.find((p) => p.id === 'hwy')!.label,
      status: 'complete'
    });
    expect(h.card('nope', LESSCARS_HORIZON)).toBeNull();
    const m = fixtureTimeline.schedules.find((x) => x.end.kind === 'complete')!;
    expect(h.card(m.projectId, LESSCARS_HORIZON)).toMatchObject({
      kind: 'market',
      planLabel: null,
      status: 'complete'
    });
  });

  it('errors: no lesscars scenario, a mismatched plan, a corrupt timeline', async () => {
    const missing = await harness({ dropTimeline: true }).initAndSettle();
    expect(missing.posted('error')[0].code).toBe('scenario-missing');
    expect(missing.posted('ready')).toEqual([]);
    expect((await harness({ planVersion: 'x' }).initAndSettle()).posted('error')[0].code).toBe(
      'bad-request'
    );
    const corrupt = await harness({ timelineBytes: new Uint8Array([1, 2]) }).initAndSettle();
    expect(corrupt.posted('error')[0]).toMatchObject({ code: 'scenario-invalid', rev: 1 });
    expect(corrupt.posted('error')[0].message).toMatch(/^timeline\.bin: /);
    expect(corrupt.posted('playbackLoaded')).toEqual([]);
    const absent = await harness({ noTimelineBody: true }).initAndSettle();
    expect(absent.posted('error')).toEqual([
      expect.objectContaining({ code: 'internal', message: expect.stringMatching(/timeline\.bin/) })
    ]);
    expect(absent.posted('playbackLoaded')).toEqual([]);
  });

  it('a second initPlayback supersedes the first: nothing more from the old session', async () => {
    const h = harness();
    h.init();
    h.init();
    h.prefetch(fixtureBBox);
    await h.settle();
    expect(h.posted('playback').length).toBeGreaterThan(0);
    expect(new Set(h.posted('playback').map((p) => p.rev))).toEqual(new Set([2]));
    expect(h.posted('playbackLoaded').map((p) => p.rev)).toEqual([2]);
  });

  it('dispose stops the session: no more posts', async () => {
    const h = harness();
    h.init();
    h.dispose();
    await h.settle();
    expect(h.posts.map((p) => p.type)).toEqual(['ready']);
  });
});
