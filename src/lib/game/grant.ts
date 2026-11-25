// G5 (contracts stub): applying a grant to the policy document. tree-catalogue makes it real.
import type { addChoices } from '$lib/timeline/add';
import type { SimPolicy4 } from '$lib/timeline/policy4';
import type { Limits } from './limits';
import type { Grant } from './tree';

export const GAME_TRANSIT_ID = 'game-transit';

export interface GrantCtx {
  cal: Parameters<typeof addChoices>[1];
  limits: Limits;
}

export function applyGrant(_doc: SimPolicy4, _grant: Grant, _ctx: GrantCtx): SimPolicy4 {
  throw new Error('not implemented');
}
