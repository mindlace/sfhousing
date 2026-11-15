import { canonicalJson } from '$lib/sim-page/policy';
import { flatten, parentOf, type Item } from './items';
import { REGISTRY } from './shapes';
import type { Change, RulesetContent } from './types';

/** The settable fields of a shape in the current version. */
function settableOf(shape: string): string[] {
  const versions = REGISTRY.shapes[shape];
  return Object.keys(versions[versions.length - 1].settable);
}

/** The positions in `ranks` of a longest strictly increasing subsequence. */
function lisPositions(ranks: readonly number[]): Set<number> {
  const tails: number[] = [];
  const prev: number[] = [];
  ranks.forEach((rank, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ranks[tails[mid]] < rank) lo = mid + 1;
      else hi = mid;
    }
    prev[i] = lo > 0 ? tails[lo - 1] : -1;
    tails[lo] = i;
  });
  const out = new Set<number>();
  for (let i = tails.length > 0 ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) out.add(i);
  return out;
}

/**
 * The changes that take the state of `a` to `b`, list order included. Applied in order by
 * LogState to the state of `a`, they give the items and lists of `flatten(b)`. Throws RangeError
 * when `b` is not in log form (it has an empty brush).
 */
export function diff(a: RulesetContent, b: RulesetContent): Change[] {
  const B = flatten(b);
  const A = flatten(a);

  const survived = new Map<string, boolean>();
  const same = (k: string): boolean => {
    const x = A.items.get(k);
    const y = B.items.get(k);
    if (!x || !y || x.shape !== y.shape) return false;
    const skip = new Set(settableOf(x.shape));
    const isSpan = x.shape.startsWith('span.');
    if (isSpan) skip.add('to');
    const keys = new Set([...Object.keys(x.fields), ...Object.keys(y.fields)]);
    for (const f of keys) {
      if (skip.has(f)) continue;
      if (canonicalJson(x.fields[f]) !== canonicalJson(y.fields[f])) return false;
    }
    if (isSpan) {
      const from = x.fields.to as number | null;
      const to = y.fields.to as number | null;
      if (from !== to && !(to !== null && (from === null || to < from))) return false;
    }
    return true;
  };
  const survives = (k: string): boolean => {
    let v = survived.get(k);
    if (v === undefined) {
      const parent = parentOf((A.items.get(k) ?? B.items.get(k))!);
      v = same(k) && (parent === null || survives(parent));
      survived.set(k, v);
    }
    return v;
  };

  const out: Change[] = [];

  // 1. deletes: the topmost item that goes; a cascade removes what is under it
  for (const [k, item] of A.items) {
    if (survives(k)) continue;
    const parent = parentOf(item);
    if (parent === null || survives(parent)) out.push({ op: 'delete', key: k });
  }

  // 2. adds and moves, level by level: policies, spans, strokes
  const isStrokeList = (keys: readonly string[]) => B.items.get(keys[0])!.shape === 'stroke';
  const listed = (list: readonly string[], aList: readonly string[]) => {
    const rank = new Map(list.map((k, i) => [k, i]));
    const kept = aList.filter((k) => rank.has(k) && survives(k));
    const stable = new Set(lisPositions(kept.map((k) => rank.get(k)!)).values());
    const stableKeys = new Set(kept.filter((_, i) => stable.has(i)));
    let prev: string | null = null;
    for (const k of list) {
      if (!survives(k)) {
        const item: Item = B.items.get(k)!;
        out.push({
          op: 'add',
          key: k,
          shape: item.shape,
          fields: structuredClone(item.fields),
          after: prev
        });
      } else if (!stableKeys.has(k)) out.push({ op: 'move', key: k, after: prev });
      prev = k;
    }
  };
  for (const [lk, list] of B.lists) if (!isStrokeList(list)) listed(list, A.lists.get(lk) ?? []);
  for (const [k, item] of B.items) {
    if (item.shape.startsWith('span.') && !survives(k))
      out.push({ op: 'add', key: k, shape: item.shape, fields: structuredClone(item.fields) });
  }
  for (const [lk, list] of B.lists) if (isStrokeList(list)) listed(list, A.lists.get(lk) ?? []);

  // 3. sets: the name first (the sim item leads the items), then the rest
  for (const [k, y] of B.items) {
    if (!survives(k)) continue;
    const x = A.items.get(k)!;
    for (const f of settableOf(y.shape)) {
      if (canonicalJson(x.fields[f]) !== canonicalJson(y.fields[f]))
        out.push({
          op: 'set',
          key: k,
          field: f,
          value: y.fields[f] as string | number | boolean | null
        });
    }
  }

  // 4. ends
  for (const [k, y] of B.items) {
    if (!y.shape.startsWith('span.') || !survives(k)) continue;
    const to = y.fields.to as number | null;
    // a surviving span's `to` differs only by a truncation, so `to` is a day here
    if (to !== null && to !== (A.items.get(k)!.fields.to as number | null))
      out.push({ op: 'end', key: k, to });
  }

  return out;
}
