/**
 * The schema 3 lens: today's editors edit one span of a schema 4 document through a `SimPolicy`
 * that holds only that span's effect (`project`), and their result is read back into the span
 * (`writeBack`). Only the fields the span's selector projects are read back; programme terms are
 * reconciled where the edit is committed, not here. Pure TS.
 */
import { canonicalJson, DEFAULT_POLICY, type SimPolicy } from '$lib/sim-page/policy';
import type { Effect, Policy, SimPolicy4, Span } from './policy4';
import { policyOf, type SpanRef } from './spans';

export interface EditStore {
  readonly policy: SimPolicy;
  apply(change: (p: SimPolicy) => SimPolicy, label: string, coalesce?: string): void;
}

export interface StrokeStore extends EditStore {
  undo(): string | null;
  redo(): string | null;
}

function locate(doc: SimPolicy4, ref: SpanRef): { p: Policy; s: Span } | null {
  const p = policyOf(doc, ref.kind, ref.id);
  const s = p?.spans[ref.span];
  return p && s ? { p, s } : null;
}

/** `DEFAULT_POLICY` holding only the effect of the span at `ref`; `DEFAULT_POLICY` itself if none. */
export function project(doc: SimPolicy4, ref: SpanRef): SimPolicy {
  const at = locate(doc, ref);
  if (!at) return DEFAULT_POLICY;
  const { p, s } = at;
  const w = p.where;
  const what = s.what;
  const out: SimPolicy = { ...DEFAULT_POLICY };
  if (w.tag === 'transit' && what.tag === 'bands') {
    out.rules = [{ id: p.id, kind: 'transit', stopTypes: w.stopTypes, bands: what.bands }];
  } else if (w.tag === 'painted' && what.tag === 'brushes') {
    out.custom = what.brushes;
  } else if (w.tag === 'category' && what.tag === 'protect') {
    // The editor's switch is the policy's: an off policy projects as off.
    out.protect =
      w.category === 'newerThan'
        ? { ...DEFAULT_POLICY.protect, newerThanYears: p.on ? what.years : null }
        : { ...DEFAULT_POLICY.protect, [w.category]: p.on };
  } else if (w.tag === 'routes' && what.tag === 'timing') {
    out.timing = { current: what.set, saved: null };
  } else if (w.tag === 'baseline' && what.tag === 'scales') {
    out.funding = { ...DEFAULT_POLICY.funding, baselineScale: what.entries };
  } else if (w.tag === 'fund' && what.tag === 'fund') {
    out.funding = {
      ...DEFAULT_POLICY.funding,
      pools: what.pool ? [what.pool] : [],
      programmes: what.programmes
    };
  } else if (w.tag === 'terms' && what.tag === 'terms') {
    out.funding = { ...DEFAULT_POLICY.funding, terms: what.terms };
  }
  return out;
}

/** The policy (switch, selector, preset) and span effect `q` stands for. */
function readBack(p: Policy, s: Span, q: SimPolicy): { policy: Policy; what: Effect } {
  const w = p.where;
  const what = s.what;
  if (w.tag === 'transit' && what.tag === 'bands') {
    const rule = q.rules.find((r) => r.id === p.id) ?? q.rules[0];
    if (!rule) return { policy: { ...p, on: false }, what };
    return {
      policy: { ...p, where: { tag: 'transit', stopTypes: rule.stopTypes } },
      what: { tag: 'bands', bands: rule.bands }
    };
  }
  if (w.tag === 'painted' && what.tag === 'brushes')
    return { policy: p, what: { tag: 'brushes', brushes: q.custom } };
  if (w.tag === 'category' && what.tag === 'protect') {
    if (w.category !== 'newerThan') return { policy: { ...p, on: q.protect[w.category] }, what };
    const years = q.protect.newerThanYears;
    if (years === null) return { policy: { ...p, on: false }, what };
    return { policy: { ...p, on: true }, what: { tag: 'protect', years } };
  }
  if (w.tag === 'routes' && what.tag === 'timing') {
    const set = q.timing.current;
    return { policy: { ...p, preset: set.preset }, what: { tag: 'timing', set } };
  }
  if (w.tag === 'baseline' && what.tag === 'scales')
    return { policy: p, what: { tag: 'scales', entries: q.funding.baselineScale } };
  if (w.tag === 'fund' && what.tag === 'fund') {
    const next = q.funding.pools.find((x) => x.id === w.pool) ?? q.funding.pools[0];
    // An offer's debt terms are fixed once it is in the document (ruling OQ-2); a pool the editor
    // removed stays: removing the policy is the Inspector's Remove.
    const pool =
      what.pool === null
        ? null
        : next
          ? { ...next, id: what.pool.id, debt: what.pool.debt }
          : what.pool;
    return { policy: p, what: { tag: 'fund', pool, programmes: q.funding.programmes } };
  }
  if (w.tag === 'terms' && what.tag === 'terms')
    return { policy: p, what: { tag: 'terms', terms: q.funding.terms } };
  return { policy: p, what };
}

/** The document with the span at `ref` (and its policy's switch and selector) read from `q`. */
export function writeBack(doc: SimPolicy4, ref: SpanRef, q: SimPolicy): SimPolicy4 {
  const at = locate(doc, ref);
  if (!at) return doc;
  const { p, s } = at;
  const r = readBack(p, s, q);
  const whatSame = canonicalJson(r.what) === canonicalJson(s.what);
  const policySame =
    r.policy.on === p.on &&
    r.policy.preset === p.preset &&
    canonicalJson(r.policy.where) === canonicalJson(p.where);
  if (whatSame && policySame) return doc;
  const spans = whatSame
    ? p.spans
    : p.spans.map((x, i) => (i === ref.span ? { ...s, what: r.what } : x));
  const next: Policy = policySame ? { ...p, spans } : { ...r.policy, spans };
  return {
    ...doc,
    kinds: { ...doc.kinds, [ref.kind]: doc.kinds[ref.kind].map((x) => (x.id === p.id ? next : x)) }
  };
}

/** Today's editors on the span `ref()` names, applied as one change to the document store. */
export function spanLens(
  store: {
    readonly policy: SimPolicy4;
    apply(c: (p: SimPolicy4) => SimPolicy4, label: string, coalesce?: string): void;
    undo(): string | null;
    redo(): string | null;
  },
  ref: () => SpanRef | null
): StrokeStore {
  return {
    get policy() {
      const r = ref();
      return r ? project(store.policy, r) : DEFAULT_POLICY;
    },
    apply(change, label, coalesce) {
      const r = ref();
      if (!r) return;
      store.apply((d) => writeBack(d, r, change(project(d, r))), label, coalesce);
    },
    undo: () => store.undo(),
    redo: () => store.redo()
  };
}
