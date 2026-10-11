import { describe, expect, it } from 'vitest';
import { hasWebGL2 } from './webgl';

describe('hasWebGL2', () => {
  it('is false without a DOM', () => {
    expect(hasWebGL2()).toBe(false);
  });
});
