/**
 * Span and policy edits for the timeline editor (timeline-ui spec, rules 4 and 11). Every edit
 * works in model months, writes days with `monthFirstDay` / `monthLastDay`, and returns the same
 * document when nothing changes. Pure TS: no Svelte, no DOM. It guarantees span structure only:
 * snapped months, order, no overlap, bounds. Programme terms (money) are reconciled where an edit
 * is committed, not here.
 */
import { monthFirstDay, monthLastDay, monthOfDay } from '$lib/sim/world/months';
import type { Day } from '$lib/timelapse/time';
import type { Policy, PolicyKind, SimPolicy4, Span } from './policy4';

export interface SpanRef {
  kind: PolicyKind;
  id: string;
  span: number;
}

/** The editable window: model months 1..months after `asOf` (months = WINDOW_MONTHS). */
export interface TimelineWindow {
  asOf: Day;
  months: number;
}

export function policyOf(doc: SimPolicy4, kind: PolicyKind, id: string): Policy | undefined {
  return doc.kinds[kind].find((p) => p.id === id);
}

/** The model months of a span's first and last day; `to` is null while the span is open. */
export function spanMonths(s: Span, asOf: Day): { from: number; to: number | null } {
  return {
    from: Math.max(1, monthOfDay(asOf, s.from)),
    to: s.to === null ? null : Math.max(1, monthOfDay(asOf, s.to))
  };
}

function withPolicy(doc: SimPolicy4, kind: PolicyKind, id: string, p: Policy): SimPolicy4 {
  return {
    ...doc,
    kinds: { ...doc.kinds, [kind]: doc.kinds[kind].map((q) => (q.id === id ? p : q)) }
  };
}

