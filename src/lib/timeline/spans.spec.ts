import { describe, expect, it } from 'vitest';
import { baselineFixture } from '$lib/sim/levers/fixtures/finance';
import miniCalibrationJson from '$lib/sim/scenario/fixtures/mini-calibration.json';
import { miniMarket } from '$lib/sim/scenario/fixtures/mini-market';
import { monthFirstDay, monthLastDay } from '$lib/sim/world/months';
import { parseCalibration } from '$lib/timelapse/model';
import type { Calibration } from '$lib/timelapse/types';
import type { Policy, SimPolicy4, Span } from './policy4';
import { reconcilePolicy4 } from './reconcile4';
import {
  addSpan,
  barKey,
  movePolicy,
  moveEdge,
  moveSpan,
  nearerEdge,
  policyOf,
  removePolicy,
  removeSpan,
  setFrom,
  setOn,
  setTo,
  spanMonths,
  splitSpan,
  type SpanRef,
  type TimelineWindow
} from './spans';

const miniCal = parseCalibration(structuredClone(miniCalibrationJson) as unknown);
const cal: Calibration = {
  ...miniCal,
  market: miniMarket(),
  baselineFunding: baselineFixture().baselineFunding
};

const asOf = 100;
const w: TimelineWindow = { asOf, months: 480 };
const first = (m: number) => monthFirstDay(asOf, m);
const last = (m: number) => monthLastDay(asOf, m);

const sp = (from: number, to: number | null, years: number | null = 5): Span => ({
  from: first(from),
  to: to === null ? null : last(to),
  what: { tag: 'protect', years }
});
const pol = (id: string, spans: Span[]): Policy => ({
  id,
  label: id,
  preset: null,
  on: true,
  where: { tag: 'painted' },
  spans
});
const mk = (...zoning: Policy[]): SimPolicy4 => ({
  schema: 4,
  kinds: { zoning, permitting: [], money: [] }
});

const doc = mk(pol('a', [sp(1, 12)]));
const two = mk(pol('a', [sp(3, 10), sp(20, 30, 9)]), pol('b', [sp(5, null)]));
const ref0: SpanRef = { kind: 'zoning', id: 'a', span: 0 };
const ref1: SpanRef = { kind: 'zoning', id: 'a', span: 1 };
const months = (d: SimPolicy4, r: SpanRef) =>
  spanMonths(policyOf(d, r.kind, r.id)!.spans[r.span], asOf);

describe('spanMonths and policyOf', () => {
  it('reads model months; open end is null', () => {
    expect(months(two, ref0)).toEqual({ from: 3, to: 10 });
    expect(months(two, { kind: 'zoning', id: 'b', span: 0 })).toEqual({ from: 5, to: null });
    expect(policyOf(two, 'zoning', 'zz')).toBeUndefined();
  });
});

describe('setFrom and setTo', () => {
  it('snaps to real month first and last days', () => {
    const d = setFrom(two, ref0, 5, w);
    expect(policyOf(d, 'zoning', 'a')!.spans[0].from).toBe(first(5));
    const e = setTo(two, ref0, 12, w);
    expect(policyOf(e, 'zoning', 'a')!.spans[0].to).toBe(last(12));
    expect(two.kinds.zoning[0].spans[0].from).toBe(first(3));
  });
  it('clamps at the neighbour, the window and the other edge', () => {
    expect(months(setTo(two, ref0, 99, w), ref0).to).toBe(19);
    expect(months(setFrom(two, ref1, 2, w), ref1).from).toBe(11);
    expect(months(setFrom(two, ref0, 50, w), ref0).from).toBe(10);
    expect(months(setTo(two, ref1, 9999, w), ref1).to).toBe(480);
  });
  it('opens and closes the last span', () => {
    expect(months(setTo(two, ref1, null, w), ref1).to).toBeNull();
    expect(months(setTo(two, ref0, null, w), ref0).to).toBe(19);
  });
  it('returns the same document when nothing changes', () => {
    expect(setFrom(two, ref0, 3, w)).toBe(two);
    expect(setTo(two, ref0, 10, w)).toBe(two);
    expect(setFrom(two, { ...ref0, id: 'nope' }, 3, w)).toBe(two);
  });
});

