import { describe, expect, it, vi } from 'vitest';
import { TITLE_MAX_CHARS, emptyPlan, type Plan } from '$lib/plan';
import { applyTitle, normalizeTitle, withTitle } from './title';

const base = (): Plan => ({ ...emptyPlan('fixture-0'), title: 'old' });

describe('normalizeTitle', () => {
  it('trims, empties to undefined, clips', () => {
    expect(normalizeTitle('  a ')).toBe('a');
    expect(normalizeTitle('   ')).toBeUndefined();
    expect(normalizeTitle(undefined)).toBeUndefined();
    expect(normalizeTitle('x'.repeat(200))).toBe('x'.repeat(TITLE_MAX_CHARS));
    expect(TITLE_MAX_CHARS).toBe(120);
  });
});

describe('withTitle', () => {
  it('removes the key for blank titles without mutating', () => {
    const p = base();
    const q = withTitle(p, '  ');
    expect('title' in q).toBe(false);
    expect(p.title).toBe('old');
  });
  it('sets a normalised title', () => {
    expect(withTitle(base(), ' New ').title).toBe('New');
  });
});

describe('applyTitle', () => {
  it('calls setTitle with the normalised title', () => {
    const setTitle = vi.fn();
    applyTitle({ setTitle }, ' x ');
    expect(setTitle).toHaveBeenCalledWith('x');
  });
});
