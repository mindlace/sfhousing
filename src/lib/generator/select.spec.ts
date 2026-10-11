import { describe, expect, it } from 'vitest';
import { selectTypology } from './select';

describe('selectTypology (§4.5)', () => {
  it.each([
    // [S, A, existingUnits, typology, stories]
    [13, 1500, 1, 'tower', 13],
    [80, 5000, 1, 'tower', 80],
    [13, 1499.99, 1, 'midrise', 12],
    [30, 1200, 1, 'midrise', 12],
    [13, 599.99, 1, 'podium', 7],
    [13, 399.99, 1, 'walkup', 5],
    [8, 600, 1, 'midrise', 8],
    [12, 600, 1, 'midrise', 12],
    [12, 599.99, 1, 'podium', 7],
    [8, 399.99, 1, 'walkup', 5],
    [12, 232.3, 1, 'walkup', 5],
    [5, 400, 1, 'podium', 5],
    [7, 400, 1, 'podium', 7],
    [5, 399.99, 1, 'walkup', 5],
    [7, 399.99, 1, 'walkup', 5],
    [6, 399.99, 1, 'walkup', 5],
    [4, 5000, 1, 'walkup', 4],
    [3, 5000, 1, 'plex', 3],
    [2, 232.3, 1, 'adu', 2],
    [1, 232.3, 3, 'adu', 1],
    [2, 232.3, 0, 'plex', 2],
    [1, 232.3, 0, 'plex', 1]
  ] as const)('S=%i A=%f units=%i → %s %i', (S, A, eu, typology, stories) => {
    expect(selectTypology(S, A, eu)).toEqual({ typology, stories });
  });
});
