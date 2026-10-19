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

describe('isFullHeightRoute for /fzp', () => {
  it('is full height for /fzp only, not its children', () => {
    expect(isFullHeightRoute('/fzp')).toBe(true);
    expect(isFullHeightRoute('/fzp/x')).toBe(false);
  });
});
