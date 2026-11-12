import { describe, expect, it } from 'vitest';
import { positionAt, positionOfShown, requestSeed, runValueText, stepPosition } from './run-slider';

const R = [4, 2, 5, 1, 3];

describe('run slider helpers', () => {
  it('maps positions to request seeds', () => {
    expect(requestSeed(R, 2)).toBeNull();
    expect(requestSeed(R, 0)).toBe(4);
  });
  it('finds the position of the shown run', () => {
    expect(positionOfShown(R, null, true)).toBe(2);
    expect(positionOfShown(R, 1, false)).toBe(3);
    expect(positionOfShown(R, 5, false)).toBe(2);
    expect(positionOfShown(R, 4242, false)).toBeNull();
  });
  it('steps by key', () => {
    expect(stepPosition('ArrowUp', 2, 5)).toBe(1);
    expect(stepPosition('ArrowRight', 0, 5)).toBe(0);
    expect(stepPosition('ArrowDown', 4, 5)).toBe(4);
    expect(stepPosition('PageDown', 0, 101)).toBe(10);
    expect(stepPosition('PageUp', 5, 101)).toBe(0);
    expect(stepPosition('Home', 3, 5)).toBe(0);
    expect(stepPosition('End', null, 5)).toBe(4);
    expect(stepPosition('ArrowUp', null, 101)).toBe(49);
    expect(stepPosition('a', 2, 5)).toBeNull();
  });
  it('maps a pointer y to a position', () => {
    expect(positionAt(0, 0, 100, 101)).toBe(0);
    expect(positionAt(100, 0, 100, 101)).toBe(100);
    expect(positionAt(-20, 0, 100, 101)).toBe(0);
  });
  it('words the value text', () => {
    expect(runValueText(R, 0, 4)).toBe('Run 4, rank 1 of 5');
    expect(runValueText(R, null, 4242)).toBe('Run 4242, not one of the 5 ranked runs');
  });
});
