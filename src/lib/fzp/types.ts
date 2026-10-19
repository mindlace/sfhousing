import type { TargetProgress } from '$lib/scoreboard';
import type { Day } from '$lib/timelapse/time';
import type { Stage } from '$lib/timelapse/types';

export type FzpPhase = 'loading' | 'ready' | 'failed' | 'no-scenario';

/** Playback speed choice. */
export type Speed = 'month' | 'year' | 'threeYears';

/** The scoreboard at one month (score-view.ts, pure). */
export interface ScoreAt {
  monthIndex: number;
  total: number;
  /** baseline.completedNet */
  actual: number;
  /** completedNetPipeline */
  pipeline: number;
  /** completedNetNew */
  fresh: number;
  /** T8 planEffect[i].completedNetNew; null while planEffect is [] (T8, IA-9) */
  planCompleted: number | null;
  /** T8 planEffect[i].entitledNew; null while planEffect is [] (T8, IA-9) */
  planEntitled: number | null;
  /** T8 planEffectBand p10/p90 (no baseline); null while planEffectBand is [] */
  planBand: { low: number; high: number } | null;
  /** p10/p90 + baseline (same basis, T8) */
  band: { low: number; high: number } | null;
  inProgress: { stage: Exclude<Stage, 'complete'>; units: number }[];
  exitedUnits: number;
  /** I11 TargetProgress at this month */
  targets: { tp: TargetProgress; atDeadline: number }[];
}

/** One project's status at the scrubbed day (card.ts, pure). */
export interface CardStatus {
  /** No project visible: no card status. */
  kind: 'inStage' | 'complete' | 'exited';
  stage: Stage;
  /** monthsIn(entered, t), T1 */
  monthsInStage: number;
  day: Day;
  units: number;
  stories: number | null;
  /** Only for 'inStage'. */
  chance: number | null;
}

/** A button on the scrubber track: `label` is visible, `name` is the accessible name. */
export interface Marker {
  day: Day;
  label: string;
  name: string;
}
