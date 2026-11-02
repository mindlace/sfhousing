/**
 * Room to grow (height-lids spec): the floors a zone could still add, and how that reads on the
 * lid (a glaze step and a label). Pure and worker-safe.
 */
import { FTF_M, GROUND_FTF_M } from '$lib/generator/constants';
import type { EnvelopeTable } from '$lib/sim/levers/layers';
import type { Need } from '$lib/sim/levers/resolve';

/** 0 → 0; s ≥ 1 → GROUND_FTF_M + (s − 1)·FTF_M. */
export function storiesToM(stories: number): number {
  return stories <= 0 ? 0 : GROUND_FTF_M + (stories - 1) * FTF_M;
}

/**
 * Lots whose unused allowance counts toward room to grow: eligible, with at least one story, not
 * protected, and either hostable or a Need row (hostable is 0 until the Need is filled).
 */
export function countableMask(
  t: EnvelopeTable,
  eligible: Uint8Array,
  needs: readonly Need[],
  protectedRows: Int32Array
): Uint8Array {
  const out = new Uint8Array(t.count);
  const isNeed = new Uint8Array(t.count);
  for (const n of needs) isNeed[n.row] = 1;
  for (let i = 0; i < t.count; i++) {
    out[i] = eligible[i] && t.stories[i] >= 1 && (t.hostable[i] || isNeed[i]) ? 1 : 0;
  }
  for (const r of protectedRows) out[r] = 0;
  return out;
}

/** Unused stories per area at which the glaze steps up to 1, 2 and 3. */
export const GLAZE_STEP_AT = [1, 3, 6] as const;

/** unusedStoryM2 is the sum over a zone's lots of unused stories × lot area. */
export function glazeStep(unusedStoryM2: number, areaM2: number): 0 | 1 | 2 | 3 {
  if (areaM2 <= 0) return 0;
  const r = unusedStoryM2 / areaM2;
  let step = 0;
  for (const at of GLAZE_STEP_AT) if (r >= at) step++;
  return step as 0 | 1 | 2 | 3;
}

const nf = new Intl.NumberFormat('en-US');

/** "4 stories · +120 floors" */
export function lidLabelText(stories: number, roomFloors: number): string {
  const s = `${stories} ${stories === 1 ? 'story' : 'stories'}`;
  return `${s} · +${nf.format(roomFloors)} ${roomFloors === 1 ? 'floor' : 'floors'}`;
}

/** "8", "40+" */
export function contourLabelText(stories: number): string {
  return stories >= 40 ? '40+' : String(stories);
}
