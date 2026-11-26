// The engine runner (tree-catalogue spec §sec-design-engine): one host over the fixture dataset,
// views kept by document, the queue, the guard and the two sources.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatShortMonthYear } from '../src/lib/fzp/format';
import { utcParts } from '../src/lib/fzp/time';
import { fullTree } from '../src/lib/game/catalogue/play';
import { defaultGoal, readGoal, TODAY } from '../src/lib/goal/goal';
import { WINDOW_MONTHS } from '../src/lib/sim/timeline-client';
import type { TimelineHostRequest, TimelineHostResponse } from '../src/lib/sim/timeline-protocol';
import { createTimelineHost, type TimelineHostDeps } from '../src/lib/sim/world/host';
import type { ScoreStatics, SeriesChunk } from '../src/lib/sim/world/score/types';
import type { Day } from '../src/lib/timelapse/time';
import { DEFAULT_POLICY4, type SimPolicy4 } from '../src/lib/timeline/policy4';
import {
  DEFAULT_ORIGIN,
  LADDER_FILE,
  ladderFile,
  ladderYears,
  measureReach,
  openEngine,
  parseReachArgs,
  runReach,
  versionFetch,
  type Engine
} from './reach-measure';

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
const carsSeen: (string | undefined)[] = [];
const countingHost: typeof createTimelineHost = (deps) => {
  carsSeen.push(deps.cars);
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

  it('the host gets cars on by default', () => {
    expect(carsSeen).toEqual(['on']);
  });

  it(
    'the host gets cars off when asked',
    async () => {
      const before = carsSeen.length;
      const off = await openEngine({ dir: FIXTURE }, { createHost: countingHost, cars: 'off' });
      off.close();
      expect(carsSeen.slice(before)).toEqual(['off']);
    },
    FILL_HOOK_MS
  );

  it('the opening fill took some time', () => {
    expect(engine.fillMs).toBeGreaterThan(0);
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

describe('the ladder', () => {
  it('ladderYears', () => {
    expect(ladderYears(2066, 2043)).toEqual([2060, 2055, 2050, 2045]);
    expect(ladderYears(2066, 2031)).toEqual([2060, 2050, 2045, 2035]);
    expect(ladderYears(2065, 2050)).toEqual([2060, 2055, 2050]);
    expect(ladderYears(2066, 2061)).toEqual([]);
  });

  it('ladderFile names the dataset, both months, and exports the years', () => {
    const reachedOn = Date.UTC(2043, 2, 1) / 86_400_000;
    const deadline = Date.UTC(2066, 8, 30) / 86_400_000;
    const t = ladderFile({ datasetVersion: 'd-1', reachedOn, deadline, years: [2060, 2055] });
    expect(t).toContain('d-1');
    expect(t).toContain(formatShortMonthYear(reachedOn));
    expect(t).toContain(formatShortMonthYear(deadline));
    expect(t).toContain('export const LADDER_YEARS: readonly number[] = [2060, 2055];');
  });
});

describe('parseReachArgs', () => {
  it('refusals', () => {
    for (const argv of [
      ['--bogus', 'd'],
      ['a', 'b'],
      ['d', '--version', 'v'],
      ['d', '--amount', '0'],
      ['d', '--amount', 'x'],
      ['d', '--write', '--amount', '5'],
      [],
      ['--from', 'https://o'],
      ['d', '--amount']
    ]) {
      expect(parseReachArgs(argv), argv.join(' ')).toHaveProperty('error');
    }
  });

  it('sources and flags', () => {
    expect(parseReachArgs(['--version', 'v'])).toEqual({
      src: { version: 'v', origin: DEFAULT_ORIGIN },
      write: false
    });
    expect(parseReachArgs(['--version', 'v', '--from', 'https://o'])).toEqual({
      src: { version: 'v', origin: 'https://o' },
      write: false
    });
    expect(parseReachArgs(['d', '--write'])).toEqual({ src: { dir: 'd' }, write: true });
    expect(parseReachArgs(['--amount', '5', 'd'])).toEqual({
      src: { dir: 'd' },
      write: false,
      amount: 5
    });
  });
});

/** An `open` that answers with `e`, its `close` a no-op so the shared engine stays open. */
const openWith =
  (e: Pick<Engine, 'datasetVersion' | 'asOf' | 'cal' | 'view' | 'fillMs'>): typeof openEngine =>
  async () => ({ ...e, close: () => {} });

/** The command's io, recording what it prints and writes. */
function recordingIo(open: typeof openEngine) {
  const out: string[] = [];
  const err: string[] = [];
  const writes: { path: string; text: string }[] = [];
  return {
    out,
    err,
    writes,
    io: {
      open,
      out: (l: string) => out.push(l),
      err: (l: string) => err.push(l),
      writeFile: (path: string, text: string) => writes.push({ path, text })
    }
  };
}

describe('runReach', () => {
  const SRC = { dir: FIXTURE };

  it('No earlier deadline', async () => {
    const fixtureEmpty = await engine.view(DEFAULT_POLICY4);
    const goal = defaultGoal(engine.asOf);
    const offset = monthsBetween(fixtureEmpty.months[0], goal.deadline);
    const d = offset < 0 ? TODAY : Math.min(offset, fixtureEmpty.lastIndex);
    // The fixture's empty view levels off years before the deadline; one more home from the
    // deadline's month on makes the deadline's value first reached in that month.
    const empty = {
      ...fixtureEmpty,
      rows: fixtureEmpty.rows.map((r, i) =>
        i >= d ? { ...r, completedNet: r.completedNet + 1 } : r
      )
    };
    const amount = goal.measure.valueAt(empty, d);
    const endYear = utcParts(goal.deadline).y;
    // precondition: at that amount the goal is reached in the window's end year
    const reading = readGoal({ ...goal, amount }, empty, empty.lastIndex);
    expect(reading?.reachedOn).not.toBeNull();
    expect(utcParts(reading!.reachedOn!).y).toBe(endYear);

    const rec = recordingIo(
      openWith({
        datasetVersion: engine.datasetVersion,
        asOf: engine.asOf,
        cal: engine.cal,
        fillMs: engine.fillMs,
        view: async () => empty
      })
    );
    const code = await runReach({ src: SRC, write: true, amount }, rec.io);
    expect(code).toBe(1);
    expect(rec.writes).toEqual([]);
    expect(
      rec.out.filter((l) =>
        l.startsWith('No earlier deadline: the full tree reaches the goal after Dec ')
      )
    ).toHaveLength(1);
    expect(rec.out.some((l) => l.startsWith('LADDER_YEARS'))).toBe(false);
  });

  it('fixture amount 1', async () => {
    const rec = recordingIo(openWith(engine));
    const code = await runReach({ src: SRC, write: false, amount: 1 }, rec.io);
    expect(code).toBe(0);
    expect(rec.out).toHaveLength(5);
    const [dataset, tree, ends, goalLine, ladder] = rec.out;
    expect(dataset).toBe('Dataset fixture-0');
    expect(tree.startsWith('Full tree: ')).toBe(true);
    expect(tree.endsWith('money)')).toBe(true);
    expect(ends).toMatch(/^Window ends [A-Z][a-z]{2} \d{4}$/);
    expect(goalLine.startsWith('Goal: 1 homes, reached ')).toBe(true);
    expect(ladder.startsWith('LADDER_YEARS = [')).toBe(true);
    expect(rec.writes).toEqual([]);
    expect(rec.err).toEqual([]);
  });

  it('fixture unreachable amount', async () => {
    const rec = recordingIo(openWith(engine));
    const code = await runReach(
      { src: SRC, write: false, amount: Number.MAX_SAFE_INTEGER },
      rec.io
    );
    expect(code).toBe(1);
    expect(rec.out.some((l) => l.startsWith('Goal: ') && l.includes('missed: '))).toBe(true);
    expect(rec.out.some((l) => l.startsWith('LADDER_YEARS'))).toBe(false);
    expect(rec.writes).toEqual([]);
  });

  it("write path is the script's repository", async () => {
    expect(isAbsolute(LADDER_FILE)).toBe(true);
    expect(LADDER_FILE.endsWith(join('src', 'lib', 'game', 'catalogue', 'ladder-years.ts'))).toBe(
      true
    );
    const here = dirname(fileURLToPath(import.meta.url));
    expect(LADDER_FILE).toBe(resolve(here, '../src/lib/game/catalogue/ladder-years.ts'));

    const empty = await engine.view(DEFAULT_POLICY4);
    const stub = {
      datasetVersion: engine.datasetVersion,
      asOf: engine.asOf,
      cal: engine.cal,
      fillMs: engine.fillMs,
      view: async () => empty
    };
    const r = await measureReach({ ...stub, close: () => {} }, 1);
    expect(r.years?.length).toBeGreaterThan(0);
    const rec = recordingIo(openWith(stub));
    const code = await runReach({ src: SRC, write: true, amount: 1 }, rec.io);
    expect(code).toBe(0);
    expect(rec.writes).toEqual([
      {
        path: LADDER_FILE,
        text: ladderFile({
          datasetVersion: r.datasetVersion,
          reachedOn: r.reachedOn!,
          deadline: r.deadline,
          years: r.years!
        })
      }
    ]);
    expect(rec.out.at(-1)).toBe('Wrote src/lib/game/catalogue/ladder-years.ts');
  });

  it('exit 2 on a source that cannot open', async () => {
    const rec = recordingIo(async () => {
      throw new Error('no dataset at x');
    });
    const code = await runReach({ src: { dir: 'x' }, write: false }, rec.io);
    expect(code).toBe(2);
    expect(rec.err).toEqual(['reach-measure: no dataset at x']);
    expect(rec.out).toEqual([]);
  });

  it('closes the engine', async () => {
    let closed = 0;
    const empty = await engine.view(DEFAULT_POLICY4);
    const open: typeof openEngine = async () => ({
      datasetVersion: engine.datasetVersion,
      asOf: engine.asOf,
      cal: engine.cal,
      fillMs: engine.fillMs,
      view: async () => empty,
      close: () => {
        closed += 1;
      }
    });
    await runReach({ src: SRC, write: false, amount: 1 }, recordingIo(open).io);
    expect(closed).toBe(1);
  });
});
