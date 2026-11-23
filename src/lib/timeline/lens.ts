/**
 * The schema 3 lens: today's editors edit one span of a schema 4 document through a `SimPolicy`
 * that holds only that span's effect (`project`), and their result is read back into the span
 * (`writeBack`). Only the fields the span's selector projects are read back. What parse4 requires
 * to agree across a policy's spans or across the document is kept valid here: a fund's programme
 * set is the policy's (written to every span, new ids renamed clear of the document's), a
 * permitting preset is the policy's (a change on one span of several is refused), and an edit past
 * `FINANCE_LIMITS` over the document is refused. Programme terms are reconciled where the edit is
 * committed, not here. Pure TS.
 */
import { limitAlert } from '$lib/sim-page/funding-copy';
import { canonicalJson, DEFAULT_POLICY, type SimPolicy } from '$lib/sim-page/policy';
import { PRESETS, timingLabel, type TimingSet } from '$lib/sim-page/timing';
import { FINANCE_LIMITS } from '$lib/sim/levers/finance';
import type { Day } from '$lib/timelapse/time';
import type { Programme } from '$lib/timelapse/types';
import { spanAt, type Policy, type SimPolicy4, type Span } from './policy4';
import { policyOf, type SpanRef } from './spans';

/** The label of a custom timing policy as added; it follows the set once the set is edited. */
export const CUSTOM_TIMING_LABEL = 'Custom timing';

/** Refusal: a preset is the whole policy's, and this policy has more than one span. */
export const PRESET_PER_POLICY =
  'This policy has more than one span. Add a new policy for another preset.';

export interface EditStore {
  readonly policy: SimPolicy;
  apply(change: (p: SimPolicy) => SimPolicy, label: string, coalesce?: string): void;
}

export interface StrokeStore extends EditStore {
  undo(): string | null;
  redo(): string | null;
}

/**
 * The lens on one span. `apply` returns false when the edit was refused (the document is left as
 * it was); `refused` is then the message to show, null after an edit that was not refused.
 */
export interface SpanLens extends StrokeStore {
  apply(change: (p: SimPolicy) => SimPolicy, label: string, coalesce?: string): boolean;
  readonly refused: string | null;
}

function locate(doc: SimPolicy4, ref: SpanRef): { p: Policy; s: Span } | null {
  const p = policyOf(doc, ref.kind, ref.id);
  const s = p?.spans[ref.span];
  return p && s ? { p, s } : null;
}

/**
 * The market terms the document's terms policies have in force on `day`: every one that is on,
 * merged in document order (a later policy's term wins), as the engine reads them.
 */
export function termsInForce(doc: SimPolicy4, day: Day): SimPolicy['funding']['terms'] {
  let terms: SimPolicy['funding']['terms'] = {};
  for (const p of doc.kinds.money) {
    if (p.where.tag !== 'terms') continue;
    const s = spanAt(p, day);
    if (s?.what.tag === 'terms') terms = { ...terms, ...s.what.terms };
  }
  return terms;
}

/**
 * `DEFAULT_POLICY` holding only the effect of the span at `ref`; `DEFAULT_POLICY` itself if none.
 * A fund span also carries the market terms in force at its start, for its editor to price with.
 */
export function project(doc: SimPolicy4, ref: SpanRef): SimPolicy {
  const at = locate(doc, ref);
  if (!at) return DEFAULT_POLICY;
  const { p, s } = at;
  const w = p.where;
  const what = s.what;
  const out: SimPolicy = { ...DEFAULT_POLICY };
  // The editor's switch is the policy's: an off policy projects as off (no rule, no protection).
  if (w.tag === 'transit' && what.tag === 'bands') {
    out.rules = p.on
      ? [{ id: p.id, kind: 'transit', stopTypes: w.stopTypes, bands: what.bands }]
      : [];
  } else if (w.tag === 'painted' && what.tag === 'brushes') {
    out.custom = what.brushes;
  } else if (w.tag === 'category' && what.tag === 'protect') {
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
      programmes: what.programmes,
      // Context only (which instruments the terms allow): `readFund` never reads it back.
      terms: termsInForce(doc, s.from)
    };
  } else if (w.tag === 'terms' && what.tag === 'terms') {
    out.funding = { ...DEFAULT_POLICY.funding, terms: what.terms };
  }
  return out;
}

type Read = { policy: Policy } | { refused: string };

const withSpan = (p: Policy, i: number, s: Span): Policy => ({
  ...p,
  spans: p.spans.map((x, j) => (j === i ? s : x))
});

