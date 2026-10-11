import { describe, expect, it } from 'vitest';
import { actionForKey, isEditableTarget, SHORTCUTS, type KeyLike } from './shortcuts';

const ctx = { mapFocused: true };
function ev(key: string, extra: Partial<KeyLike> = {}): KeyLike {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    target: null,
    type: 'keydown',
    ...extra
  };
}
const fake = (o: object) => o as unknown as EventTarget;

describe('actionForKey', () => {
  it.each([
    ['v', 'move'],
    ['V', 'move'],
    ['h', 'move'],
    ['b', 'paint'],
    ['B', 'paint'],
    ['e', 'erase'],
    ['E', 'erase']
  ])('maps %s to tool %s', (key, tool) => {
    expect(actionForKey(ev(key), ctx)).toEqual({ type: 'tool', tool });
  });

  it('maps stories and radius keys', () => {
    const off = { mapFocused: false };
    expect(actionForKey(ev('-'), off)).toEqual({ type: 'stories', delta: -1 });
    expect(actionForKey(ev('='), off)).toEqual({ type: 'stories', delta: 1 });
    expect(actionForKey(ev('+', { shiftKey: true }), off)).toEqual({ type: 'stories', delta: 1 });
    expect(actionForKey(ev('['), ctx)).toEqual({ type: 'radius', dir: 'down' });
    expect(actionForKey(ev(']'), ctx)).toEqual({ type: 'radius', dir: 'up' });
  });

  it('maps undo and redo', () => {
    expect(actionForKey(ev('z', { metaKey: true }), ctx)).toEqual({ type: 'undo' });
    expect(actionForKey(ev('z', { ctrlKey: true }), ctx)).toEqual({ type: 'undo' });
    expect(actionForKey(ev('Z', { metaKey: true, shiftKey: true }), ctx)).toEqual({
      type: 'redo'
    });
    expect(actionForKey(ev('z', { ctrlKey: true, shiftKey: true }), ctx)).toEqual({
      type: 'redo'
    });
    expect(actionForKey(ev('y', { ctrlKey: true }), ctx)).toEqual({ type: 'redo' });
  });

  it('ignores tool letters with meta, ctrl or alt', () => {
    expect(actionForKey(ev('b', { metaKey: true }), ctx)).toBeNull();
    expect(actionForKey(ev('e', { ctrlKey: true }), ctx)).toBeNull();
    expect(actionForKey(ev('v', { altKey: true }), ctx)).toBeNull();
    expect(actionForKey(ev('-', { ctrlKey: true }), ctx)).toBeNull();
  });

  it('maps Escape to cancel and Enter to stamp', () => {
    expect(actionForKey(ev('Escape'), ctx)).toEqual({ type: 'cancel' });
    expect(actionForKey(ev('Enter'), ctx)).toEqual({ type: 'stamp' });
  });

  it('leaves - / = / + to MapLibre zoom when the map is focused (F-1); radius keys still act', () => {
    expect(actionForKey(ev('-'), ctx)).toBeNull();
    expect(actionForKey(ev('='), ctx)).toBeNull();
    expect(actionForKey(ev('+', { shiftKey: true }), ctx)).toBeNull();
    expect(actionForKey(ev('['), ctx)).toEqual({ type: 'radius', dir: 'down' });
    expect(actionForKey(ev(']'), ctx)).toEqual({ type: 'radius', dir: 'up' });
  });

  it('says in the table that the stories keys apply only off the map', () => {
    const row = SHORTCUTS.find((s) => s.keys === '- / = (or +)');
    expect(row?.action).toMatch(/map not focused/);
  });

  it('returns null for Enter when the map is not focused', () => {
    expect(actionForKey(ev('Enter'), { mapFocused: false })).toBeNull();
  });

  it('maps Space keydown and keyup', () => {
    expect(actionForKey(ev(' '), ctx)).toEqual({ type: 'space', down: true });
    expect(actionForKey(ev(' ', { type: 'keyup' }), ctx)).toEqual({ type: 'space', down: false });
  });

  it('returns null for a repeated Space keydown', () => {
    expect(actionForKey(ev(' ', { repeat: true }), ctx)).toBeNull();
  });

  it('ignores keyup for non-space keys and unknown keys', () => {
    expect(actionForKey(ev('b', { type: 'keyup' }), ctx)).toBeNull();
    expect(actionForKey(ev('q'), ctx)).toBeNull();
  });

  it('suppresses everything in editable targets', () => {
    for (const target of [
      fake({ tagName: 'INPUT' }),
      fake({ tagName: 'TEXTAREA' }),
      fake({ tagName: 'SELECT' }),
      fake({ tagName: 'DIV', isContentEditable: true })
    ]) {
      expect(actionForKey(ev('b', { target }), ctx)).toBeNull();
      expect(actionForKey(ev('Escape', { target }), ctx)).toBeNull();
      expect(actionForKey(ev(' ', { target }), ctx)).toBeNull();
      expect(actionForKey(ev('z', { metaKey: true, target }), ctx)).toBeNull();
    }
  });

  it('still acts for a non-editable target', () => {
    const target = fake({ tagName: 'DIV', isContentEditable: false });
    expect(actionForKey(ev('b', { target }), ctx)).toEqual({ type: 'tool', tool: 'paint' });
  });

  it('modalOpen suppresses all', () => {
    const c = { mapFocused: true, modalOpen: true };
    for (const k of ['b', 'Escape', 'Enter', ' ', '-', '[']) {
      expect(actionForKey(ev(k), c)).toBeNull();
    }
    expect(actionForKey(ev('z', { metaKey: true }), c)).toBeNull();
  });
});

describe('isEditableTarget', () => {
  it('detects input, textarea, select and contenteditable', () => {
    expect(isEditableTarget(fake({ tagName: 'INPUT' }))).toBe(true);
    expect(isEditableTarget(fake({ tagName: 'textarea' }))).toBe(true);
    expect(isEditableTarget(fake({ tagName: 'SELECT' }))).toBe(true);
    expect(isEditableTarget(fake({ tagName: 'DIV', isContentEditable: true }))).toBe(true);
  });

  it('rejects null and ordinary elements', () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(fake({}))).toBe(false);
    expect(isEditableTarget(fake({ tagName: 'BUTTON' }))).toBe(false);
  });
});

describe('SHORTCUTS', () => {
  it('lists the keyboard table', () => {
    expect(SHORTCUTS.length).toBeGreaterThanOrEqual(10);
    for (const s of SHORTCUTS) {
      expect(s.keys).toBeTruthy();
      expect(s.action).toBeTruthy();
    }
  });
});
