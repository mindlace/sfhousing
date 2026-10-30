/**
 * The /sim brush tools over `/`'s BrushState: Protect and Unprotect are the controller's Paint and
 * Erase aimed at the protections, and the freehand effect (mode, stories, density limits) is what
 * a Paint stroke writes. Shared by BrushSection, PhoneToolBar and SimPage.
 */
import type { BrushTool } from '$lib/brush/sampler';
import type { BrushState } from '$lib/brush/state.svelte';
import { defaultEffect, type BrushMode, type Effect } from './policy';
import type { StrokeTarget } from './stroke-adapter';

export type SimTool = 'move' | 'paint' | 'erase' | 'protect' | 'unprotect';

export const SIM_TOOLS: { id: SimTool; label: string }[] = [
  { id: 'move', label: 'Move' },
  { id: 'paint', label: 'Paint' },
  { id: 'erase', label: 'Erase' },
  { id: 'protect', label: 'Protect' },
  { id: 'unprotect', label: 'Unprotect' }
];

/** The controller's tool for a /sim tool. */
export function brushToolOf(t: SimTool): BrushTool {
  return t === 'protect' ? 'paint' : t === 'unprotect' ? 'erase' : t;
}

/** Protect and Unprotect hide Mode, Stories and Density (layout ruling 8). */
export const isProtectTool = (t: SimTool) => t === 'protect' || t === 'unprotect';

export class SimBrushTools {
  tool = $state<SimTool>('move');
  mode = $state<BrushMode>('raise');
  densityLimits = $state(defaultEffect('raise', 1).densityLimits);
  readonly brush: BrushState;

  constructor(brush: BrushState) {
    this.brush = brush;
  }

  /** Changing the mode resets Density limits to the mode's default. */
  setMode(m: BrushMode): void {
    this.mode = m;
    this.densityLimits = defaultEffect(m, this.brush.stories).densityLimits;
  }

  target(): StrokeTarget {
    return isProtectTool(this.tool) ? 'protect' : 'zoning';
  }

  effect(): Effect {
    return { mode: this.mode, stories: this.brush.stories, densityLimits: this.densityLimits };
  }
}