/** Every added pool id, programme id and scale key in the document (parse4's union counts). */
function documentIds(doc: SimPolicy4): {
  pools: Set<string>;
  programmes: Set<string>;
  scales: Set<string>;
} {
  const pools = new Set<string>();
  const programmes = new Set<string>();
  const scales = new Set<string>();
  for (const p of doc.kinds.money) {
    if (p.where.tag === 'fund' && p.where.pool.startsWith('u-')) pools.add(p.where.pool);
    for (const s of p.spans) {
      if (s.what.tag === 'fund') {
        if (s.what.pool) pools.add(s.what.pool.id);
        s.what.programmes.forEach((g) => programmes.add(g.id));
      } else if (s.what.tag === 'scales') {
        s.what.entries.forEach((e) => scales.add(`${e.pool}\u0000${e.from}`));
      }
    }
  }
  return { pools, programmes, scales };
}

/** The default labels a timing policy carries for `set`: today's names for it. */
function isDefaultTimingLabel(label: string, set: TimingSet): boolean {
  return (
    label === CUSTOM_TIMING_LABEL ||
    label === timingLabel(set) ||
    label === PRESETS.find((x) => x.id === set.preset)?.name
  );
}

function readTiming(p: Policy, si: number, old: TimingSet, set: TimingSet): Read {
  if (
    set.preset !== p.preset &&
    p.spans.some((x, i) => i !== si && x.what.tag === 'timing' && x.what.set.preset !== set.preset)
  )
    return { refused: PRESET_PER_POLICY };
  const relabel = isDefaultTimingLabel(p.label, old) && timingLabel(set) !== timingLabel(old);
  return {
    policy: withSpan(
      { ...p, preset: set.preset, label: relabel ? timingLabel(set) : p.label },
      si,
      { ...p.spans[si], what: { tag: 'timing', set } }
    )
  };
}

/**
 * A fund span's read-back. The pool is this span's, its id and debt terms kept (ruling OQ-2; a
 * pool the editor removed stays: removing the policy is the Inspector's Remove). The programme
 * set is the policy's: an added programme joins every span (renamed if its id is taken anywhere in
 * the document), a removed one leaves every span; field edits stay in this span.
 */
function readFund(doc: SimPolicy4, p: Policy, si: number, q: SimPolicy): Read {
  const s = p.spans[si];
  if (s.what.tag !== 'fund' || p.where.tag !== 'fund') return { policy: p };
  const what = s.what;
  const poolId = p.where.pool;
  const next = q.funding.pools.find((x) => x.id === poolId) ?? q.funding.pools[0];
  const pool =
    what.pool === null
      ? null
      : next
        ? { ...next, id: what.pool.id, debt: what.pool.debt }
        : what.pool;

  const had = new Set(what.programmes.map((g) => g.id));
  const ids = documentIds(doc);
  const used = new Set([...ids.pools, ...ids.programmes]);
  const added: Programme[] = [];
  const programmes = q.funding.programmes.map((g) => {
    if (had.has(g.id)) return g;
    let id = g.id;
    if (used.has(id)) {
      const base = /^(.*)-\d+$/.exec(id)?.[1] ?? id;
      let n = 1;
      while (used.has(`${base}-${n}`)) n++;
      id = `${base}-${n}`;
    }
    used.add(id);
    const out = id === g.id ? g : { ...g, id };
    added.push(out);
    return out;
  });
  const kept = new Set(programmes.map((g) => g.id));
  const spans = p.spans.map((x, i): Span => {
    if (i === si) return { ...x, what: { tag: 'fund', pool, programmes } };
    if (x.what.tag !== 'fund') return x;
    const left = x.what.programmes.filter((g) => kept.has(g.id));
    if (left.length === x.what.programmes.length && added.length === 0) return x;
    return { ...x, what: { ...x.what, programmes: [...left, ...added] } };
  });
  return { policy: { ...p, spans } };
}

/** The policy as `q` (the edited projection of span `si`) leaves it, or a refusal. */
function readBack(doc: SimPolicy4, p: Policy, si: number, q: SimPolicy): Read {
  const s = p.spans[si];
  const w = p.where;
  const what = s.what;
  const span = (x: Span['what']) => ({ policy: withSpan(p, si, { ...s, what: x }) });
  if (w.tag === 'transit' && what.tag === 'bands') {
    const rule = q.rules.find((r) => r.id === p.id) ?? q.rules[0];
    if (!rule) return { policy: { ...p, on: false } };
    return {
      policy: withSpan(
        { ...p, on: true, where: { tag: 'transit', stopTypes: rule.stopTypes } },
        si,
        { ...s, what: { tag: 'bands', bands: rule.bands } }
      )
    };
  }
  if (w.tag === 'painted' && what.tag === 'brushes')
    return span({ tag: 'brushes', brushes: q.custom });
  if (w.tag === 'category' && what.tag === 'protect') {
    if (w.category !== 'newerThan') return { policy: { ...p, on: q.protect[w.category] } };
    const years = q.protect.newerThanYears;
    if (years === null) return { policy: { ...p, on: false } };
    return { policy: withSpan({ ...p, on: true }, si, { ...s, what: { tag: 'protect', years } }) };
  }
  if (w.tag === 'routes' && what.tag === 'timing')
    return readTiming(p, si, what.set, q.timing.current);
  if (w.tag === 'baseline' && what.tag === 'scales')
    return span({ tag: 'scales', entries: q.funding.baselineScale });
  if (w.tag === 'fund' && what.tag === 'fund') return readFund(doc, p, si, q);
  if (w.tag === 'terms' && what.tag === 'terms')
    return span({ tag: 'terms', terms: q.funding.terms });
  return { policy: p };
}

