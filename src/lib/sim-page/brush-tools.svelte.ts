/**
 * The /sim brush tools over `/`'s BrushState: Paint writes custom zoning at the brush's story
 * count ("Allow N stories"), Erase removes custom zoning. Held by SimPage (the Paint tab and the
 * palette strip take the tool and the brush from it).
 */
import type { BrushTool } from '$lib/brush/sampler';
import type { BrushState } from '$lib/brush/state.svelte';

export type SimTool = 'move' | 'paint' | 'erase';

export const SIM_TOOLS: { id: SimTool; label: string }[] = [
  { id: 'move', label: 'Move' },
  { id: 'paint', label: 'Paint' },
  { id: 'erase', label: 'Erase' }
];

/** The controller's tool for a /sim tool: the same three. */
export const brushToolOf = (t: SimTool): BrushTool => t;

/** The stories hint while Erase is active on /sim: erasing removes custom zoning, not height. */
export const ERASE_HINT = 'Erase removes your custom zoning; it has no height';

export class SimBrushTools {
  tool = $state<SimTool>('move');
  readonly brush: BrushState;

  constructor(brush: BrushState) {
    this.brush = brush;
  }

  /** The story count a Paint stroke allows. */
  stories(): number {
    return this.brush.stories;
  }
}
