// Spec §4.4 / §4.7 view logic. Pure; no DOM.
import type { BuildoutMode } from '$lib/generator';
import { formatBuiltDate, formatCompactCount, formatCount, formatPercent } from './format';
import type { Score, TargetProgress } from './types';

/**
 * UI-only input (spec §2), derived on the main thread from I15: 'chunks' → pending/failed,
 * 'diff'.complete, the manifest → datasetVersion/builtAt. `complete` is added here because §4.4's
 * "updating" state reads it.
 */
export interface ScoreStatus {
  pendingChunks: number;
  failedChunks: number;
  complete: boolean;
  datasetVersion: string;
  builtAt: string;
  planDatasetVersion?: string;
  mode: BuildoutMode;
}

/** Badge copy keyed by mode (§5 seam: M2 adds 'likely'). */
export const BADGE: Record<BuildoutMode, string> = { max: 'Theoretical max buildout' };
export const PRIMARY_TARGET_ID = 'rhna';
export const NEIGHBORHOOD_TOP = 10;

/** Full-scale value shared by every bar: max(1, ceil(maxFraction·2)/2). */
export function trackMax(targets: readonly TargetProgress[]): number {
  const maxFraction = Math.max(0, ...targets.map((t) => t.fraction));
  return Math.max(1, Math.ceil(maxFraction * 2) / 2);
}

/** Fill width as % of the track; drawn from 0, so negatives are 0. Never clamped above. */
export function fillPercent(fraction: number, max: number): number {
  return (Math.max(0, fraction) / max) * 100;
}

/** Position of the 100%-of-target tick as % of the track. */
export function tickPercent(max: number): number {
  return 100 / max;
}

export function remainderText(netUnits: number, targetUnits: number): string {
  return netUnits < targetUnits
    ? `${formatCount(targetUnits - netUnits)} to go`
    : `${formatCount(netUnits - targetUnits)} over target`;
}

export function meterValueText(tp: TargetProgress): string {
  return `${formatPercent(tp.fraction)} of ${tp.target.label}`;
}

export interface NeighborhoodRow {
  name: string;
  net: number;
}

export function neighborhoodRows(by: Record<string, number>): NeighborhoodRow[] {
  return Object.entries(by)
    .map(([name, net]) => ({ name, net }))
    .sort((a, b) => b.net - a.net || a.name.localeCompare(b.name, 'en'));
}

export interface ViewState {
  empty: boolean;
  updating: boolean;
  failed: boolean;
  oldPlan: boolean;
}

export function viewState(score: Score, status: ScoreStatus): ViewState {
  return {
    empty: score.parcelsChanged === 0 && status.pendingChunks === 0,
    updating: status.pendingChunks > 0 || !status.complete,
    failed: status.failedChunks > 0,
    oldPlan: !!status.planDatasetVersion && status.planDatasetVersion !== status.datasetVersion
  };
}

/** RHNA by id (scores arrive via structured clone); falls back to the first target. */
export function primaryTarget(score: Score): TargetProgress | undefined {
  return score.targets.find((t) => t.target.id === PRIMARY_TARGET_ID) ?? score.targets[0];
}

function ofRhna(score: Score): string {
  const p = primaryTarget(score);
  return p ? `${formatPercent(p.fraction)} of RHNA` : '';
}

/** §4.7 aria-live text. */
export function announcement(score: Score): string {
  const pct = ofRhna(score);
  return `Net new homes ${formatCount(score.netUnits)}` + (pct ? `, ${pct}` : '');
}

/** §4.4 mobile collapsed bar. */
export function barText(score: Score): string {
  const pct = ofRhna(score);
  return `${formatCompactCount(score.netUnits)} net new homes` + (pct ? ` · ${pct}` : '');
}

export function secondaryText(score: Score): string {
  return (
    `${formatCount(score.grossUnits)} built · ${formatCount(score.demolishedUnits)} replaced · ` +
    `${formatCount(score.parcelsChanged)} parcels changed`
  );
}

/** Footnote text before the "Sources" link. */
export function footnoteLead(status: ScoreStatus): string {
  const built = status.builtAt ? ` · built ${formatBuiltDate(status.builtAt)}` : '';
  return `Data ${status.datasetVersion}${built}`;
}

export function oldPlanNote(status: ScoreStatus): string {
  return `plan made on data ${status.planDatasetVersion}, recalculated on current data`;
}
