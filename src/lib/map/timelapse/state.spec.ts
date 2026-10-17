import { describe, expect, it } from 'vitest';
import { DAYS, SLOT, timelineSmall } from '../fixtures/timeline-small';
import { timelineLookups } from '../fixtures/timeline-lookups';
import { encodeParts, partAttrs } from './encode';
import { DYING_FADE_DAYS, DYING_HOLD_DAYS, FLOOR_CAP } from './constants';
import { evalPart } from './state';
import type { PartAttrs } from './types';
import { OPEN_DAY } from '$lib/timelapse/time';

type SlotKey = keyof typeof SLOT;

/** Every part of a slot as `PartAttrs`, in pack (revision) order. */
function partsOf(key: SlotKey): PartAttrs[] {
  const cell = timelineSmall.cells.find((c) => c.cellId === SLOT[key].cellId)!;
  const s = cell.slotProjectIds.indexOf(SLOT[key].projectId);
  const e = encodeParts(cell, timelineLookups);
  const out: PartAttrs[] = [];
  for (let k = 0; k < cell.partCount; k++) if (cell.partSlot[k] === s) out.push(partAttrs(e, k));
  return out;
}
/** The first part of a slot (its first revision). */
const first = (key: SlotKey) => partsOf(key)[0];

describe('evalPart hidden and ghost tint', () => {
  it('is hidden before ghostFrom and planning at ghostFrom', () => {
    const a = first('a');
    expect(evalPart(a, a.ghostFrom - 1)).toEqual({ state: 'hidden', alpha: 0, zCutM: 0 });
    expect(evalPart(a, a.ghostFrom)).toEqual({ state: 'planning', alpha: 1, zCutM: 0 });
  });
  it('is hidden before ghostFrom even when the part window opened earlier', () => {
    const a = first('a');
    const early = { ...a, partFrom: a.ghostFrom - 100 };
    expect(evalPart(early, a.ghostFrom - 1)).toEqual({ state: 'hidden', alpha: 0, zCutM: 0 });
    expect(evalPart(early, a.ghostFrom)).toEqual({ state: 'planning', alpha: 1, zCutM: 0 });
  });
  it('flips to permit exactly at permitDay and ready at readyDay', () => {
    const a = first('a');
    expect(a.permitDay).toBe(DAYS.a.entitled);
    expect(a.readyDay).toBe(DAYS.a.permitIssued);
    expect(evalPart(a, a.permitDay - 1).state).toBe('planning');
    expect(evalPart(a, a.permitDay).state).toBe('permit');
    expect(evalPart(a, a.readyDay - 1).state).toBe('permit');
    expect(evalPart(a, a.readyDay).state).toBe('ready');
    expect(evalPart(a, a.constructionDay - 1)).toEqual({ state: 'ready', alpha: 1, zCutM: 0 });
  });
  it('shows a skipped stage (g has no entitled) as planning until permitFiled', () => {
    const g = first('g');
    expect(g.permitDay).toBe(DAYS.g.permitFiled);
    expect(evalPart(g, g.permitDay - 1).state).toBe('planning');
    expect(evalPart(g, g.permitDay).state).toBe('permit');
  });
});

describe('evalPart construction and completion', () => {
  it('has zCutM 0 at p = 0 in the constructing state', () => {
    const a = first('a');
    expect(evalPart(a, a.constructionDay)).toEqual({ state: 'constructing', alpha: 1, zCutM: 0 });
  });
  it('cuts at the floor reached at p = 0.5 (mid-floor day)', () => {
    const a = first('a');
    const t = a.constructionDay + 0.5 * a.constructionTypicalDays;
    // 5 stories at p = 0.5 is 2.5 floors, so n = 2: walkup ground 3.1 m + 1 · 3.1 m.
    expect(a.stories).toBe(5);
    expect(a.groundFtfM).toBeCloseTo(3.1, 6);
    const e = evalPart(a, t);
    expect(e.state).toBe('constructing');
    expect(e.alpha).toBe(1);
    expect(e.zCutM).toBeCloseTo(6.2, 5);
  });
  it('cuts at the capped floor of a podium: ground 4.5 m + 5 · 3.1 m = 20 m (c)', () => {
    const c = first('c');
    // 7 stories, tall ground floor; at the horizon p is capped at 0.9, so n = floor(6.3) = 6.
    expect(c.stories).toBe(7);
    expect(c.groundFtfM).toBe(4.5);
    expect(c.constructionDay + FLOOR_CAP * c.constructionTypicalDays).toBeLessThan(DAYS.horizon);
    const e = evalPart(c, DAYS.horizon);
    expect(e.state).toBe('constructing');
    expect(e.zCutM).toBeCloseTo(20, 5);
  });
  it('caps progress at 0.9 just before completeDay', () => {
    const a = first('a');
    // The cap day is well before completion, so this is the capped floor: floor(0.9 · 5) = 4.
    expect(a.constructionDay + FLOOR_CAP * a.constructionTypicalDays).toBeLessThan(a.completeDay);
    const e = evalPart(a, a.completeDay - 1);
    expect(e.state).toBe('constructing');
    expect(e.alpha).toBe(1);
    expect(e.zCutM).toBeCloseTo(12.4, 5); // 3.1 + 3 · 3.1
    expect(evalPart(a, a.completeDay).zCutM).toBe(OPEN_DAY);
  });
  it('is complete exactly at completeDay, opaque, with zCutM OPEN_DAY', () => {
    const a = first('a');
    expect(evalPart(a, a.completeDay)).toEqual({ state: 'complete', alpha: 1, zCutM: OPEN_DAY });
    expect(evalPart(a, a.completeDay + 1000).state).toBe('complete');
  });
  it('keeps zCutM 0 when construction typical days are unknown (OPEN_DAY)', () => {
    const a = { ...first('a'), constructionTypicalDays: OPEN_DAY };
    expect(evalPart(a, a.completeDay - 1)).toEqual({ state: 'constructing', alpha: 1, zCutM: 0 });
  });
});

