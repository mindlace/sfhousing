import type { PrototypeId } from '../finance/prototypes';
import type { Day } from '$lib/timelapse/time';
import type { ProjectKind } from '$lib/timelapse/types';
import type { Award } from './funding';

/** One application waiting in the line (spec 4.6). */
export interface App {
  lot: number;
  kind: ProjectKind;
  applied: Day;
  /** the line key (`lineKey`, spec 4.4); applications compare `applied` first, then this */
  key: number;
  bundle: number[];
  bundleKey: string;
  protoId: PrototypeId;
  units: number;
  level: number;
  view: number;
  f: number;
  stories: number;
  keyDay: Day;
  /** internal: the order the line received it */
  seq: number;
}

/** The award rule for a group (kind, bundle, prototype) at a size, against the money now. */
export type AwardTest = (
  g: { kind: ProjectKind; bundle: readonly number[]; protoId: PrototypeId },
  units: number
) => Award | null;

export interface Line {
  readonly size: number;
  /** requires non-decreasing (applied, key); throws otherwise */
  add(app: App): void;
  remove(app: App): void;
  regroup(app: App): void;
  /** the waiting applications in key order */
  apps(): App[];
  /**
   * One pass; `take` removes the awarded application (and its lot's other one). Returns awards.
   * `keep`: no pool's money has changed since the end of the last pass except by its own awards,
   * so a group's largest passing size found then still holds if the group gained no member and no
   * member's size changed (the grouped line keeps it; the scan ignores `keep`).
   */
  serve(test: AwardTest, take: (app: App, a: Award) => void, keep?: boolean): number;
}

/** The definition of serving (spec 4.6): one scan in key order. */
export function scanLine(): Line {
  let items: (App | null)[] = [];
  const at = new Map<App, number>();
  let dead = 0;
  let last: App | null = null;
  let seq = 0;

  function compact(): void {
    if (dead * 2 <= items.length) return;
    const next: App[] = [];
    for (const a of items) if (a) next.push(a);
    items = next;
    at.clear();
    items.forEach((a, i) => at.set(a as App, i));
    dead = 0;
  }

  return {
    get size() {
      return at.size;
    },
    add(app) {
      if (
        last &&
        (app.applied < last.applied || (app.applied === last.applied && app.key < last.key))
      )
        throw new RangeError('line.add: applications must arrive in (applied, key) order');
      app.seq = seq++;
      last = app;
      at.set(app, items.length);
      items.push(app);
    },
    remove(app) {
      const i = at.get(app);
      if (i === undefined) return;
      items[i] = null;
      at.delete(app);
      dead++;
    },
    regroup() {
      // a scan keeps no groups; the order is unchanged
    },
    apps() {
      return items.filter((a): a is App => a !== null);
    },
    serve(test, take) {
      let n = 0;
      // `take` may remove entries (set to null) but never reorders or compacts during the pass
      for (let i = 0; i < items.length; i++) {
        const a = items[i];
        if (!a) continue;
        const award = test({ kind: a.kind, bundle: a.bundle, protoId: a.protoId }, a.units);
        if (!award) continue;
        take(a, award);
        n++;
      }
      compact();
      return n;
    }
  };
}

/** One group of the grouped line: applications with one award rule (spec 4.17 item 5). */
interface Group {
  key: string;
  g: { kind: ProjectKind; bundle: readonly number[]; protoId: PrototypeId };
  /** the capped pools of the bundle */
  pools: readonly number[];
  /** members in key order; removed ones stay until the next rebuild */
  apps: App[];
  /** leaves `cap + i`: member i's units, +Infinity once removed */
  min: Float64Array;
  /** the same leaves for the largest size, -Infinity once removed */
  max: Float64Array;
  cap: number;
  /** the trees are behind `apps`: rebuilt from the live members before they are next read */
  dirty: boolean;
  /** the largest passing size against the money now; null when it must be found again */
  H: number | null;
}

const groupKey = (a: App): string =>
  `${a.kind}|${a.kind === 'market' ? a.protoId : ''}|${a.bundleKey}`;

function setLeaf(gr: Group, i: number, lo: number, hi: number): void {
  let n = gr.cap + i;
  gr.min[n] = lo;
  gr.max[n] = hi;
  for (n >>= 1; n >= 1; n >>= 1) {
    gr.min[n] = Math.min(gr.min[2 * n], gr.min[2 * n + 1]);
    gr.max[n] = Math.max(gr.max[2 * n], gr.max[2 * n + 1]);
  }
}

