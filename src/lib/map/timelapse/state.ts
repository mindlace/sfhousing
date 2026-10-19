// CPU reference of the timelapse vertex-shader state rules (spec §4.2.3). The GLSL port keeps
// this rule order and straight-line shape; do not restructure one without the other.
import type { PartAttrs, PartEval } from './types';
import { DYING_FADE_DAYS, DYING_HOLD_DAYS, FLOOR_CAP } from './constants';
import { FTF_M } from '$lib/generator/constants';
import { OPEN_DAY, type Day } from '$lib/timelapse/time';

/** Solid-floor cut height at time `at`: 0 until the first floor, else the top of floor `n`. */
function cutAt(a: PartAttrs, at: Day): number {
  const p = Math.min((at - a.constructionDay) / a.constructionTypicalDays, FLOOR_CAP);
  const n = Math.floor(p * a.stories);
  return n === 0 ? 0 : a.groundFtfM + (n - 1) * FTF_M;
}

/** The state, fade factor and solid/ghost cut height of one part on day `t`. */
export function evalPart(a: PartAttrs, t: Day): PartEval {
  const dying = a.endKind === 2 && t >= a.endDay;
  const age = t - a.endDay;
  // Footprint-only slots (stories 0) never take the solid states (§4.2.3).
  const solid = a.stories > 0;

  // 1. Hidden.
  if (t < a.ghostFrom || t < a.partFrom || t >= a.partTo) {
    return { state: 'hidden', alpha: 0, zCutM: 0 };
  }
  if (dying && age >= DYING_HOLD_DAYS + DYING_FADE_DAYS) {
    return { state: 'hidden', alpha: 0, zCutM: 0 };
  }

  // 2. Dying: the construction cut freezes at the end day.
  if (dying) {
    const f = age < DYING_HOLD_DAYS ? 1 : 1 - (age - DYING_HOLD_DAYS) / DYING_FADE_DAYS;
    const frozen = solid && a.constructionDay <= a.endDay;
    return { state: 'dying', alpha: f, zCutM: frozen ? cutAt(a, Math.min(t, a.endDay)) : 0 };
  }

  // 3. Complete.
  if (solid && t >= a.completeDay) return { state: 'complete', alpha: 1, zCutM: OPEN_DAY };

  // 4. Constructing.
  if (solid && t >= a.constructionDay) {
    return { state: 'constructing', alpha: 1, zCutM: cutAt(a, t) };
  }

  // 5. Pre-construction ghost. A footprint-only slot keeps the ready tint once it constructs.
  const ready = t >= a.readyDay || t >= a.constructionDay || t >= a.completeDay;
  if (ready) return { state: 'ready', alpha: 1, zCutM: 0 };
  if (t >= a.permitDay) return { state: 'permit', alpha: 1, zCutM: 0 };
  return { state: 'planning', alpha: 1, zCutM: 0 };
}
