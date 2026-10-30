import { describe, expect, it } from 'vitest';
import { isFullHeightRoute } from './layout';

describe('isFullHeightRoute', () => {
  it.each([
    ['/', true],
    ['/p/[id]', true],
    ['/about', false],
    ['/attribution', false],
    [null, false],
    ['/pricing', false]
  ])('%s -> %s', (id, expected) => {
    expect(isFullHeightRoute(id)).toBe(expected);
  });
});

describe('isFullHeightRoute for /sim', () => {
  it('is full height for /sim only, not its children', () => {
    expect(isFullHeightRoute('/sim')).toBe(true);
    expect(isFullHeightRoute('/sim/x')).toBe(false);
  });

  it('/fzp is no longer a page (it redirects to /sim)', () => {
    expect(isFullHeightRoute('/fzp')).toBe(false);
  });
});
