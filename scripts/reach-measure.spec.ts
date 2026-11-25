// The engine runner (tree-catalogue spec §sec-design-engine): one host over the fixture dataset,
// views kept by document, the queue, the guard and the two sources.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { utcParts } from '../src/lib/fzp/time';
import { fullTree } from '../src/lib/game/catalogue/play';
import { defaultGoal } from '../src/lib/goal/goal';
import { WINDOW_MONTHS } from '../src/lib/sim/timeline-client';
import type { TimelineHostRequest, TimelineHostResponse } from '../src/lib/sim/timeline-protocol';
import { createTimelineHost, type TimelineHostDeps } from '../src/lib/sim/world/host';
import type { ScoreStatics, SeriesChunk } from '../src/lib/sim/world/score/types';
import type { Day } from '../src/lib/timelapse/time';
import { DEFAULT_POLICY4, type SimPolicy4 } from '../src/lib/timeline/policy4';
import { openEngine, versionFetch, type Engine } from './reach-measure';

const FIXTURE = 'e2e/fixtures/data/fixture-0';
/** Enough for one fill of the fixture's window and the full tree's; a hook argument, not a wait. */
const FILL_HOOK_MS = 600_000;

/** Calendar months from `a`'s month to `b`'s. */
function monthsBetween(a: Day, b: Day): number {
  const ay = utcParts(a);
  const by = utcParts(b);
  return (by.y - ay.y) * 12 + (by.m - ay.m);
}

const temps: string[] = [];
const sent = new Map<string, number>();
const sentOf = (type: string) => sent.get(type) ?? 0;

/** `createTimelineHost`, counting the requests handed to it by type. */
const countingHost: typeof createTimelineHost = (deps) => {
  const host = createTimelineHost(deps);
  return {
    handle(req: TimelineHostRequest) {
      sent.set(req.type, sentOf(req.type) + 1);
      host.handle(req);
    },
    dispose: () => host.dispose()
  };
};

let engine: Engine;

beforeAll(async () => {
  engine = await openEngine({ dir: FIXTURE }, { createHost: countingHost });
}, FILL_HOOK_MS);