describe('moveEdge and moveSpan', () => {
  it('moves an edge by months', () => {
    expect(months(moveEdge(two, ref0, 'from', 2, w), ref0).from).toBe(5);
    expect(months(moveEdge(two, ref0, 'to', -3, w), ref0).to).toBe(7);
  });
  it('an open end does not move', () => {
    expect(moveEdge(two, { kind: 'zoning', id: 'b', span: 0 }, 'to', 5, w)).toBe(two);
  });
  it('moves the whole span, keeping its length', () => {
    expect(months(moveSpan(two, ref0, 4, w), ref0)).toEqual({ from: 7, to: 14 });
  });
  it('moves an open span by its start', () => {
    const r: SpanRef = { kind: 'zoning', id: 'b', span: 0 };
    expect(months(moveSpan(two, r, 3, w), r)).toEqual({ from: 8, to: null });
  });
  it('clamps: no from on or before the dataset date, none past the window, no overlap', () => {
    expect(moveEdge(doc, ref0, 'from', -1, w)).toBe(doc);
    expect(moveSpan(two, ref0, -500, w)).not.toBe(two);
    expect(months(moveSpan(two, ref0, -500, w), ref0)).toEqual({ from: 1, to: 8 });
    expect(months(moveSpan(two, ref0, 500, w), ref0).to).toBe(months(two, ref1).from - 1);
    expect(months(moveSpan(two, ref1, 500, w), ref1).to).toBe(480);
    expect(moveSpan(doc, ref0, -3, w)).toBe(doc);
  });
});

describe('nearerEdge', () => {
  const s = sp(10, 20);
  it('picks the edge nearer the playhead; ties and open ends go to from', () => {
    expect(nearerEdge(s, 11, asOf)).toBe('from');
    expect(nearerEdge(s, 19, asOf)).toBe('to');
    expect(nearerEdge(s, 15, asOf)).toBe('from');
    expect(nearerEdge(s, 40, asOf)).toBe('to');
    expect(nearerEdge(sp(10, null), 400, asOf)).toBe('from');
  });
});

describe('splitSpan', () => {
  it('splits into two spans with their own copies of the effect', () => {
    const d = splitSpan(two, ref0, 6, w);
    const spans = policyOf(d, 'zoning', 'a')!.spans;
    expect(spans.map((s) => spanMonths(s, asOf))).toEqual([
      { from: 3, to: 5 },
      { from: 6, to: 10 },
      { from: 20, to: 30 }
    ]);
    expect(spans[0].what).toEqual(spans[1].what);
    expect(spans[0].what).not.toBe(spans[1].what);
  });
  it('splits an open span', () => {
    const r: SpanRef = { kind: 'zoning', id: 'b', span: 0 };
    const spans = policyOf(splitSpan(two, r, 9, w), 'zoning', 'b')!.spans;
    expect(spans.map((s) => spanMonths(s, asOf))).toEqual([
      { from: 5, to: 8 },
      { from: 9, to: null }
    ]);
  });
  it('refuses a month outside (from, to]', () => {
    expect(splitSpan(two, ref0, 3, w)).toBe(two);
    expect(splitSpan(two, ref0, 11, w)).toBe(two);
  });
});

describe('addSpan', () => {
  it('ends the month before the next span and copies the nearest earlier effect', () => {
    const r = addSpan(two, 'zoning', 'a', 12, w);
    expect(r.span).toBe(1);
    const spans = policyOf(r.doc, 'zoning', 'a')!.spans;
    expect(spanMonths(spans[1], asOf)).toEqual({ from: 12, to: 19 });
    expect(spans[1].what).toEqual({ tag: 'protect', years: 5 });
  });
  it('appends open, copying the last earlier span', () => {
    const r = addSpan(two, 'zoning', 'a', 40, w);
    expect(r.span).toBe(2);
    const s = policyOf(r.doc, 'zoning', 'a')!.spans[2];
    expect(spanMonths(s, asOf)).toEqual({ from: 40, to: null });
    expect(s.what).toEqual({ tag: 'protect', years: 9 });
  });
  it('before the first span it copies the first', () => {
    const r = addSpan(two, 'zoning', 'a', 1, w);
    expect(r.span).toBe(0);
    expect(spanMonths(policyOf(r.doc, 'zoning', 'a')!.spans[0], asOf)).toEqual({ from: 1, to: 2 });
  });
  it('starting inside a span moves to the next free month', () => {
    const r = addSpan(two, 'zoning', 'a', 5, w);
    expect(spanMonths(policyOf(r.doc, 'zoning', 'a')!.spans[r.span], asOf).from).toBe(11);
  });
  it('does nothing for an unknown policy', () => {
    const r = addSpan(two, 'zoning', 'zz', 5, w);
    expect(r).toEqual({ doc: two, span: -1 });
  });
});

