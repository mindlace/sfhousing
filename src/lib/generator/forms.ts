import type { ParcelRecord } from '../data/parcel';
import type { BuildingForm } from '../sim/choice/types';
import { generate } from './generate';
import type { GeneratedBuilding } from './types';

/** A lot massed at a chosen form (building-choice): the homes, the built stories and the plates. */
export interface FormBuilding {
  units: number;
  /** Built stories: the stories asked, lowered to the lot's physical maximum. */
  stories: number;
  /** Tower plates; 0 for any other form. A district sums its lots'. */
  plates: number;
  building: GeneratedBuilding;
}

/**
 * Masses `rec` at `form` and `stories` through the generator's own composition, roof and unit
 * code, never above the lot's physical maximum. `block` is the midrise massing at
 * `BLOCK_COVERAGE`; `tower` places the most plates the lot holds (`maxTowerPlates`) and needs
 * `TOWER_MIN_STORIES`. A district masses every lot at the form and stories and sums them. Null
 * when the form does not fit the lot or gains no home. Callers pass `seed = fnv1a32(rec.id)`.
 * Recorded projects keep `generate` and `selectTypology`.
 */
export function generateForm(
  rec: ParcelRecord,
  form: BuildingForm,
  stories: number,
  seed: number
): FormBuilding | null {
  const building = generate(rec, { maxStories: stories }, seed, 'max', { form });
  if (!building) return null;
  return {
    units: building.units,
    stories: building.stories,
    plates: building.plates ?? 0,
    building
  };
}
