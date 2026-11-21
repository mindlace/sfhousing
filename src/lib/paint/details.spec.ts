import { describe, expect, it } from 'vitest';
import type { Score } from '$lib/scoreboard';
import { paintCounts, ROOM_MEANS } from './details';

const score = (over: Partial<Score> = {}): Score => ({
  grossUnits: 1_204,
  demolishedUnits: 310,
  netUnits: 894,
  targets: [],
  parcelsChanged: 42,
  byNeighborhood: {},
  ...over
});

describe('paint details', () => {
  it('paintCounts says lots, singular for one', () => {
    expect(paintCounts(score())).toBe('1,204 built · 310 replaced · 42 lots changed');
    expect(paintCounts(score({ grossUnits: 12, demolishedUnits: 3, parcelsChanged: 1 }))).toBe(
      '12 built · 3 replaced · 1 lot changed'
    );
    expect(paintCounts(score({ grossUnits: 0, demolishedUnits: 0, parcelsChanged: 0 }))).toBe(
      '0 built · 0 replaced · 0 lots changed'
    );
  });

  it('ROOM_MEANS: two lines, each under 12 words, no RHNA', () => {
    expect(ROOM_MEANS).toEqual([
      'Every eligible lot you painted, rebuilt to its height at once.',
      'Homes in replaced buildings are subtracted.'
    ]);
    for (const line of ROOM_MEANS) {
      expect(line.split(/\s+/).length).toBeLessThan(12);
      expect(line).not.toMatch(/RHNA/);
    }
  });
});
