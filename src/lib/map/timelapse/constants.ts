// Display constants of the timelapse renderer (spec §4.9). Presentation only, never data.
import type { Theme } from '../types';
import { DYING_DAYS } from '$lib/timelapse/time';

/** Tier 4: light from the partner-approved mockup tl-ghost-styles-v2.html (op 0.28); dark: spec. */
export const GHOST_ALPHA: Record<Theme, number> = { light: 0.28, dark: 0.35 };
/** Tier 4: this spec (OD-T2 "red, then it fades"); days a dead project stays fully red. */
export const DYING_HOLD_DAYS = 90;
/** Tier 4: the rest of the design's `DYING_DAYS` window (270 − 90 = 180 days of fade). */
export const DYING_FADE_DAYS = DYING_DAYS - DYING_HOLD_DAYS;
/** Tier 4: this spec; floors and bar fill stop at 90% so the map never reveals the future. */
export const FLOOR_CAP = 0.9;
/** Tier 4: OD-T2 "street zoom", value from this spec; bars show from this zoom. */
export const BAR_MIN_ZOOM = 15;
/** Tier 4: this spec; zoom range over which bar alpha ramps from 0 to 1 below the gate. */
export const BAR_ZOOM_RAMP = 0.5;
/** Tier 4: this spec; bar width in px at z15 and from z17 up (8 px per zoom between). */
export const BAR_W_PX = [32, 48] as const;
/** Tier 4: this spec; bar height in px at z15 and from z17 up (1 px per zoom between). */
export const BAR_H_PX = [6, 8] as const;
/** Tier 4: this spec; screen gap in px between the anchor and the bar's bottom edge. */
export const BAR_OFFSET_PX = 10;
/** Tier 4: this spec; metres above the revision's highest part top for the bar anchor. */
export const BAR_TOP_GAP_M = 2;
/** Tier 4: this spec; days a completed project's bar holds at full fill. */
export const COMPLETE_HOLD_DAYS = 90;
/** Tier 4: this spec; days a completed project's bar then takes to fade out. */
export const COMPLETE_FADE_DAYS = 90;
/** Tier 4: this spec (mockup colours at 41% amber, 78% green); unlikely/uncertain/likely. */
export const RAMP_STOPS = [0.15, 0.45, 0.75] as const;
/** Tier 4: this spec; the declutter ladder's top rung is the map's maxZoom (18). */
export const DECLUTTER_MAX_ZOOM = 18;
/** Tier 4: this spec; declutter ladder step from BAR_MIN_ZOOM up to DECLUTTER_MAX_ZOOM. */
export const DECLUTTER_STEP = 0.5;
/** Tier 4: this slice; a halo ring's life in simulated days (2 s at 1×, 0.67 s at 3×). */
export const HALO_DAYS = 730;
/** Tier 4: this slice; a ring's radius in px at birth and at the end of its life. */
export const HALO_R_PX = [6, 22] as const;
/** Tier 4: this slice; reduced motion: a ring's one radius in px (full strength, no fade). */
export const HALO_STILL_R_PX = 14;
/** Tier 4: this slice; the policy mark's size in px (the diamond's diagonal). */
export const MARK_PX = 10;
/** Tier 4, slice 6: below this zoom merged rings; from it each project's own ring. */
export const CITY_HANDOVER_ZOOM = 14;
/** Tier 4, slice 6: the side of the grid square a merged ring stands for, in metres. */
export const CITY_CELL_M = 800;
/** Tier 4, slice 6: one merged ring per square, half-year and kind. */
export const CITY_BUCKET_DAYS = 182;
/**
 * Tier 4, slice 6: a merged ring's life in simulated days (1 s at 1×): 2 × CITY_BUCKET_DAYS, so
 * at most two rings of one square and kind are alive at once.
 */
export const CITY_RING_DAYS = 364;
/** Tier 4, slice 6: an edge glow's life in simulated days (0.5 s at 1×). */
export const CITY_EDGE_DAYS = 182;
/** Tier 4, slice 6: homes at which a merged ring reaches HALO_R_PX[1]. */
export const CITY_R_REF_HOMES = 50;
/** Tier 4, slice 6: the largest merged ring's radius in px. */
export const CITY_R_MAX_PX = 40;
/**
 * Tier 4, slice 6: the second cue of a policy record (colour is never the only one). A policy
 * ring is doubled, a second 2 px stroke this many px inside the first; a policy edge glow has a
 * 1 px land-coloured ring this many px inside its edge.
 */
export const CITY_POLICY_INSET_PX = 4;
