import { DEFAULT_POLICY4 } from '$lib/timeline/policy4';
import { checkRuleset } from './check';
import { NAME_KEY, listKey, strokeKeyBase, type StrokeFields } from './keys';
import { assemble, flatten, isEndable, keyFits, listOf, parentOf, type Item } from './items';
import {
  DEFAULT_SIM_NAME,
  REGISTRY,
  readFields,
  upgradeSet,
  versionAt,
  type Registry
} from './shapes';
import {
  LogError,
  LogFormatError,
  type Change,
  type FoldInput,
  type Ruleset,
  type RulesetContent
} from './types';

/** What a commit touched, as it was before: restored on a throw. `undefined` means absent. */
interface Journal {
  items: Map<string, Item | undefined>;
  lists: Map<string, string[] | undefined>;
  kids: Map<string, Set<string> | undefined>;
}

function restore<V>(into: Map<string, V>, before: Map<string, V | undefined>): void {
  for (const [k, v] of before) {
    if (v === undefined) into.delete(k);
    else into.set(k, v);
  }
}

function bad(message: string): never {
  throw new LogError('invalid-change', message);
}

/**
 * Passed as apply's third argument by reapply alone: skips the stroke-order check, for a caller
 * that applies a commit's changes one at a time and applies the whole commit again at the end. A
 * state left that way is not kept. Not exported from index.ts.
 */
export const DEFER_STROKES: unique symbol = Symbol('defer the stroke-order check');

/**
 * The items of a sim, the order of its lists and the ruleset they describe. An absent list and an
 * empty list are the same thing: a list that empties is dropped.
 */
export class LogState {
  private memo: Ruleset | null = null;
  private journal: Journal | null = null;

  private constructor(
    private readonly reg: Registry,
    private items: Map<string, Item>,
    private lists: Map<string, string[]>,
    /** Parent key to the keys of its spans or strokes. */
    private kids: Map<string, Set<string>>,
    private datasetVersion: string | null
  ) {}

  static empty(registry: Registry = REGISTRY): LogState {
    return LogState.of({ name: DEFAULT_SIM_NAME, policy: DEFAULT_POLICY4 }, null, registry);
  }

  static of(
    r: RulesetContent,
    datasetVersion: string | null,
    registry: Registry = REGISTRY
  ): LogState {
    const { items, lists } = flatten(r);
    const kids = new Map<string, Set<string>>();
    for (const [key, item] of items) {
      const parent = parentOf(item);
      if (parent === null) continue;
      let set = kids.get(parent);
      if (!set) kids.set(parent, (set = new Set()));
      set.add(key);
    }
    return new LogState(registry, items, lists, kids, datasetVersion);
  }

  get registry(): Registry {
    return this.reg;
  }

  /**
   * Apply one commit's changes, read under input.shapes. Atomic: on a throw the state is
   * unchanged. With check, also runs checkRuleset and rolls back with LogError('invalid-ruleset').
   * `mode` is for reapply only (see DEFER_STROKES); TypeError together with check.
   */
  apply(input: FoldInput, opts: { check?: boolean } = {}, mode?: typeof DEFER_STROKES): void {
    if (mode === DEFER_STROKES && opts.check)
      throw new TypeError('DEFER_STROKES cannot be combined with check');
    versionAt(this.reg, input.shapes, 'sim');
    const j: Journal = { items: new Map(), lists: new Map(), kids: new Map() };
    this.journal = j;
    const memo = this.memo;
    const dataset = this.datasetVersion;
    const spans = new Map<string, number>();
    try {
      input.changes.forEach((c, i) => {
        try {
          this.change(c, i, input.shapes, spans);
        } catch (e) {
          throw at(e, i);
        }
      });
      if (mode !== DEFER_STROKES) for (const [span, i] of spans) this.checkStrokes(span, i);
      this.datasetVersion = input.datasetVersion;
      this.memo = null;
      if (opts.check) {
        const p = checkRuleset(this.ruleset());
        if (p) throw new LogError('invalid-ruleset', `${p.path}: ${p.message}`);
      }
    } catch (e) {
      restore(this.items, j.items);
      restore(this.lists, j.lists);
      restore(this.kids, j.kids);
      this.datasetVersion = dataset;
      this.memo = memo;
      throw e;
    } finally {
      this.journal = null;
    }
  }

