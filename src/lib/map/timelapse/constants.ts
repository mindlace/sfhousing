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