describe('removeSpan, setOn, removePolicy, movePolicy', () => {
  it('removes a span but never the only one', () => {
    expect(policyOf(removeSpan(two, ref0), 'zoning', 'a')!.spans).toHaveLength(1);
    expect(removeSpan(doc, ref0)).toBe(doc);
  });
  it('switches a policy on and off', () => {
    const off = setOn(two, 'zoning', 'a', false);
    expect(policyOf(off, 'zoning', 'a')!.on).toBe(false);
    expect(setOn(off, 'zoning', 'a', false)).toBe(off);
    expect(setOn(two, 'zoning', 'a', true)).toBe(two);
  });
  it('removes a policy', () => {
    expect(removePolicy(two, 'zoning', 'a').kinds.zoning.map((p) => p.id)).toEqual(['b']);
    expect(removePolicy(two, 'zoning', 'zz')).toBe(two);
  });
  it('moves a policy within its kind; ends are no-ops', () => {
    expect(movePolicy(two, 'zoning', 'a', 1).kinds.zoning.map((p) => p.id)).toEqual(['b', 'a']);
    expect(movePolicy(two, 'zoning', 'a', -1)).toBe(two);
    expect(movePolicy(two, 'zoning', 'b', 1)).toBe(two);
  });
});

describe('barKey', () => {
  const s = sp(1, 12);
  const k = (key: string, shiftKey = false, altKey = false) => ({ key, shiftKey, altKey });
  it('arrows move the nearer edge by a month, Shift by a year, Alt the whole span', () => {
    expect(barKey(k('ArrowRight', true), s, 2, asOf)).toEqual({ op: 'edge', edge: 'from', by: 12 });
    expect(barKey(k('ArrowLeft', false, true), s, 2, asOf)).toEqual({ op: 'span', by: -1 });
    expect(barKey(k('ArrowLeft', true, true), s, 2, asOf)).toEqual({ op: 'span', by: -12 });
    expect(barKey(k('ArrowLeft'), s, 11, asOf)).toEqual({ op: 'edge', edge: 'to', by: -1 });
  });
  it('ignores other keys', () => {
    expect(barKey(k('Enter'), s, 2, asOf)).toBeNull();
    expect(barKey(k('ArrowUp'), s, 2, asOf)).toBeNull();
  });
});

describe('every op yields a span-reconciled document', () => {
  it('reconcilePolicy4 returns each result as is', () => {
    const nexts = [
      setFrom(two, ref0, 5, w),
      setTo(two, ref0, 12, w),
      moveEdge(two, ref1, 'from', -2, w),
      moveSpan(two, ref0, 4, w),
      splitSpan(two, ref0, 6, w),
      addSpan(two, 'zoning', 'a', 12, w).doc,
      removeSpan(two, ref0),
      setOn(two, 'zoning', 'a', false),
      removePolicy(two, 'zoning', 'b'),
      movePolicy(two, 'zoning', 'a', 1),
      // clamped results
      moveSpan(two, ref0, -500, w),
      moveSpan(two, ref0, 500, w),
      moveSpan(two, ref1, 500, w),
      setTo(two, ref0, 99, w),
      setFrom(two, ref1, 2, w)
    ];
    for (const next of nexts) {
      expect(next).not.toBe(two);
      expect(reconcilePolicy4(next, cal, asOf).doc).toBe(next);
    }
  });
});

describe('spans past the window never move backwards', () => {
  const past = mk(pol('a', [sp(10, 20), sp(485, 490), sp(500, null)]));
  const r = (span: number): SpanRef => ({ kind: 'zoning', id: 'a', span });
  const fromOf = (d: SimPolicy4, i: number) => months(d, r(i)).from;
  const toOf = (d: SimPolicy4, i: number) => months(d, r(i)).to;

  it('setTo, setFrom and edge moves keep order and never overlap', () => {
    const a = setTo(past, r(1), 495, w);
    expect(toOf(a, 1)! >= fromOf(a, 1)).toBe(true);
    expect(toOf(a, 1)).toBe(495);
    const b = setFrom(past, r(2), 491, w);
    expect(fromOf(b, 2)).toBeGreaterThan(toOf(b, 1)!);
    const c = moveEdge(past, r(1), 'to', 1, w);
    expect(toOf(c, 1)! >= 490).toBe(true);
  });
  it('a long span ending past the window is not shortened by ArrowRight', () => {
    const long = mk(pol('a', [sp(10, 600)]));
    const d = moveEdge(long, r(0), 'to', 1, w);
    expect(months(d, r(0)).to).toBeGreaterThanOrEqual(600);
    expect(reconcilePolicy4(d, cal, asOf).doc).toBe(d);
  });
  it('moveSpan(+1) never moves left', () => {
    const d = moveSpan(past, r(1), 1, w);
    expect(fromOf(d, 1)).toBeGreaterThanOrEqual(485);
    expect(toOf(moveSpan(mk(pol('a', [sp(490, 500)])), r(0), 1, w), 0)).toBeGreaterThanOrEqual(500);
  });
  it('every result is reconciled', () => {
    for (const next of [
      setTo(past, r(1), 495, w),
      setFrom(past, r(2), 491, w),
      moveEdge(past, r(1), 'from', -3, w),
      moveSpan(past, r(1), -2, w),
      splitSpan(past, r(1), 487, w)
    ])
      expect(reconcilePolicy4(next, cal, asOf).doc).toBe(next);
  });
});