function withSpans(doc: SimPolicy4, kind: PolicyKind, id: string, spans: Span[]): SimPolicy4 {
  const p = policyOf(doc, kind, id);
  return p ? withPolicy(doc, kind, id, { ...p, spans }) : doc;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The span at `ref` with its months and the room the neighbours and the window leave it. */
function locate(doc: SimPolicy4, ref: SpanRef, w: TimelineWindow) {
  const p = policyOf(doc, ref.kind, ref.id);
  const s = p?.spans[ref.span];
  if (!p || !s) return undefined;
  const cur = spanMonths(s, w.asOf);
  const prev = p.spans[ref.span - 1];
  const next = p.spans[ref.span + 1];
  // A shared document may hold a span past the window: the room never lies behind the span itself.
  const minFrom = Math.min(prev ? (spanMonths(prev, w.asOf).to ?? 0) + 1 : 1, cur.from);
  const maxTo = Math.max(next ? spanMonths(next, w.asOf).from - 1 : w.months, cur.to ?? cur.from);
  return { p, s, cur, minFrom, maxTo, hasNext: next !== undefined };
}

function replaceSpan(doc: SimPolicy4, ref: SpanRef, s: Span, before: Span): SimPolicy4 {
  if (s.from === before.from && s.to === before.to) return doc;
  const p = policyOf(doc, ref.kind, ref.id)!;
  return withSpans(
    doc,
    ref.kind,
    ref.id,
    p.spans.map((x, i) => (i === ref.span ? s : x))
  );
}

export function setFrom(
  doc: SimPolicy4,
  ref: SpanRef,
  month: number,
  w: TimelineWindow
): SimPolicy4 {
  const l = locate(doc, ref, w);
  if (!l) return doc;
  const m = clamp(Math.round(month), l.minFrom, l.cur.to ?? l.maxTo);
  return replaceSpan(doc, ref, { ...l.s, from: monthFirstDay(w.asOf, m) }, l.s);
}

export function setTo(
  doc: SimPolicy4,
  ref: SpanRef,
  month: number | null,
  w: TimelineWindow
): SimPolicy4 {
  const l = locate(doc, ref, w);
  if (!l) return doc;
  if (month === null && !l.hasNext) return replaceSpan(doc, ref, { ...l.s, to: null }, l.s);
  const m = clamp(month === null ? l.maxTo : Math.round(month), l.cur.from, l.maxTo);
  return replaceSpan(doc, ref, { ...l.s, to: monthLastDay(w.asOf, m) }, l.s);
}

export function moveEdge(
  doc: SimPolicy4,
  ref: SpanRef,
  edge: 'from' | 'to',
  by: number,
  w: TimelineWindow
): SimPolicy4 {
  const l = locate(doc, ref, w);
  if (!l) return doc;
  if (edge === 'from') return setFrom(doc, ref, l.cur.from + by, w);
  return l.cur.to === null ? doc : setTo(doc, ref, l.cur.to + by, w);
}

/** Shift the whole span by `by` months, stopping at the window and the neighbours. */
export function moveSpan(doc: SimPolicy4, ref: SpanRef, by: number, w: TimelineWindow): SimPolicy4 {
  const l = locate(doc, ref, w);
  if (!l) return doc;
  const lo = l.minFrom - l.cur.from;
  const hi = l.maxTo - (l.cur.to ?? l.cur.from);
  const shift = clamp(Math.round(by), lo, hi);
  if (shift === 0) return doc;
  return replaceSpan(
    doc,
    ref,
    {
      ...l.s,
      from: monthFirstDay(w.asOf, l.cur.from + shift),
      to: l.cur.to === null ? null : monthLastDay(w.asOf, l.cur.to + shift)
    },
    l.s
  );
}

/** The edge nearer the playhead's month; a tie or an open end gives 'from'. */
export function nearerEdge(s: Span, playheadMonth: number, asOf: Day): 'from' | 'to' {
  const m = spanMonths(s, asOf);
  if (m.to === null) return 'from';
  return Math.abs(playheadMonth - m.to) < Math.abs(playheadMonth - m.from) ? 'to' : 'from';
}

/** Split at month `atMonth` into `[from, atMonth-1]` and `[atMonth, to]`. */
export function splitSpan(
  doc: SimPolicy4,
  ref: SpanRef,
  atMonth: number,
  w: TimelineWindow
): SimPolicy4 {
  const l = locate(doc, ref, w);
  if (!l) return doc;
  const a = Math.round(atMonth);
  if (a <= l.cur.from || a > (l.cur.to ?? w.months)) return doc;
  const head: Span = {
    from: l.s.from,
    to: monthLastDay(w.asOf, a - 1),
    what: structuredClone(l.s.what)
  };
  const tail: Span = {
    from: monthFirstDay(w.asOf, a),
    to: l.s.to,
    what: structuredClone(l.s.what)
  };
  const spans = [...l.p.spans];
  spans.splice(ref.span, 1, head, tail);
  return withSpans(doc, ref.kind, ref.id, spans);
}

/**
 * Add a span starting at `fromMonth` (or the nearest free month), ending the month before the next
 * span or open. Its effect is a copy of the nearest earlier span's, else the first span's.
 * `span` is the new span's index, or -1 when nothing was added.
 */
export function addSpan(
  doc: SimPolicy4,
  kind: PolicyKind,
  id: string,
  fromMonth: number,
  w: TimelineWindow
): { doc: SimPolicy4; span: number } {
  const p = policyOf(doc, kind, id);
  if (!p || p.spans.length === 0) return { doc, span: -1 };
  const ms = p.spans.map((s) => spanMonths(s, w.asOf));
  const free = (m: number) => !ms.some((r) => m >= r.from && m <= (r.to ?? Infinity));
  const want = clamp(Math.round(fromMonth), 1, w.months);
  let start = -1;
  for (let m = want; m <= w.months && start < 0; m++) if (free(m)) start = m;
  for (let m = want - 1; m >= 1 && start < 0; m--) if (free(m)) start = m;
  if (start < 0) return { doc, span: -1 };
  let at = ms.findIndex((r) => r.from > start);
  if (at < 0) at = p.spans.length;
  const source = p.spans[at - 1] ?? p.spans[0];
  const created: Span = {
    from: monthFirstDay(w.asOf, start),
    to: at < p.spans.length ? monthLastDay(w.asOf, ms[at].from - 1) : null,
    what: structuredClone(source.what)
  };
  const spans = [...p.spans];
  spans.splice(at, 0, created);
  return { doc: withSpans(doc, kind, id, spans), span: at };
}

/** Remove one span; a policy's only span stays (Remove removes the policy). */
export function removeSpan(doc: SimPolicy4, ref: SpanRef): SimPolicy4 {
  const p = policyOf(doc, ref.kind, ref.id);
  if (!p || p.spans.length < 2 || !p.spans[ref.span]) return doc;
  return withSpans(
    doc,
    ref.kind,
    ref.id,
    p.spans.filter((_, i) => i !== ref.span)
  );
}

export function setOn(doc: SimPolicy4, kind: PolicyKind, id: string, on: boolean): SimPolicy4 {
  const p = policyOf(doc, kind, id);
  if (!p || p.on === on) return doc;
  return withPolicy(doc, kind, id, { ...p, on });
}

export function removePolicy(doc: SimPolicy4, kind: PolicyKind, id: string): SimPolicy4 {
  if (!policyOf(doc, kind, id)) return doc;
  return { ...doc, kinds: { ...doc.kinds, [kind]: doc.kinds[kind].filter((p) => p.id !== id) } };
}

/** Swap with the neighbour in the kind's list; a no-op at either end. */
export function movePolicy(doc: SimPolicy4, kind: PolicyKind, id: string, dir: -1 | 1): SimPolicy4 {
  const list = doc.kinds[kind];
  const i = list.findIndex((p) => p.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return doc;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return { ...doc, kinds: { ...doc.kinds, [kind]: next } };
}

/**
 * Keyboard moves on a focused bar: Arrow Left/Right move the nearer edge one month (Shift: twelve);
 * with Alt they move the whole span.
 */
export function barKey(
  e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'altKey'>,
  s: Span,
  playheadMonth: number,
  asOf: Day
): { op: 'edge'; edge: 'from' | 'to'; by: number } | { op: 'span'; by: number } | null {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return null;
  const by = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 12 : 1);
  if (e.altKey) return { op: 'span', by };
  return { op: 'edge', edge: nearerEdge(s, playheadMonth, asOf), by };
}
