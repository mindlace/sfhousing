// The engine's four rules the world calls: nextStage, isSkipped, revisionRatio, pathwayFrom.
import type { InFlightProject } from '$lib/timelapse/projects';
import { PATHWAYS, type Pathway, type RevisionModel, type Stage } from '$lib/timelapse/types';
import { P, drawOn } from './rng';

type Histogram = RevisionModel['at'][number]['ratio'];

/** The stage after `s` on pathway `p` (§4.4.2). */
export function nextStage(p: Pathway, s: Stage): Stage {
  switch (s) {
    case 'preApplication':
      return p === 'permitOnly' ? 'permitFiled' : 'filed';
    case 'filed':
      return 'entitled';
    case 'entitled':
      return 'permitFiled';
    case 'permitFiled':
      return 'permitIssued';
    case 'permitIssued':
      return 'construction';
    case 'construction':
      return 'complete';
    case 'complete':
      throw new Error('nextStage: complete is the last stage');
  }
}

/**
 * The ratio for one uniform (§4.4.5 step 2): bin i is the slot of u in the cumulative `probs`,
 * and u's position within bin i's mass places the ratio uniformly in [edges[i], edges[i+1]). A u
 * at or above a total that rounded below 1 takes the top of the last bin with mass; a histogram
 * with no mass gives 1 (no change).
 */
export function revisionRatio(h: Histogram, u: number): number {
  let acc = 0;
  let last = -1;
  let lastFrom = 0;
  for (let i = 0; i < h.probs.length; i++) {
    const p = h.probs[i];
    if (!(p > 0)) continue;
    if (u < acc + p) return h.edges[i] + ((u - acc) / p) * (h.edges[i + 1] - h.edges[i]);
    last = i;
    lastFrom = acc;
    acc += p;
  }
  if (last < 0) return 1;
  const residual = Math.min((u - lastFrom) / h.probs[last], 1);
  return h.edges[last] + residual * (h.edges[last + 1] - h.edges[last]);
}

/**
 * Rows the engine does not run (§4.4.3): already complete, or permitOnly at a Planning stage.
 * `loadSimInput` counts them once per load for its log line; the engine itself writes nothing.
 */
export function isSkipped(p: InFlightProject): boolean {
  return (
    p.stage === 'complete' ||
    (p.pathway === 'permitOnly' && (p.stage === 'filed' || p.stage === 'entitled'))
  );
}

/**
 * A pathway drawn on `drawOn(stream, P.PATHWAY, 0)` from the normalised shares `w`, in `PATHWAYS`
 * order (`pathwayForNew`, or `affordableRoutes` for a certain affordable project, finance-engine
 * spec 4.9).
 */
export function pathwayFrom(w: Record<Pathway, number>, stream: number): Pathway {
  let total = 0;
  for (const p of PATHWAYS) if (w[p] > 0) total += w[p];
  const x = drawOn(stream, P.PATHWAY, 0) * total;
  let acc = 0;
  let last: Pathway | null = null;
  for (const p of PATHWAYS) {
    if (!(w[p] > 0)) continue;
    acc += w[p];
    last = p;
    if (x < acc) return p;
  }
  if (last === null) throw new Error('pathway shares have no positive share');
  return last; // x at a total that rounded up
}
