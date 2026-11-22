// The map key's rows: the stage groups /sim counts and the building types Paint lists. Pure.
import type { TypologyId } from '$lib/generator';
import type { Stage } from '$lib/timelapse/types';
import type { TokenName } from '../palette';
import { TYPOLOGY_ORDER } from '../types';

/** How a key row's swatch is drawn, from `--map-*` custom properties (`KeySwatch`). */
export type Swatch = {
  kind: 'ghost' | 'solid' | 'bar' | 'mark';
  tokens: TokenName[];
};

export type StageGroup = 'planning' | 'approved' | 'issued' | 'building' | 'completed' | 'stopped';

export interface StageKeyRow {
  id: StageGroup;
  label: string;
  swatch: Swatch;
  /** The in-progress stages it sums; [] for the last two. */
  stages: Exclude<Stage, 'complete'>[];
}

/**
 * planning: preApplication + filed (tl-ghost-planning); approved: entitled + permitFiled
 * (tl-ghost-permit); issued: permitIssued (tl-ghost-ready); building: construction
 * (tl-ghost-ready, gen-walkup); completed (the gen-* types); stopped (tl-ghost-dying).
 */
export const STAGE_KEY: readonly StageKeyRow[] = [
  {
    id: 'planning',
    label: 'Planning review',
    swatch: { kind: 'ghost', tokens: ['tl-ghost-planning'] },
    stages: ['preApplication', 'filed']
  },
  {
    id: 'approved',
    label: 'Approved',
    swatch: { kind: 'ghost', tokens: ['tl-ghost-permit'] },
    stages: ['entitled', 'permitFiled']
  },
  {
    id: 'issued',
    label: 'Permit issued',
    swatch: { kind: 'ghost', tokens: ['tl-ghost-ready'] },
    stages: ['permitIssued']
  },
  {
    id: 'building',
    label: 'Building',
    swatch: { kind: 'solid', tokens: ['tl-ghost-ready', 'gen-walkup'] },
    stages: ['construction']
  },
  {
    id: 'completed',
    label: 'Completed',
    swatch: { kind: 'solid', tokens: TYPOLOGY_ORDER.map((t) => `gen-${t}` as const) },
    stages: []
  },
  {
    id: 'stopped',
    label: 'Stopped',
    swatch: { kind: 'ghost', tokens: ['tl-ghost-dying'] },
    stages: []
  }
];

/** The tooltip's words (src/lib/map/tooltip.ts), with House, Duplex and Plex as one row. */
const TYPE_LABEL: Record<TypologyId, string> = {
  adu: 'ADU',
  plex: 'House or plex',
  walkup: 'Walk-up',
  podium: '5-over-1',
  midrise: 'Mid-rise',
  tower: 'Tower'
};

/** Paint's key: one row per building type, in `TYPOLOGY_ORDER`. */
export const TYPE_KEY: readonly { typology: TypologyId; label: string; token: TokenName }[] =
  TYPOLOGY_ORDER.map((t) => ({ typology: t, label: TYPE_LABEL[t], token: `gen-${t}` as const }));
