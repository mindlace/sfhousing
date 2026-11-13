import { addMonths, firstOfMonth } from '$lib/sim/scenario/dates';
import { REFERENCES, monthsOf, phasingOf } from '$lib/sim/scenario/score';
import type { SimInput } from '$lib/sim/scenario/types';
import type { ProjectsFile } from '$lib/timelapse/projects';
import type { Day } from '$lib/timelapse/time';
import { monthLastDay, monthOfDay } from '../months';
import type { PolicyTimeline } from '../policy/frame';
import type { ScoreStatics } from './types';

/** The last day of the calendar month that starts on `first`. */
function lastDayOf(first: Day): Day {
  return addMonths(first, 1) - 1;
}

/** Whether the frame of month 1 or of any change up to `windowMonths` carries finance. */
function anyFinance(timeline: PolicyTimeline, windowMonths: number): boolean {
  if (timeline.frameAt(1).finance) return true;
  for (const m of timeline.changes()) {
    if (m > windowMonths) break;
    if (timeline.frameAt(m).finance) return true;
  }
  return false;
}

/**
 * What the page needs once. `months` runs from the dataset month to the last calendar month whose
 * last day is at or before the last day of model month `windowMonths`.
 */
export function scoreStaticsOf(
  input: SimInput,
  timeline: PolicyTimeline,
  base: 'plan' | 'preFzp',
  windowMonths: number,
  rhna: ProjectsFile['rhnaCompletedNet']
): ScoreStatics {
  const asOf = input.asOf;
  const limit = monthLastDay(asOf, windowMonths);
  let h = lastDayOf(firstOfMonth(asOf));
  while (lastDayOf(h + 1) <= limit) h = lastDayOf(h + 1);
  if (anyFinance(timeline, windowMonths)) {
    throw new Error('world-score: money before the world-funding merge');
  }
  const months = monthsOf(asOf, h);
  return {
    asOf,
    months,
    lastIndex: months.length - 1,
    baseline: rhna,
    tierBaseline: null,
    phasing: phasingOf(input.projects, asOf),
    references:
      base === 'preFzp' ? REFERENCES : REFERENCES.filter((r) => r.measure === 'completedNet'),
    compare: base,
    limits: null
  };
}

/** The last day of the last calendar month. */
export function horizonOf(s: ScoreStatics): Day {
  return lastDayOf(s.months[s.lastIndex]);
}

/** `[i]` is the model month holding the last day of calendar month i. */
export function finalTable(s: ScoreStatics): Int32Array {
  const out = new Int32Array(s.lastIndex + 1);
  for (let i = 0; i <= s.lastIndex; i++) out[i] = monthOfDay(s.asOf, lastDayOf(s.months[i]));
  return out;
}