  /** Memoised until the next apply, and shared by every caller until then: read-only. */
  ruleset(): Ruleset {
    return (this.memo ??= {
      ...assemble(this.items, this.lists),
      datasetVersion: this.datasetVersion
    });
  }

  item(key: string): Item | undefined {
    return this.items.get(key);
  }

  /** The keys of a list in order; [] when none. */
  list(listKey: string): readonly string[] {
    return this.lists.get(listKey) ?? [];
  }

  clone(): LogState {
    return new LogState(
      this.reg,
      new Map(this.items),
      new Map([...this.lists].map(([k, v]) => [k, [...v]])),
      new Map([...this.kids].map(([k, v]) => [k, new Set(v)])),
      this.datasetVersion
    );
  }

  // ---- journaled writes ----

  private putItem(key: string, item: Item | undefined): void {
    const j = this.journal!;
    if (!j.items.has(key)) j.items.set(key, this.items.get(key));
    if (item) this.items.set(key, item);
    else this.items.delete(key);
  }

  /** The list to edit: a copy made on first touch in this commit. */
  private editList(key: string): string[] {
    const j = this.journal!;
    if (!j.lists.has(key)) {
      const old = this.lists.get(key);
      j.lists.set(key, old);
      if (old) this.lists.set(key, [...old]);
    }
    let a = this.lists.get(key);
    if (!a) this.lists.set(key, (a = []));
    return a;
  }

  private dropIfEmpty(key: string): void {
    if (this.lists.get(key)?.length === 0) this.lists.delete(key);
  }

  private dropList(key: string): void {
    if (!this.lists.has(key)) return;
    this.editList(key);
    this.lists.delete(key);
  }

  private editKids(key: string): Set<string> {
    const j = this.journal!;
    if (!j.kids.has(key)) {
      const old = this.kids.get(key);
      j.kids.set(key, old);
      if (old) this.kids.set(key, new Set(old));
    }
    let s = this.kids.get(key);
    if (!s) this.kids.set(key, (s = new Set()));
    return s;
  }

  private insert(listKey: string, key: string, after: string | null): void {
    const a = this.editList(listKey);
    a.splice(after === null ? 0 : a.indexOf(after) + 1, 0, key);
  }

  private unlist(listKey: string, key: string): void {
    const a = this.editList(listKey);
    a.splice(a.indexOf(key), 1);
    this.dropIfEmpty(listKey);
  }

  // ---- one change ----

