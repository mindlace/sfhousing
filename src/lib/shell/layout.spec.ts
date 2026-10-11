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