describe('evalPart revisions', () => {
  it('swaps revision 0 for revision 1 exactly at the revision day', () => {
    const parts = partsOf('d');
    const d1 = DAYS.d.rev1;
    const r0 = parts.filter((p) => p.partTo === d1);
    const r1 = parts.filter((p) => p.partFrom === d1);
    expect(r0.length).toBeGreaterThan(0);
    expect(r1.length).toBeGreaterThan(0);
    for (const p of r0) {
      expect(evalPart(p, d1 - 1).state).not.toBe('hidden');
      expect(evalPart(p, d1).state).toBe('hidden');
    }
    for (const p of r1) {
      expect(evalPart(p, d1 - 1).state).toBe('hidden');
      expect(evalPart(p, d1).state).not.toBe('hidden');
    }
  });
});

describe('evalPart dying', () => {
  it('holds alpha 1 for 90 days, then fades linearly, hidden at end + 270', () => {
    const b = first('b');
    const end = DAYS.b.end;
    expect(b.endDay).toBe(end);
    expect(b.endKind).toBe(2);
    expect(DYING_HOLD_DAYS + DYING_FADE_DAYS).toBe(270);
    expect(evalPart(b, end - 1).state).toBe('permit');
    for (const age of [0, 89, 90]) {
      const e = evalPart(b, end + age);
      expect(e.state).toBe('dying');
      expect(e.alpha).toBe(1);
      expect(e.zCutM).toBe(0);
    }
    expect(evalPart(b, end + 269).state).toBe('dying');
    expect(evalPart(b, end + 269).alpha).toBeCloseTo(1 / 180, 6);
    expect(evalPart(b, end + 270)).toEqual({ state: 'hidden', alpha: 0, zCutM: 0 });
  });
  it('freezes zCutM of a construction death at end and end + 100', () => {
    const e0 = first('e');
    const atEnd = evalPart(e0, DAYS.e.end);
    const later = evalPart(e0, DAYS.e.end + 100);
    // 400 days of a 24-month construction on 5 stories: p ≈ 0.55, n = 2, so 3.1 + 3.1 m.
    expect(atEnd.state).toBe('dying');
    expect(atEnd.zCutM).toBeCloseTo(6.2, 5);
    expect(later.zCutM).toBe(atEnd.zCutM);
    expect(later.alpha).toBeLessThan(1);
  });
  it('dies a footprint-only slot as a ghost with zCutM 0, hidden at end + 270 (h)', () => {
    const h0 = first('h');
    const h = { ...h0, endKind: 2, endDay: h0.constructionDay + 50 };
    expect(h.stories).toBe(0);
    const dying = evalPart(h, h.endDay + 100);
    expect(dying.state).toBe('dying');
    expect(dying.zCutM).toBe(0);
    expect(dying.alpha).toBeLessThan(1);
    expect(dying.alpha).toBeGreaterThan(0);
    expect(evalPart(h, h.endDay + 270)).toEqual({ state: 'hidden', alpha: 0, zCutM: 0 });
  });
  it('has zCutM 0 for a death before construction started (i2)', () => {
    const i2 = first('i2');
    expect(i2.constructionDay).toBe(OPEN_DAY);
    expect(evalPart(i2, DAYS.i2.end + 10)).toEqual({ state: 'dying', alpha: 1, zCutM: 0 });
  });
});

describe('evalPart open windows and footprint-only slots', () => {
  it('keeps an open-ended construction visible on the horizon day', () => {
    const c = first('c');
    expect(c.partTo).toBe(OPEN_DAY);
    expect(c.endKind).toBe(0);
    const e = evalPart(c, DAYS.horizon);
    expect(e.state).toBe('constructing');
    expect(e.alpha).toBe(1);
  });
  it('never returns constructing or complete for footprint-only (h) from start to horizon', () => {
    const parts = partsOf('h');
    expect(parts.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const h of parts) {
      expect(h.stories).toBe(0);
      for (let t = DAYS.start; t <= DAYS.horizon; t += 7) {
        const e = evalPart(h, t);
        seen.add(e.state);
        expect(e.zCutM).toBe(0);
      }
      // The sweep step can skip the exact edges; check them directly.
      expect(evalPart(h, h.constructionDay)).toEqual({ state: 'ready', alpha: 1, zCutM: 0 });
      expect(evalPart(h, h.completeDay)).toEqual({ state: 'ready', alpha: 1, zCutM: 0 });
    }
    expect(seen.has('constructing')).toBe(false);
    expect(seen.has('complete')).toBe(false);
    expect(seen.has('ready')).toBe(true);
  });
});
