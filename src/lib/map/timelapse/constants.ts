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
/**
 * Tier 4, slice 6: far bars show from this zoom (the phone's default view is 12.2, the
 * desktop's 13). In far mode the gate is read at each bar's anchor: the map's zoom less how much
 * deeper than the view's centre the anchor sits.
 */
export const BAR_FAR_MIN_ZOOM = 12;
/** Tier 4, slice 6: a far bar's one size in px at every zoom (today's z15 size). */
export const BAR_FAR_PX = { w: 32, h: 6 } as const;
/**
 * Tier 4, slice 6: far declutter keeps at least this many px between two bars' boxes, across or
 * up, at the zoom both show from (centres at least hypot(w + gap, h + gap) apart on the ground).
 */
export const BAR_FAR_GAP_PX = 4;
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
/** Tier 4: this spec; declutter ladder step from the mode's gate up to DECLUTTER_MAX_ZOOM. */
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
/**
 * Tier 4, slice 6 fix round: the smallest merged ring's radius in px. A ring is no larger than
 * half its square's projected width, so rings shrink toward the horizon down to this floor.
 */
export const CITY_RING_FLOOR_PX = 5;
/**
 * Tier 4, slice 6 fix round: as a square's projected half-width falls from CITY_RING_FLOOR_PX
 * to this many px, its ring fades out (alpha 1 to 0) instead of piling up at the floor.
 */
export const CITY_RING_FADE_PX = 2;
/**
 * Tier 4, slice 6 fix round: an edge glow's range, in the view's ground half-diagonals from the
 * view's centre. Beyond it a record draws no glow. At the desktop default (zoom 13) the whole
 * city is in range; at zoom 16 about 4 km around the centre.
 */
export const CITY_GLOW_REACH = 3;
/** Tier 4, slice 6 fix round: an edge glow's strength at CITY_GLOW_REACH (1 at the centre). */
export const CITY_GLOW_FAR_ALPHA = 0.4;
