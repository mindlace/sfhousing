import { MIDRISE_MIN_M2, PODIUM_MIN_M2, TOWER_MIN_M2 } from './constants';
import type { TypologyId } from './types';

/**
 * §4.5. "Capped at" caps both typology and stories. `S` is the painted story count after
 * floor and clamp (integer 1..80); the returned `stories` is the built count.
 */
export function selectTypology(
  S: number,
  A: number,
  existingUnits: number
): { typology: TypologyId; stories: number } {
  if (S >= 13) {
    return A >= TOWER_MIN_M2
      ? { typology: 'tower', stories: S }
      : selectTypology(12, A, existingUnits);
  }
  if (S >= 8) {
    return A >= MIDRISE_MIN_M2
      ? { typology: 'midrise', stories: S }
      : selectTypology(7, A, existingUnits);
  }
  if (S >= 5) {
    return A >= PODIUM_MIN_M2
      ? { typology: 'podium', stories: S }
      : { typology: 'walkup', stories: Math.min(S, 5) };
  }
  if (S === 4) return { typology: 'walkup', stories: 4 };
  if (S === 3) return { typology: 'plex', stories: 3 };
  return existingUnits >= 1 ? { typology: 'adu', stories: S } : { typology: 'plex', stories: S };
}
