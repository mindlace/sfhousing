import type { PlanOp } from '$lib/plan';
import type { OpStats } from '$lib/sim/protocol';

export const MSG = {
  loadingCity: 'Loading city data…',
  cityFailed: "Couldn't load city data.",
  loadingParcels: 'Loading parcels…',
  zoomIn: 'Zoom in to see the brush',
  tooLarge:
    'This stroke would make the plan too large to save (256 KB limit). Undo some strokes or start a new plan.',
  readOnly: 'Read-only — Remix to edit',
  eraseHint: 'Erase removes painted height',
  mapLabel:
    'Map. Arrow keys pan, plus and minus zoom. In Paint or Erase, press Enter to apply the brush at the centre crosshair.'
} as const;

export const ANNOUNCE_MS = 4000;
export const TOO_LARGE_MS = 6000;

const fmt = new Intl.NumberFormat('en-US');
const n = (v: number) => fmt.format(v);
const plural = (v: number, one: string, many: string) => (v === 1 ? one : many);

export function strokeMessage(s: OpStats): string {
  const ineligible =
    s.ineligible > 0 ? ` · ${n(s.ineligible)} not eligible (open space or unmapped lots)` : '';
  const bay = s.underwater > 0 ? ` · ${n(s.underwater)} in the Bay` : '';
  const partial = s.partial ? ' · some areas still loading' : '';
  if (s.covered === 0) {
    const head =
      s.ineligible + s.underwater > 0
        ? 'No eligible parcels under that stroke'
        : 'No parcels under that stroke';
    return head + ineligible + bay + partial;
  }
  const parcels = `${n(s.covered)} ${plural(s.covered, 'parcel', 'parcels')}`;
  if (s.kind === 'erase') {
    return (
      `Erased ${parcels} · ${n(s.removed)} generated ${plural(s.removed, 'building', 'buildings')} removed` +
      ineligible +
      bay +
      partial
    );
  }
  const stories = s.stories ?? 0;
  return (
    `Painted ${n(stories)} ${plural(stories, 'story', 'stories')} on ${parcels}` +
    ` · ${n(s.built)} new ${plural(s.built, 'building', 'buildings')}` +
    ` · ${n(s.notBigger)} already as big or bigger` +
    ineligible +
    bay +
    partial
  );
}

export function undoMessage(op: PlanOp, verb: 'Undid' | 'Redid'): string {
  if (op.kind === 'erase') return `${verb} erase`;
  return `${verb} paint, ${op.stories} ${plural(op.stories, 'story', 'stories')}`;
}

export function radiusValueText(r: number): string {
  return `Brush radius ${r} metres`;
}