/** A limit of F7 the edit passes over the document (and grows past), as today's message. */
function limitRefusal(before: SimPolicy4, after: SimPolicy4): string | null {
  const a = documentIds(before);
  const b = documentIds(after);
  const over = (k: 'pools' | 'programmes' | 'scales', limit: number) =>
    b[k].size > limit && b[k].size > a[k].size;
  if (over('pools', FINANCE_LIMITS.pools)) return limitAlert('pools');
  if (over('programmes', FINANCE_LIMITS.programmes)) return limitAlert('programmes');
  if (over('scales', FINANCE_LIMITS.baselineScale)) return limitAlert('baselineScale');
  return null;
}

/**
 * The document with the span at `ref` read from `q`, or the same document and the reason when
 * the edit is refused. The same document object comes back when nothing changes.
 */
export function tryWriteBack(
  doc: SimPolicy4,
  ref: SpanRef,
  q: SimPolicy
): { doc: SimPolicy4; refused: string | null } {
  const at = locate(doc, ref);
  if (!at) return { doc, refused: null };
  const { p } = at;
  const r = readBack(doc, p, ref.span, q);
  if ('refused' in r) return { doc, refused: r.refused };
  if (canonicalJson(r.policy) === canonicalJson(p)) return { doc, refused: null };
  // Spans whose content is unchanged keep their identity.
  const policy: Policy = {
    ...r.policy,
    spans: r.policy.spans.map((x, i) =>
      canonicalJson(x) === canonicalJson(p.spans[i]) ? p.spans[i] : x
    )
  };
  if (canonicalJson(policy.spans) === canonicalJson(p.spans)) policy.spans = p.spans;
  // An edit to what a given measure pays makes it the player's own measure; the label stays.
  if (
    ref.kind === 'money' &&
    p.preset !== null &&
    canonicalJson(policy.spans.map((s) => s.what)) !== canonicalJson(p.spans.map((s) => s.what))
  )
    policy.preset = null;
  const next: SimPolicy4 = {
    ...doc,
    kinds: {
      ...doc.kinds,
      [ref.kind]: doc.kinds[ref.kind].map((x) => (x.id === p.id ? policy : x))
    }
  };
  const refused = limitRefusal(doc, next);
  return refused === null ? { doc: next, refused: null } : { doc, refused };
}

/** `tryWriteBack`'s document: unchanged when the edit is refused. */
export function writeBack(doc: SimPolicy4, ref: SpanRef, q: SimPolicy): SimPolicy4 {
  return tryWriteBack(doc, ref, q).doc;
}

/**
 * Today's editors on the span `ref()` names, applied as one change to the document store.
 * `policy` is the same object while the document and the ref are unchanged.
 */
export function spanLens(
  store: {
    readonly policy: SimPolicy4;
    apply(c: (p: SimPolicy4) => SimPolicy4, label: string, coalesce?: string): void;
    undo(): string | null;
    redo(): string | null;
  },
  ref: () => SpanRef | null
): SpanLens {
  let memo: { doc: SimPolicy4; key: string; policy: SimPolicy } | null = null;
  let refused: string | null = null;
  return {
    get policy() {
      const r = ref();
      if (!r) return DEFAULT_POLICY;
      const doc = store.policy;
      const key = `${r.kind}\u0000${r.id}\u0000${r.span}`;
      if (memo?.doc !== doc || memo.key !== key) memo = { doc, key, policy: project(doc, r) };
      return memo.policy;
    },
    get refused() {
      return refused;
    },
    apply(change, label, coalesce) {
      const r = ref();
      if (!r) return true;
      let why: string | null = null;
      store.apply(
        (d) => {
          const out = tryWriteBack(d, r, change(project(d, r)));
          why = out.refused;
          return out.doc;
        },
        label,
        coalesce
      );
      refused = why;
      return why === null;
    },
    undo: () => store.undo(),
    redo: () => store.redo()
  };
}