  private change(c: Change, i: number, revision: number, spans: Map<string, number>): void {
    const reg = this.reg;
    const where = `changes[${i}]`;
    switch (c.op) {
      case 'add': {
        const item: Item = {
          shape: c.shape,
          fields: structuredClone(readFields(reg, revision, c.shape, c.fields, `${where}.fields`))
        };
        if (c.key === NAME_KEY || this.items.has(c.key)) bad(`the key ${c.key} is taken`);
        if (!keyFits(c.key, item)) bad(`the key ${c.key} does not fit its ${c.shape} fields`);
        const parent = parentOf(item);
        if (parent !== null) {
          const want = item.shape === 'stroke' ? 'span.painted' : `policy.${item.shape.slice(5)}`;
          if (this.items.get(parent)?.shape !== want) bad(`${parent} is not a ${want}`);
        }
        const lk = listOf(item);
        if (lk === null) {
          if (c.after !== undefined) bad(`${c.shape} is not listed, so it takes no after`);
        } else {
          if (c.after === undefined) bad(`${c.shape} is listed, so it needs an after`);
          if (c.after !== null && !this.list(lk).includes(c.after))
            bad(`${c.after} is not in ${lk}`);
        }
        if (item.shape === 'stroke') {
          const f = item.fields as unknown as StrokeFields;
          for (const k of this.list(listKey(f.span))) {
            const o = this.items.get(k)!.fields as unknown as StrokeFields;
            if (o.brush === f.brush && (o.kind !== f.kind || o.stories !== f.stories))
              bad(`the stroke disagrees with brush ${f.brush} on kind or stories`);
          }
          spans.set(f.span, i);
        }
        this.putItem(c.key, item);
        if (parent !== null) this.editKids(parent).add(c.key);
        if (lk !== null) this.insert(lk, c.key, c.after ?? null);
        return;
      }
      case 'end': {
        const item = this.items.get(c.key);
        if (!item || !isEndable(item.shape)) bad(`${c.key} is not a span`);
        const { from, to } = item.fields as { from: number; to: number | null };
        if (c.to < from) bad(`${c.key} cannot end before it starts`);
        if (to !== null && to <= c.to) bad(`${c.key} already ends by ${to}`);
        this.putItem(c.key, { shape: item.shape, fields: { ...item.fields, to: c.to } });
        return;
      }
      case 'move': {
        const item = this.items.get(c.key);
        const lk = item && listOf(item);
        if (!lk) bad(`${c.key} is not in a list`);
        if (c.after !== null && (c.after === c.key || !this.list(lk).includes(c.after)))
          bad(`${c.after} is not another key in ${lk}`);
        this.unlist(lk, c.key);
        this.insert(lk, c.key, c.after);
        if (item.shape === 'stroke') spans.set(item.fields.span as string, i);
        return;
      }
      case 'set': {
        const item = this.items.get(c.key);
        if (!item) bad(`${c.key} does not exist`);
        const v = versionAt(reg, revision, item.shape);
        const up = upgradeSet(reg, item.shape, v, c.field, c.value);
        const versions = reg.shapes[item.shape];
        const check = Object.hasOwn(versions[versions.length - 1].settable, up.field)
          ? versions[versions.length - 1].settable[up.field]
          : undefined;
        if (!check) bad(`${up.field} cannot be set on ${item.shape}`);
        const value = check(up.value, `${where}.value`);
        this.putItem(c.key, { shape: item.shape, fields: { ...item.fields, [up.field]: value } });
        return;
      }
      case 'delete': {
        const item = this.items.get(c.key);
        if (!item || c.key === NAME_KEY) bad(`${c.key} cannot be deleted`);
        const parent = parentOf(item);
        const lk = listOf(item);
        if (lk !== null) this.unlist(lk, c.key);
        if (parent !== null) {
          const siblings = this.editKids(parent);
          siblings.delete(c.key);
          if (siblings.size === 0) this.kids.delete(parent);
        }
        if (item.shape === 'stroke') spans.set(item.fields.span as string, i);
        const stack = [c.key];
        while (stack.length > 0) {
          const k = stack.pop()!;
          stack.push(...(this.kids.get(k) ?? []));
          this.putItem(k, undefined);
          this.dropList(listKey(k));
          if (this.kids.has(k)) {
            this.editKids(k);
            this.kids.delete(k);
          }
        }
        return;
      }
    }
  }

  /**
   * After a commit, a span's strokes are in the order `flatten` gives them: each brush's strokes
   * together, and each group of identical strokes holding k:D, k:D~2, …, k:D~n in that order.
   */
  private checkStrokes(span: string, index: number): void {
    if (!this.items.has(span)) return;
    const seen = new Map<string, number>();
    const closed = new Set<string>();
    let run: string | null = null;
    for (const key of this.list(listKey(span))) {
      const f = this.items.get(key)!.fields as unknown as StrokeFields;
      if (f.brush !== run) {
        if (run !== null) closed.add(run);
        if (closed.has(f.brush))
          throw new LogError(
            'invalid-change',
            `the strokes of brush ${f.brush} in ${span} would not be together`,
            index
          );
        run = f.brush;
      }
      const base = strokeKeyBase(f);
      const n = key === base ? 1 : Number(key.slice(base.length + 1));
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      if (n !== count)
        throw new LogError(
          'invalid-change',
          `the repeats of ${base} in ${span} would not be numbered 1 to n in order`,
          index
        );
    }
  }
}

/** The error with its change index: a bare invalid-change or format error gains `index`. */
function at(e: unknown, index: number): unknown {
  if (e instanceof LogFormatError) return new LogError('invalid-change', e.message, index);
  if (e instanceof LogError && e.code === 'invalid-change' && e.index === null)
    return new LogError(e.code, e.message, index);
  return e;
}

/** The ruleset a log of commits reads to. */
export function fold(commits: readonly FoldInput[], registry: Registry = REGISTRY): Ruleset {
  const state = LogState.empty(registry);
  for (const c of commits) state.apply(c);
  return state.ruleset();
}