function buildTrees(gr: Group, live: (a: App) => boolean): void {
  let cap = 1;
  while (cap < Math.max(1, gr.apps.length)) cap *= 2;
  gr.cap = cap;
  gr.min = new Float64Array(2 * cap).fill(Infinity);
  gr.max = new Float64Array(2 * cap).fill(-Infinity);
  gr.apps.forEach((a, i) => {
    if (!live(a)) return;
    gr.min[cap + i] = a.units;
    gr.max[cap + i] = a.units;
  });
  for (let n = cap - 1; n >= 1; n--) {
    gr.min[n] = Math.min(gr.min[2 * n], gr.min[2 * n + 1]);
    gr.max[n] = Math.max(gr.max[2 * n], gr.max[2 * n + 1]);
  }
}

/** The first member at or after `from` whose units are at most `H`; -1 when none. */
function firstAtMost(gr: Group, from: number, H: number): number {
  const go = (n: number, l: number, r: number): number => {
    if (r <= from || gr.min[n] > H) return -1;
    if (n >= gr.cap) return l;
    const m = (l + r) >> 1;
    const left = go(2 * n, l, m);
    return left >= 0 ? left : go(2 * n + 1, m, r);
  };
  return go(1, 0, gr.cap);
}

/**
 * Serving by grouped bisection (spec 4.17 item 5), an implementation of the single scan of
 * section 4.6. Applications with the same kind, bundle and (market) prototype share a group; in a
 * group the award rule depends on an application only through its units and is monotone in them,
 * so "passes" is "units ≤ H". A pass repeatedly takes the earliest application, in key order and
 * after the last one decided, among the groups' first members at most H; confirms it with the
 * award rule at its own units (an award the scan would give it); and finds H again for the groups
 * that share a capped pool with the award. `poolsOf` gives a bundle's capped pools.
 *
 * The group of each application is the line's own record (`regroup` is called after the engine
 * has overwritten the fields), never derived from the application's current fields.
 */
