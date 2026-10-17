// timelapse-render internal types (spec §2.1). None alters a T-row.
import type { SimMapHandle, Theme } from '../types';
import type { Day } from '$lib/timelapse/time';

/** T7: what `setTimelineLookups` receives (T12 `chanceTable` and `typicalMonths` outputs). */
export type TimelineLookups = Parameters<SimMapHandle['setTimelineLookups']>[0];

export type PartState =
  'hidden' | 'planning' | 'permit' | 'ready' | 'constructing' | 'complete' | 'dying';

/**
 * CPU record of one part's GPU attributes (§4.2.1), in table order: `tlA` = partFrom, partTo,
 * ghostFrom, endDay; `tlB` = permitDay, readyDay, constructionDay, completeDay; `tlC` = endKind,
 * constructionTypicalDays, stories, groundFtfM. "Never" days are `OPEN_DAY`.
 */
export interface PartAttrs {
  partFrom: number;
  partTo: number;
  ghostFrom: number;
  endDay: number;
  permitDay: number;
  readyDay: number;
  constructionDay: number;
  completeDay: number;
  endKind: number;
  constructionTypicalDays: number;
  stories: number;
  groundFtfM: number;
}

/** `evalPart` result: solid below `zCutM`, ghost above. */
export interface PartEval {
  state: PartState;
  alpha: number;
  zCutM: number;
}

/** `evalBar` result (§4.4). */
export interface BarEval {
  visible: boolean;
  fill: number; // 0..1
  segCount: number;
  chance: number | null;
  dead: boolean;
  alpha: number;
}

/** Debug hook snapshot. */
export interface TimelineSnapshot {
  revision: number;
  cells: number;
  parts: number;
  bars: number;
  day: number;
  demolish: { total: number; applied: number };
  pending: number;
  layerIds: string[];
}

/** Shared mutable clock read by the extension's `draw`; `setTime` writes `day`. */
export interface TimelineClock {
  day: Day;
  theme: Theme;
}
