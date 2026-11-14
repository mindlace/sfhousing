import { describe, expect, it } from 'vitest';
import { viewOf } from '$lib/sim/world/score/view';
import {
  NO_EDIT,
  afterView,
  edited,
  fillStatusText,
  playAvailable,
  settled,
  shownAt
} from './fill';
import { chunk, cut, statics } from './test/fixtures';

const whole = viewOf([chunk(0, 300)], statics({ lastIndex: 299 }));

describe('stale, fill and Play state', () => {
  it('held view until the refill passes the playhead', () => {
    let s = edited(NO_EDIT, whole);
    expect(shownAt(s, whole, 30)).toEqual({ view: whole, stale: true });
    s = settled(s);
    expect(shownAt(s, cut(whole, 20), 30)).toEqual({ view: whole, stale: true });
    expect(shownAt(s, cut(whole, 30), 30)).toEqual({ view: cut(whole, 30), stale: false });
  });
  it('compiled arriving before the refill does not settle: still stale', () => {
    const s = edited(NO_EDIT, whole);
    expect(shownAt(s, cut(whole, 99), 5).stale).toBe(true);
  });
  it('a superseded edit settles at the later rev refill and keeps the first held view', () => {
    let s = edited(edited(NO_EDIT, whole), cut(whole, 40));
    expect(s.held).toBe(whole);
    s = settled(s);
    expect(shownAt(s, cut(whole, 99), 5)).toEqual({ view: cut(whole, 99), stale: false });
  });
  it('an edit after the playhead ends staleness at settle', () => {
    const s = settled(edited(NO_EDIT, whole));
    expect(shownAt(s, cut(whole, 99), 5).stale).toBe(false);
  });
  it('no edit in play is never stale', () => {
    expect(shownAt(NO_EDIT, cut(whole, 3), 50)).toEqual({ view: cut(whole, 3), stale: false });
  });
  it('an edit with no view yet is stale and shows nothing', () => {
    expect(shownAt(edited(NO_EDIT, null), null, 0)).toEqual({ view: null, stale: true });
  });
  it('afterView clears held once not stale', () => {
    const s = afterView(settled(edited(NO_EDIT, whole)), cut(whole, 50), 10);
    expect(s.held).toBeNull();
    const t = afterView(settled(edited(NO_EDIT, whole)), cut(whole, 5), 10);
    expect(t.held).toBe(whole);
  });
  it('Play waits for the whole window after an edit, unless an error stopped the fill', () => {
    const s = afterView(settled(edited(NO_EDIT, whole)), cut(whole, 50), 0);
    expect(playAvailable(s, cut(whole, 50), false)).toBe(false);
    expect(playAvailable(s, cut(whole, 50), true)).toBe(true);
    expect(playAvailable(afterView(s, whole, 0), whole, false)).toBe(true);
  });
  it('a pending edit keeps Play off even when the view looks whole', () => {
    const s = afterView(edited(NO_EDIT, whole), whole, 0);
    expect(playAvailable(s, whole, false)).toBe(false);
  });
  it('Play is available with no edit, inside the filled part', () => {
    expect(playAvailable(NO_EDIT, cut(whole, 3), false)).toBe(true);
  });
  it('fill status names the year of the last final month, and nothing when full', () => {
    expect(fillStatusText(cut(whole, 251))).toMatch(/^Forecast filled to \d{4}$/);
    expect(fillStatusText(whole)).toBe('');
    expect(fillStatusText(null)).toBe('');
  });
});