afterAll(() => {
  engine?.close();
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

describe('openEngine on the fixture', () => {
  it('opens the fixture', async () => {
    expect(engine.datasetVersion).toBe('fixture-0');
    const view = await engine.view(DEFAULT_POLICY4);
    expect(view.filledThrough).toBe(view.lastIndex);
    expect(view.lastIndex + 1).toBe(WINDOW_MONTHS);
  });

  it("full tree homes at least the empty document's", async () => {
    const empty = await engine.view(DEFAULT_POLICY4);
    const full = await engine.view(fullTree(engine.cal).doc);
    expect(sentOf('setPolicy')).toBe(1);
    expect(full).not.toBe(empty);
    expect(full.filledThrough).toBe(full.lastIndex);
    const goal = defaultGoal(engine.asOf);
    const m = monthsBetween(full.months[0], goal.deadline);
    expect(goal.measure.valueAt(full, m)).toBeGreaterThanOrEqual(goal.measure.valueAt(empty, m));
  });

  it('an equal document returns the kept view', async () => {
    const doc = fullTree(engine.cal).doc;
    const first = await engine.view(doc);
    const before = sentOf('setPolicy');
    const again = await engine.view(structuredClone(doc));
    expect(again).toBe(first);
    expect(sentOf('setPolicy')).toBe(before);
  });

  it("the empty document's view is rev 1's", async () => {
    const before = sentOf('setPolicy');
    await engine.view(DEFAULT_POLICY4);
    expect(sentOf('setPolicy')).toBe(before);
  });
});

/** A one-month window's statics and its chunk: enough for `viewOf`. */
const STATICS = {
  asOf: 0,
  months: [0],
  lastIndex: 0,
  baseline: { units: 0, since: 0, provenance: 'stub' },
  tierBaseline: null,
  phasing: null,
  references: [],
  compare: 'plan',
  limits: null,
  debts: null
} as unknown as ScoreStatics;
const CHUNK = {
  from: 0,
  rows: [{ completedNet: 0 }],
  planEffect: [{}],
  money: null,
  tiers: null
} as unknown as SeriesChunk;

type Post = (msg: TimelineHostResponse) => void;

/**
 * A host that fills the open and answers every brush at once; `onSetPolicy` gets the nth
 * `setPolicy` (from 1), its rev, the post and a `fill` of that rev at once.
 */
function stubHost(
  onSetPolicy: (n: number, rev: number, post: Post, fill: (rev: number) => void) => void
): typeof createTimelineHost {
  return (deps: TimelineHostDeps) => {
    const post = (msg: TimelineHostResponse) => deps.post(msg, []);
    const fill = (rev: number) => {
      post({
        type: 'compiled',
        rev,
        capacity: {} as never,
        unknownLots: 0,
        statics: STATICS
      });
      if (rev > 1) post({ type: 'refill', rev, from: 0 });
      post({ type: 'filled', rev, through: 0, series: CHUNK });
    };
    let n = 0;
    return {
      handle(req: TimelineHostRequest) {
        if (req.type === 'openTimeline') fill(req.rev);
        else if (req.type === 'resolveBrush') {
          post({
            type: 'brushLots',
            reqId: req.reqId,
            result: { ok: true, lots: [], points: new Float64Array() }
          });
        } else if (req.type === 'setPolicy') {
          n += 1;
          onSetPolicy(n, req.rev, post, fill);
        }
      },
      dispose() {}
    };
  };
}

/** Two documents that differ from each other and from the empty one: the full tree, and it less its zoning. */
function twoDocs(e: Engine): [SimPolicy4, SimPolicy4] {
  const full = fullTree(e.cal).doc;
  return [full, { ...full, kinds: { ...full.kinds, zoning: [] } }];
}

describe('the queue and its guard', () => {
  it('a timeout rejects and the queue goes on', async () => {
    let setPolicies = 0;
    const stub = await openEngine(
      { dir: FIXTURE },
      {
        timeoutMs: 50,
        createHost: stubHost((n, rev, _post, fill) => {
          setPolicies = n;
          if (n > 1) fill(rev);
        })
      }
    );
    try {
      const [a, b] = twoDocs(stub);
      const first = stub.view(a).then(
        () => null,
        (e: unknown) => e
      );
      const second = stub.view(b);
      const err = await first;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message.startsWith('window not filled in')).toBe(true);
      const view = await second;
      expect(view.filledThrough).toBe(view.lastIndex);
      expect(setPolicies).toBe(2);
    } finally {
      stub.close();
    }
  });

  it('a host error rejects the pending call', async () => {
    const stub = await openEngine(
      { dir: FIXTURE },
      {
        createHost: stubHost((_n, rev, post) =>
          post({ type: 'error', rev, code: 'x' as never, message: 'y' })
        )
      }
    );
    try {
      const err = await stub.view(twoDocs(stub)[0]).then(
        () => null,
        (e: unknown) => e
      );
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe('host error: x: y');
    } finally {
      stub.close();
    }
  });
});

describe('sources', () => {
  it('version source answers a failed fetch as 404', async () => {
    const calls: string[] = [];
    const fakeFetch = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/throws.json')) throw new Error('offline');
      if (url.endsWith('/broken.json')) return new Response('no', { status: 500 });
      return new Response('{"a":1}', { status: 200 });
    }) as typeof fetch;
    const src = versionFetch('v', 'https://o', fakeFetch);
    const thrown = await src.fetch('/data/v/throws.json');
    expect({ ok: thrown.ok, status: thrown.status }).toEqual({ ok: false, status: 404 });
    const broken = await src.fetchBytes('/data/v/broken.json');
    expect({ ok: broken.ok, status: broken.status }).toEqual({ ok: false, status: 404 });
    const one = await src.fetch('/data/v/good.json');
    expect(one.ok).toBe(true);
    expect(await one.json()).toEqual({ a: 1 });
    const two = await src.fetchBytes('/data/v/good.json');
    expect(two.ok).toBe(true);
    expect(new TextDecoder().decode(await two.arrayBuffer())).toBe('{"a":1}');
    expect(calls.filter((u) => u === 'https://o/data/v/good.json')).toHaveLength(1);
    expect(calls).toContain('https://o/data/v/throws.json');
  });

  it('no dataset at a directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reach-'));
    temps.push(dir);
    const err = await openEngine({ dir }).then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('no dataset at');
  });
});