export function groupedLine(poolsOf: (bundle: readonly number[]) => readonly number[]): Line {
  let items: (App | null)[] = [];
  /**
   * live applications: their group, index in it (-1 while a rebuild is due) and index in `items`
   */
  const loc = new Map<App, { gr: Group; i: number; k: number }>();
  const groups = new Map<string, Group>();
  /** `groups` by bundle array and kind or prototype: skips building the key for a known array */
  let byBundle = new WeakMap<readonly number[], Map<string, Group>>();
  let dead = 0;
  let last: App | null = null;
  let seq = 0;
  /** a regroup moved an application between groups: rebuild before the next serve */
  let stale = false;

  function groupFor(a: App): Group {
    const sub = a.kind === 'market' ? a.protoId : '~affordable';
    let known = byBundle.get(a.bundle);
    if (known === undefined) {
      known = new Map();
      byBundle.set(a.bundle, known);
    }
    const hit = known.get(sub);
    // the key also holds `bundleKey`, which is `bundle.join(',')`: compare it for a known array
    if (hit !== undefined && hit.g.kind === a.kind) return hit;
    const k = groupKey(a);
    let gr = groups.get(k);
    if (!gr) {
      gr = {
        key: k,
        g: { kind: a.kind, bundle: a.bundle.slice(), protoId: a.protoId },
        pools: poolsOf(a.bundle),
        apps: [],
        min: new Float64Array(2).fill(Infinity),
        max: new Float64Array(2).fill(-Infinity),
        cap: 1,
        dirty: false,
        H: null
      };
      groups.set(k, gr);
    }
    known.set(sub, gr);
    return gr;
  }

  /** Every group again from the line in key order: drops removed entries and empty groups. */
  function rebuild(): void {
    const next: App[] = [];
    for (const a of items) if (a) next.push(a);
    items = next;
    dead = 0;
    groups.clear();
    byBundle = new WeakMap();
    loc.clear();
    next.forEach((a, k) => {
      const gr = groupFor(a);
      loc.set(a, { gr, i: gr.apps.length, k });
      gr.apps.push(a);
    });
    for (const gr of groups.values()) buildTrees(gr, () => true);
    // (groups are new here, so none is dirty)
    stale = false;
  }

  function append(gr: Group, a: App, k: number): void {
    gr.H = null;
    const i = gr.apps.length;
    gr.apps.push(a);
    loc.set(a, { gr, i, k });
    // past the trees' room: grow them once, from the live members, when next read
    if (gr.dirty || i >= gr.cap) gr.dirty = true;
    else setLeaf(gr, i, a.units, a.units);
  }

  /** Brings a dirty group's trees up to date with its live members. */
  function clean(gr: Group): void {
    if (!gr.dirty) return;
    buildTrees(gr, (x) => loc.get(x)?.gr === gr);
    gr.dirty = false;
  }

  /**
   * The largest whole size from 1 to the group's largest at which the award rule passes now. It
   * is exact on [smallest, largest] of the members then (below the smallest it may say pass), so
   * it stays right for the group while members only leave.
   */
  function threshold(gr: Group, test: AwardTest): number {
    const lo0 = gr.min[1];
    const hi0 = gr.max[1];
    if (lo0 === Infinity) return 0;
    if (!test(gr.g, lo0)) return lo0 - 1;
    if (test(gr.g, hi0)) return hi0;
    let lo = lo0;
    let hi = hi0;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (test(gr.g, mid)) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** The index of the first member of `gr` with `seq` above `after`. */
  function startAfter(gr: Group, after: number): number {
    let lo = 0;
    let hi = gr.apps.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (gr.apps[m].seq <= after) lo = m + 1;
      else hi = m;
    }
    return lo;
  }

  return {
    get size() {
      return loc.size;
    },
    add(app) {
      if (
        last &&
        (app.applied < last.applied || (app.applied === last.applied && app.key < last.key))
      )
        throw new RangeError('line.add: applications must arrive in (applied, key) order');
      app.seq = seq++;
      last = app;
      const k = items.length;
      items.push(app);
      if (stale) {
        // placed by the rebuild before the next serve; counted live meanwhile
        loc.set(app, { gr: groupFor(app), i: -1, k });
        return;
      }
      append(groupFor(app), app, k);
    },
    remove(app) {
      const where = loc.get(app);
      if (where === undefined) return;
      loc.delete(app);
      items[where.k] = null;
      dead++;
      // a dirty group's trees are rebuilt from its live members
      if (where.i >= 0 && !where.gr.dirty) setLeaf(where.gr, where.i, Infinity, -Infinity);
    },
    regroup(app) {
      const where = loc.get(app);
      if (!where) return;
      const k = groupKey(app);
      if (k === where.gr.key) {
        // the same group: only the size may have changed
        if (where.i >= 0 && !where.gr.dirty) setLeaf(where.gr, where.i, app.units, app.units);
        where.gr.H = null;
        return;
      }
      // another group: it keeps its key, and the groups are rebuilt in key order before serving
      if (where.i >= 0 && !where.gr.dirty) setLeaf(where.gr, where.i, Infinity, -Infinity);
      loc.set(app, { gr: groupFor(app), i: -1, k: where.k });
      stale = true;
    },
    apps() {
      return items.filter((a): a is App => a !== null);
    },
    serve(test, take, keep = false) {
      if (stale || dead * 2 > items.length) rebuild();
      // H depends only on the award rule and the money, and stays exact for the group's members
      // as long as none joins and none changes size (removals keep it: see `threshold`)
      if (!keep) for (const gr of groups.values()) gr.H = null;
      for (const gr of groups.values()) clean(gr);
      let n = 0;
      /** the `seq` of the last application decided in this pass, as the scan's position */
      let after = -1;
      for (;;) {
        let best: App | null = null;
        let bestGr: Group | null = null;
        for (const gr of groups.values()) {
          if (gr.min[1] === Infinity) continue;
          gr.H ??= threshold(gr, test);
          const i = firstAtMost(gr, startAfter(gr, after), gr.H);
          if (i < 0) continue;
          const a = gr.apps[i];
          if (!best || a.seq < best.seq) {
            best = a;
            bestGr = gr;
          }
        }
        if (!best || !bestGr) break;
        after = best.seq;
        const award = test(
          { kind: best.kind, bundle: best.bundle, protoId: best.protoId },
          best.units
        );
        if (!award) continue;
        take(best, award);
        n++;
        const touched = new Set(poolsOf(award.set));
        for (const gr of groups.values()) {
          if (gr.H !== null && gr.pools.some((q) => touched.has(q))) gr.H = null;
        }
      }
      return n;
    }
  };
}
