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
  /** one pass; `take` removes the awarded application (and its lot's other one). Returns awards. */
  serve(test: AwardTest, take: (app: App, a: Award) => void): number;
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
