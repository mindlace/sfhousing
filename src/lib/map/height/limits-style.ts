/**
 * How the height-limit lids and contours look per mode (height-lids spec, "The design"). Pure:
 * HeightLimitsLayer turns these looks into sublayer data and colours.
 *
 * - plain: limit steps are solid ink; source boundaries (same height, another source) are hidden.
 * - paint (brush or eraser selected): anything set by paint, or bounding it, is a dashed line in
 *   the paint tone, source boundaries included. Everything else is as plain.
 * - rule s: the rims of s and the outline of its lot set are full ink (the outline 2 px); every
 *   other line is dimmed, glaze shows only on s and walls of s are full, others dimmed. The FZP
 *   baseline selected is rule mode with s = SRC_FZP.
 */
import { SRC_FZP, SRC_PAINT, SRC_RULE0 } from '$lib/sim/levers/source';
import { CHAIN_SOURCE } from './types';

/** The style-side mode: in rule mode, `source` is the rule's SRC_* code (-1: it decides nothing). */
export type LimitsMode = { kind: 'plain' } | { kind: 'paint' } | { kind: 'rule'; source: number };

/**
 * The page-side mode: a selected rule by id, or the FZP baseline. Lids and the city may come from
 * different limit revisions, so each maps the id through its own `sourceIds` (`resolveMode`).
 */
export type LimitsView =
  { kind: 'plain' } | { kind: 'paint' } | { kind: 'rule'; ruleId: string } | { kind: 'fzp' };

export const DIM_ALPHA = 0.3;
export const LIDS_FADE = [14.5, 15.5] as const;
/** Glaze alpha per room-to-grow step, × the `limit-glaze` token alpha. */
export const GLAZE_ALPHA = [0.3, 0.55, 0.8, 1] as const;

export interface Look {
  show: boolean;
  dashed: boolean;
  tone: 'ink' | 'paint';
  alpha: number;
  /** A width override in px (the selected rule's lot-set outline); else the sublayer's own. */
  widthPx?: number;
}

const HIDDEN: Look = { show: false, dashed: false, tone: 'ink', alpha: 0 };
const INK: Look = { show: true, dashed: false, tone: 'ink', alpha: 1 };
const DIM: Look = { show: true, dashed: false, tone: 'ink', alpha: DIM_ALPHA };
const PAINT_DASH: Look = { show: true, dashed: true, tone: 'paint', alpha: 1 };

/**
 * `view` with its rule id mapped to a code through `sourceIds` (absent: -1). The FZP baseline is
 * rule mode on `SRC_FZP`: the lots FZP sets in ink, the rest dimmed.
 */
export function resolveMode(view: LimitsView, sourceIds: readonly string[]): LimitsMode {
  if (view.kind === 'fzp') return { kind: 'rule', source: SRC_FZP };
  if (view.kind !== 'rule') return view;
  const k = sourceIds.indexOf(view.ruleId);
  return { kind: 'rule', source: k < 0 ? -1 : SRC_RULE0 + k };
}

/** A rim (one side of a lid boundary at its piece's height), owned by its piece's source. */
export function rimLook(kind: number, owner: number, mode: LimitsMode): Look {
  switch (mode.kind) {
    case 'plain':
      return kind === CHAIN_SOURCE ? HIDDEN : INK;
    case 'paint':
      if (owner === SRC_PAINT) return PAINT_DASH;
      return kind === CHAIN_SOURCE ? HIDDEN : INK;
    case 'rule':
      if (owner === mode.source) return INK;
      return kind === CHAIN_SOURCE ? HIDDEN : DIM;
  }
}

/** A contour chain between sources srcA (the higher side) and srcB. */
export function chainLook(kind: number, srcA: number, srcB: number, mode: LimitsMode): Look {
  switch (mode.kind) {
    case 'plain':
      return kind === CHAIN_SOURCE ? HIDDEN : INK;
    case 'paint':
      if (srcA === SRC_PAINT || srcB === SRC_PAINT) return PAINT_DASH;
      return kind === CHAIN_SOURCE ? HIDDEN : INK;
    case 'rule': {
      const a = srcA === mode.source;
      const b = srcB === mode.source;
      // exactly one side: the outline of the rule's lot set, bold so it can be found from afar
      if (a !== b) return { ...INK, widthPx: 2 };
      // both sides: a limit step inside the rule's own set, full like its rims
      if (a) return kind === CHAIN_SOURCE ? HIDDEN : INK;
      return kind === CHAIN_SOURCE ? HIDDEN : DIM;
    }
  }
}

/** Contour width: 1 px below a 4-story step, 1.5 px from 4 to 11, 2 px from 12. */
export function chainWidthPx(hi: number, lo: number): 1 | 1.5 | 2 {
  const step = hi - lo;
  return step >= 12 ? 2 : step >= 4 ? 1.5 : 1;
}

/** Glaze alpha for a piece of `owner` at room-to-grow `step` (0–3), × the token alpha. */
export function glazeAlpha(owner: number, step: number, mode: LimitsMode): number {
  if (mode.kind === 'rule' && owner !== mode.source) return 0;
  return GLAZE_ALPHA[Math.max(0, Math.min(GLAZE_ALPHA.length - 1, step))];
}

/** Wall alpha (× the token alpha) for a wall whose higher side is owned by `owner`. */
export function wallAlpha(owner: number, mode: LimitsMode): number {
  return mode.kind === 'rule' && owner !== mode.source ? DIM_ALPHA : 1;
}

/**
 * Whether a label dims in `mode`: in rule mode, one with none of the selected rule's lots under it
 * (`owners`: the sources under the label). A label with no owners stays full.
 */
export function labelDim(owners: ArrayLike<number> | undefined, mode: LimitsMode): boolean {
  return (
    mode.kind === 'rule' &&
    owners !== undefined &&
    !Array.prototype.includes.call(owners, mode.source)
  );
}

/** The lids' opacity: smoothstep over LIDS_FADE. Contours take 1 − it. */
export function lidsOpacity(zoom: number): number {
  const t = Math.max(0, Math.min(1, (zoom - LIDS_FADE[0]) / (LIDS_FADE[1] - LIDS_FADE[0])));
  return t * t * (3 - 2 * t);
}
