import type { PlanOp } from '$lib/plan';
import type { OpStats } from '$lib/sim/protocol';

export const MSG = {
  loadingCity: 'Loading city data…',
  cityFailed: "Couldn't load city data.",
  loadingParcels: 'Loading parcels…',
  zoomIn: 'Zoom in to see the brush',
  tooLarge: 'Plan too large to save. Undo some strokes.',
  readOnly: 'Read-only. Remix to edit.',
  eraseHint: 'Erase removes painted height',
  mapLabel:
    'Map. Arrow keys pan, plus and minus zoom. In Paint or Erase, press Enter to apply the brush at the centre crosshair.'
} as const;

export const ANNOUNCE_MS = 4000;
export const TOO_LARGE_MS = 6000;

const fmt = new Intl.NumberFormat('en-US');
const n = (v: number) => fmt.format(v);
const plural = (v: number, one: string, many: string) => (v === 1 ? one : many);

/**
 * What a committed stroke did, for the stroke chip: '6 stories on 42 lots', 'Erased 42 lots' or
 * 'No (eligible) lots under that stroke', then ' · K not eligible', ' · B in the Bay' and
 * ' · still loading' as they apply, in that order.
 */
export function strokeMessage(s: OpStats): string {
  const suffix =
    (s.ineligible > 0 ? ` · ${n(s.ineligible)} not eligible` : '') +
    (s.underwater > 0 ? ` · ${n(s.underwater)} in the Bay` : '') +
    (s.partial ? ' · still loading' : '');
  if (s.covered === 0) {
    const eligible = s.ineligible + s.underwater > 0 ? 'eligible ' : '';
    return `No ${eligible}lots under that stroke${suffix}`;
  }
  const lots = `${n(s.covered)} ${plural(s.covered, 'lot', 'lots')}`;
  if (s.kind === 'erase') return `Erased ${lots}${suffix}`;
  const stories = s.stories ?? 0;
  return `${n(stories)} ${plural(stories, 'story', 'stories')} on ${lots}${suffix}`;
}

export function undoMessage(op: PlanOp, verb: 'Undid' | 'Redid'): string {
  if (op.kind === 'erase') return `${verb} erase`;
  return `${verb} paint, ${op.stories} ${plural(op.stories, 'story', 'stories')}`;
}

export function radiusValueText(r: number): string {
  return `Brush radius ${r} metres`;
}
