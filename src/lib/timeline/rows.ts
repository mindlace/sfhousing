/**
 * Pure helpers for the timeline's rows (timeline-ui spec, rules 5 to 8): the fixed rows' refs, the
 * short setting a bar carries, the label a bar announces, and the hatch's position. No Svelte, no DOM.
 */
import type { Calibration } from '$lib/timelapse/types';
import type { Day } from '$lib/timelapse/time';
import { monthFirstDay, monthLastDay } from '$lib/sim/world/months';
import type { Effect, PolicyKind, Span } from './policy4';
import type { SpanRef } from './spans';
import { spanMonths } from './spans';

/**
 * A fixed row's selection, carried as a `SpanRef` (Timeline's `selected` and `onselect` stay
 * `SpanRef | null`). Contract for the inspector:
 * - `id` is `FIXED_ID` for a kind's fixed row ("Current law", "Current timelines", "Current funding";
 *   `kind` is that kind) and `MARKET_ID` for "Market conditions"
 *   (`{ kind: 'money', id: MARKET_ID }`). Both have `span` FIXED_SPAN (-1), an index no policy has.
 * - The market ref's `kind` is always 'money', even when the Public money kind is absent (no
 *   market and baseline funding): "The world" row is always drawn, so it can still be selected.
 * - `isFixedRef(ref)` is true only for `span === FIXED_SPAN` and one of the two ids, so a document
 *   policy that happens to be named 'fixed' or 'fixed-market' (spans 0 and up) is never taken for a
 *   fixed row. Test it before any policy lookup; a fixed ref names no policy, span or edit, and its
 *   view is read-only.
 */
export const FIXED_ID = 'fixed';
export const MARKET_ID = 'fixed-market';

export const FIXED_SPAN = -1;

export const fixedRef = (kind: PolicyKind): SpanRef => ({ kind, id: FIXED_ID, span: FIXED_SPAN });
export const marketRef = (): SpanRef => ({ kind: 'money', id: MARKET_ID, span: FIXED_SPAN });
export const isFixedRef = (r: SpanRef | null): boolean =>
  r !== null && r.span === FIXED_SPAN && (r.id === FIXED_ID || r.id === MARKET_ID);

export const KIND_LABEL: Record<PolicyKind, string> = {
  zoning: 'Zoning',
  permitting: 'Permitting',
  money: 'Public money'
};

export const FIXED_LABEL: Record<PolicyKind, string> = {
  zoning: 'Current law',
  permitting: 'Current timelines',
  money: 'Current funding'
};

/** The inspector's sentence under a fixed row: what the baseline is. */
export const FIXED_NOTE: Record<PolicyKind, string> = {
  zoning: 'Current law is the Family Zoning Plan as adopted.',
  permitting: 'Current timelines are permitting times as observed in SF Planning and DBI records.',
  money: "Current funding is today's City, state and federal money for affordable homes."
};

/** A closed kind with no policy says in its lane what "+" adds (a pointer-only duplicate of it). */
export const EMPTY_LANE: Record<PolicyKind, string> = {
  zoning: 'Add a zoning change',
  permitting: 'Add a permitting change',
  money: 'Add public money'
};

export const MARKET_LABEL = 'Market conditions';

/** Rule 8: the data can run money. */
export const hasMoney = (cal: Calibration): boolean =>
  cal.market !== undefined && cal.baselineFunding !== undefined;

/** The market bar's text: today's market when the calibration has a model, else the long-run average. */
export function marketText(cal: Calibration, level: 'all' | 'private'): string {
  return cal.market
    ? `Today's market, ${level === 'private' ? 'private starts only' : 'all starts'}`
    : '2007 to 2025 average';
}

/** "$500M", "$1.5B", "$250K". */
export function compactDollars(n: number): string {
  const a = Math.abs(n);
  const f = (v: number, unit: string) => `$${Number(v.toPrecision(3))}${unit}`;
  if (a >= 1e9) return f(a / 1e9, 'B');
  if (a >= 1e6) return f(a / 1e6, 'M');
  if (a >= 1e3) return f(a / 1e3, 'K');
  return `$${Math.round(a)}`;
}

