import { isStrokeKeyOf, strokeKeyBase, type StrokeFields } from './keys';
import { isEndable, listOf, parentOf, type Item } from './items';
import { upgradeFields, versionAt } from './shapes';
import type { LogState } from './state';
import { LogError, LogFormatError, type Change, type FoldInput } from './types';

export type DropReason = 'gone' | 'exists' | 'not-truncation' | 'no-op';
export interface Dropped {
  index: number;
  change: Change;
  why: DropReason;
}
export type Reapplied =
  | { ok: true; changes: Change[]; dropped: Dropped[] }
  | { ok: false; why: 'empty' | 'invalid'; dropped: Dropped[] };

type Add = Extract<Change, { op: 'add' }>;
/** A key as this commit's later changes mean it: renamed, or undefined when its item is gone. */
type Resolve = (key: string) => string | undefined;

/** The item an add describes, read under `revision`; null when it does not parse. */
function addedItem(s: LogState, c: Add, revision: number): Item | null {
  const reg = s.registry;
  try {
    const v = versionAt(reg, revision, c.shape);
    const parsed = reg.shapes[c.shape][v - 1].parse(c.fields, 'fields');
    return { shape: c.shape, fields: upgradeFields(reg, c.shape, v, parsed) };
  } catch (e) {
    if (e instanceof LogError || e instanceof LogFormatError) return null;
    throw e;
  }
}

/**
 * Where a listed item goes when its anchor is gone: after the last other stroke of its brush, or
 * else last in its list; null when the list holds no other key.
 */
function anchorFor(s: LogState, item: Item, self: string | null): string | null {
  const keys = s.list(listOf(item)!).filter((k) => k !== self);
  if (item.shape === 'stroke') {
    const brush = item.fields.brush;
    for (let i = keys.length - 1; i >= 0; i--)
      if (s.item(keys[i])!.fields.brush === brush) return keys[i];
  }
  return keys.at(-1) ?? null;
}

/** The lowest free key of a stroke's group of identical strokes in its span. */
function freeKey(s: LogState, f: StrokeFields): string {
  const base = strokeKeyBase(f);
  for (let n = 1; ; n++) {
    const key = n === 1 ? base : `${base}~${n}`;
    if (!s.item(key)) return key;
  }
}

/** The change as it applies to `s`, or why it is dropped. One `apply` refuses is returned as is. */
function settle(s: LogState, c: Change, revision: number, resolve: Resolve): Change | DropReason {
  if (c.op === 'add') {
    const item = addedItem(s, c, revision);
    if (!item) return c;
    const parent = parentOf(item);
    if (parent !== null && !s.item(parent)) return 'gone';
    if (s.item(c.key)) return 'exists';
    let out: Add = c;
    if (listOf(item) !== null && typeof c.after === 'string') {
      const after = resolve(c.after);
      if (after === undefined || !s.list(listOf(item)!).includes(after))
        out = { ...out, after: anchorFor(s, item, null) };
      else if (after !== c.after) out = { ...out, after };
    }
    if (item.shape === 'stroke') {
      const f = item.fields as unknown as StrokeFields;
      const key = isStrokeKeyOf(c.key, f) ? freeKey(s, f) : c.key;
      if (key !== c.key) out = { ...out, key };
    }
    return out;
  }
  const key = resolve(c.key);
  const item = key === undefined ? undefined : s.item(key);
  if (key === undefined || !item) return 'gone';
  const out = key === c.key ? c : { ...c, key };
  if (out.op === 'end' && isEndable(item.shape)) {
    const to = item.fields.to as number | null;
    if (to !== null && to <= out.to) return 'not-truncation';
  }
  if (out.op === 'move' && out.after !== null && listOf(item) !== null) {
    const after = resolve(out.after);
    if (after === undefined || after === key || !s.list(listOf(item)!).includes(after)) {
      const anchor = anchorFor(s, item, key);
      return anchor === null ? 'no-op' : { ...out, after: anchor };
    }
    if (after !== out.after) return { ...out, after };
  }
  return out;
}

/**
 * R19: re-apply one pending commit's stored changes on `tip`. Never mutates `tip`.
 *
 * Walks the changes in order, each seeing the kept ones before it. A change whose item (or, for
 * an add, parent) is gone is dropped as `gone`, an add whose key is taken as `exists`, an end that
 * no longer shortens its span as `not-truncation`, and a move with no anchor left in its list as
 * `no-op`; the rest of the commit stands. An add or move whose anchor is gone is re-anchored (see
 * anchorFor), and a stroke add takes the lowest free key of its identical strokes, later changes
 * following the new key. The commit is `empty` when nothing is kept, and `invalid` when a kept
 * change is refused or the whole fails the stroke-order or ruleset check. The changes returned,
 * applied to `tip` as one commit, are accepted.
 */
export function reapply(tip: LogState, input: FoldInput): Reapplied {
  const work = tip.clone();
  const kept: Change[] = [];
  const dropped: Dropped[] = [];
  /** Rewritten stroke keys to their new keys; a key a rewrite took to undefined (its item gone). */
  const renamed = new Map<string, string | undefined>();
  const resolve: Resolve = (key) => (renamed.has(key) ? renamed.get(key) : key);
  for (let index = 0; index < input.changes.length; index++) {
    const change = input.changes[index];
    const out = settle(work, change, input.shapes, resolve);
    if (typeof out === 'string') {
      dropped.push({ index, change, why: out });
      continue;
    }
    try {
      work.apply({ ...input, changes: [out] }, { strokes: false });
    } catch (e) {
      if (e instanceof LogError) return { ok: false, why: 'invalid', dropped };
      throw e;
    }
    kept.push(out);
    if (out.op === 'add' && out.key !== change.key) {
      renamed.set(change.key, out.key);
      if (!renamed.has(out.key)) renamed.set(out.key, undefined);
    }
  }
  if (kept.length === 0) return { ok: false, why: 'empty', dropped };
  try {
    tip.clone().apply({ ...input, changes: kept }, { check: true });
  } catch (e) {
    if (e instanceof LogError) return { ok: false, why: 'invalid', dropped };
    throw e;
  }
  return { ok: true, changes: kept, dropped };
}
