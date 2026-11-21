import { describe, expect, it } from 'vitest';
import { isPlayKey, TIMELINE_SHORTCUTS } from './shortcuts';

/**
 * A node-side stand-in for an element: `closest` matches a selector list by tag, `[href]` and
 * `[role="…"]` only, which is all SPACE_NATIVE uses.
 */
interface FakeEl {
  tagName: string;
  isContentEditable: boolean;
  closest(sel: string): unknown;
}

function el(tag: string, attrs: Record<string, string> = {}, parent: FakeEl | null = null): FakeEl {
  const self: FakeEl = {
    tagName: tag.toUpperCase(),
    isContentEditable: attrs.contenteditable === 'true',
    closest(sel: string): unknown {
      const hit = sel.split(',').some((s) => {
        const m = /^([a-z]*)(?:\[(\w+)(?:="([^"]*)")?\])?$/.exec(s.trim());
        if (!m) return false;
        const [, t, attr, value] = m;
        if (t && t.toUpperCase() !== self.tagName) return false;
        if (attr && (value === undefined ? !(attr in attrs) : attrs[attr] !== value)) return false;
        return Boolean(t || attr);
      });
      return hit ? self : (parent?.closest(sel) ?? null);
    }
  };
  return self;
}

const body = el('body');

function ev(over: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: ' ',
    type: 'keydown',
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    defaultPrevented: false,
    target: body,
    ...over
  } as unknown as KeyboardEvent;
}

describe('isPlayKey', () => {
  it('isPlayKey: Space on the body and on the date slider', () => {
    expect(isPlayKey(ev(), false)).toBe(true);
    const slider = el('div', { role: 'slider' }, body);
    expect(isPlayKey(ev({ target: slider as unknown as EventTarget }), false)).toBe(true);
    // A plain element inside the page (a map canvas, a heading).
    const canvas = el('canvas', {}, body);
    expect(isPlayKey(ev({ target: canvas as unknown as EventTarget }), false)).toBe(true);
  });

  it('isPlayKey: not on a repeat, with a modifier, in a field, on a button, link, summary or radio, or under a modal', () => {
    expect(isPlayKey(ev({ repeat: true }), false)).toBe(false);
    for (const mod of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const)
      expect(isPlayKey(ev({ [mod]: true }), false), mod).toBe(false);
    expect(isPlayKey(ev({ type: 'keyup' }), false)).toBe(false);
    expect(isPlayKey(ev({ key: 'Enter' }), false)).toBe(false);
    expect(isPlayKey(ev({ defaultPrevented: true }), false)).toBe(false);
    expect(isPlayKey(ev(), true)).toBe(false);
    const targets = [
      el('input'),
      el('textarea'),
      el('select'),
      el('div', { contenteditable: 'true' }),
      el('button'),
      el('a', { href: '/about' }),
      el('summary'),
      el('div', { role: 'radio' }),
      el('div', { role: 'button' }),
      // Inside a control: the icon in a button.
      el('svg', {}, el('button'))
    ];
    for (const t of targets)
      expect(isPlayKey(ev({ target: t as unknown as EventTarget }), false), t.tagName).toBe(false);
  });
});

describe('TIMELINE_SHORTCUTS', () => {
  it('TIMELINE_SHORTCUTS: the four rows of The strings, in order', () => {
    expect(TIMELINE_SHORTCUTS).toEqual([
      { keys: 'Space', action: 'Play or pause (not while painting)' },
      { keys: '← / →', action: 'A month back or on (date slider)' },
      { keys: 'Page Down / Page Up', action: 'A year back or on (date slider)' },
      { keys: 'Home / End', action: 'Today / the last month (date slider)' }
    ]);
  });
});