/** The short setting a span carries on its bar ("30% faster", "$500M"). */
export function settingOf(e: Effect): string {
  switch (e.tag) {
    case 'bands': {
      const top = Math.max(0, ...e.bands.map((b) => b.stories));
      return top > 0 ? `up to ${top} stories` : 'In force';
    }
    case 'brushes': {
      const n = e.brushes.length;
      return n === 0 ? 'No area yet' : `${n} ${n === 1 ? 'area' : 'areas'}`;
    }
    case 'protect':
      return e.years === null ? 'Protected' : `Newer than ${e.years} years`;
    case 'timing': {
      const scales = [...e.set.presetTimers, ...e.set.edits].map((t) => t.scale);
      if (scales.length === 0) return 'As observed';
      const s = Math.min(...scales);
      return s < 1
        ? `${Math.round((1 - s) * 100)}% faster`
        : `${Math.round((s - 1) * 100)}% slower`;
    }
    case 'scales': {
      const last = e.entries[e.entries.length - 1];
      return last ? `${Number(last.scale.toPrecision(3))}x scale` : 'In force';
    }
    case 'fund': {
      const pool = e.pool;
      if (!pool) return e.programmes.length ? 'Programme' : 'In force';
      let total = 0;
      let yearly = false;
      for (const i of pool.inflows) {
        if (i.kind === 'once') total += i.dollars;
        else {
          total += i.dollarsPerYear;
          yearly = true;
        }
      }
      return `${compactDollars(total)}${yearly ? ' a year' : ''}`;
    }
    case 'terms': {
      const n = Object.keys(e.terms).length;
      return `${n} ${n === 1 ? 'term' : 'terms'}`;
    }
  }
}

/** Where a day sits across the window, 0 to 100. */
export function dayPct(day: Day, asOf: Day, windowEnd: Day): number {
  const span = Math.max(windowEnd - asOf, 1);
  return Math.min(Math.max((day - asOf) / span, 0), 1) * 100;
}

/** A span's left edge and width across the window, in percent; an open end reaches 100. */
export function barBox(s: Span, asOf: Day, windowEnd: Day): { left: number; width: number } {
  const m = spanMonths(s, asOf);
  const left = dayPct(monthFirstDay(asOf, m.from), asOf, windowEnd);
  const right = m.to === null ? 100 : dayPct(monthLastDay(asOf, m.to), asOf, windowEnd);
  return { left, width: Math.max(right - left, 0.4) };
}

const edgeFormat = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC'
});

/**
 * A span edge's date, "10 Dec 2030": day, short month, year (the page's en-US names, read in UTC).
 * Spans snap to model months, which start on the dataset date's day, not on the 1st, so an edge
 * reads as a date, never as a calendar month (main's I2 ruling).
 */
export function formatEdge(day: Day): string {
  const p = Object.fromEntries(
    edgeFormat.formatToParts(new Date(day * 86_400_000)).map((x) => [x.type, x.value])
  );
  return `${p.day} ${p.month} ${p.year}`;
}

/**
 * A span's edges as text, the one place they are written: the start date of its first model month,
 * and the last day of its last one (the end is inclusive), or "no end".
 */
export function spanEdgeText(s: Span, asOf: Day): { from: string; to: string } {
  const m = spanMonths(s, asOf);
  return {
    from: formatEdge(monthFirstDay(asOf, m.from)),
    to: m.to === null ? 'no end' : formatEdge(monthLastDay(asOf, m.to))
  };
}

/**
 * A span bar's name: '{setting}{left}, {label}, {from} to {to}' then ', off' when off. It starts
 * with the words the bar shows (its setting, then ", N% left"), so a voice user can say what they
 * see (WCAG 2.5.3).
 */
export function barLabel(
  setting: string,
  label: string,
  s: Span,
  asOf: Day,
  extra: { off?: boolean; left?: string | null } = {}
): string {
  const { from, to } = spanEdgeText(s, asOf);
  return `${setting}${extra.left ?? ''}, ${label}, ${from} to ${to}${extra.off ? ', off' : ''}`;
}

/** A fixed bar's name (a kind's fixed row, the world row): '{text}{left}, {label}, whole window'. */
export function fixedLabel(text: string, label: string, left?: string | null): string {
  return `${text}${left ?? ''}, ${label}, whole window`;
}
