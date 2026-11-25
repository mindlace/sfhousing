// The engine runner: one host over the fixture dataset, views kept by document, the queue, the
// guard and the two sources.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WINDOW_MONTHS } from '../../src/lib/sim/timeline-client';
import type {
  TimelineHostRequest,
  TimelineHostResponse
} from '../../src/lib/sim/timeline-protocol';
import { createTimelineHost, type TimelineHostDeps } from '../../src/lib/sim/world/host';
import type { ScoreStatics, SeriesChunk } from '../../src/lib/sim/world/score/types';
import { addPolicy, type AddChoice } from '../../src/lib/timeline/add';
import { DEFAULT_POLICY4, queriesOf4, type SimPolicy4 } from '../../src/lib/timeline/policy4';
import {
  DEFAULT_ORIGIN,
  openEngine,
  parseSourceArgs,
  versionFetch,
  type Engine
} from './engine-runner';

const FIXTURE = 'e2e/fixtures/data/fixture-0';
/** Enough for one fill of the fixture's window; a hook argument, not a wait. */
const FILL_HOOK_MS = 600_000;

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

  it('an equal document returns the kept view', async () => {
    const doc = twoDocs(engine)[0];
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

  it('a different document is sent and filled', async () => {
    const empty = await engine.view(DEFAULT_POLICY4);
    const before = sentOf('setPolicy');
    const doc = twoDocs(engine)[1];
    const other = await engine.view(doc);
    expect(other).not.toBe(empty);
    expect(other.filledThrough).toBe(other.lastIndex);
    expect(sentOf('setPolicy')).toBe(before + 1);
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
 * `setPolicy` (from 1), its rev, the post and a `fill` of that rev at once; `onBrush`, when
 * given, sees each `resolveBrush` with the count of `setPolicy`s so far before it is answered.
 */
function stubHost(
  onSetPolicy: (n: number, rev: number, post: Post, fill: (rev: number) => void) => void,
  onBrush?: (setPolicies: number, post: Post) => void
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
          onBrush?.(n, post);
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

  it("a timed-out call's late error does not reject the next call", async () => {
    let brushes = 0;
    const stub = await openEngine(
      { dir: FIXTURE },
      {
        timeoutMs: 50,
        createHost: stubHost(
          (n, rev, _post, fill) => {
            if (n > 1) fill(rev);
          },
          (setPolicies, post) => {
            if (setPolicies !== 1) return;
            brushes += 1;
            // rev 2 is the first call's, abandoned by its guard; it errors late
            post({ type: 'error', rev: 2, code: 'timeline', message: 'late' });
          }
        )
      }
    );
    try {
      const [full, noZoning] = twoDocs(stub);
      // the first call has no lots to resolve; the second resolves its zoning's lots
      expect(queriesOf4(noZoning)).toHaveLength(0);
      expect(queriesOf4(full).length).toBeGreaterThan(0);
      const first = stub.view(noZoning).then(
        () => null,
        (e: unknown) => e
      );
      const second = stub.view(full);
      const err = await first;
      expect((err as Error).message.startsWith('window not filled in')).toBe(true);
      const view = await second;
      expect(view.filledThrough).toBe(view.lastIndex);
      expect(brushes).toBeGreaterThan(0);
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
    const dir = mkdtempSync(join(tmpdir(), 'engine-'));
    temps.push(dir);
    const err = await openEngine({ dir }).then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('no dataset at');
  });
});

describe('parseSourceArgs', () => {
  const flags = { write: 'bool', amount: 'value' } as const;

  it('refusals', () => {
    for (const argv of [
      ['--bogus', 'd'],
      ['a', 'b'],
      ['d', '--version', 'v'],
      ['--version'],
      ['d', '--amount'],
      ['d', '--write', '--write'],
      [],
      ['--from', 'https://o']
    ]) {
      expect(parseSourceArgs(argv, flags), argv.join(' ')).toHaveProperty('error');
    }
  });

  it('sources and flags', () => {
    expect(parseSourceArgs(['--version', 'v'], flags)).toEqual({
      src: { version: 'v', origin: DEFAULT_ORIGIN },
      flags: {}
    });
    expect(parseSourceArgs(['--version', 'v', '--from', 'https://o'], flags)).toEqual({
      src: { version: 'v', origin: 'https://o' },
      flags: {}
    });
    expect(parseSourceArgs(['d', '--write'], flags)).toEqual({
      src: { dir: 'd' },
      flags: { write: true }
    });
    expect(parseSourceArgs(['--amount', '5', 'd'], flags)).toEqual({
      src: { dir: 'd' },
      flags: { amount: '5' }
    });
  });
});

/** Two documents that differ from each other and from the empty one: the first has lots to resolve. */
function twoDocs(e: Engine): [SimPolicy4, SimPolicy4] {
  const ctx = { w: { asOf: e.asOf, months: WINDOW_MONTHS }, month: 1, cal: e.cal };
  const add = (choice: AddChoice) => addPolicy(DEFAULT_POLICY4, choice, ctx).doc;
  return [add({ kind: 'zoning', what: 'transit' }), add({ kind: 'zoning', what: 'paint' })];
}
