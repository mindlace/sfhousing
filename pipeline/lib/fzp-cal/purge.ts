/**
 * Administrative-purge censoring, registered rule `sc.exit.purge-censor` (stage-calibration
 * spec §4.4 step 6). Exits from bulk administrative actions are not project decisions: a window
 * of purge days is found over all exits, and its long-duration exits become censored at the day
 * before the window. Values change only in memory; the input is not mutated.
 */
import type { Day, ExitReason, Stage } from '../../../src/lib/timelapse/types';
import { CalibrationError } from './types';
import type { CalProfile, NormHistory, PurgeWindow, RuleTally } from './types';

const BACKGROUND_DAYS = 365;

interface Exit {
  h: NormHistory;
  stage: Stage;
  reason: ExitReason;
  day: Day;
  /** days in the exit stage */
  x: number;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function exitOf(h: NormHistory): Exit | null {
  if (h.end.kind !== 'exit') return null;
  const { stage, reason, day } = h.end;
  const entry = h.eff[stage];
  if (entry === undefined) {
    throw new CalibrationError(`${h.id}: exit at stage ${stage}, which the history never entered`);
  }
  if (day < entry) {
    throw new CalibrationError(`${h.id}: exit on day ${day} before entering ${stage} on ${entry}`);
  }
  return { h, stage, reason, day, x: day - entry };
}

/** Purge days (§4.4 step 6): enough exits, far above the year before, long durations. */
function purgeDays(exits: Exit[], cal: CalProfile): Day[] {
  const byDay = new Map<Day, Exit[]>();
  for (const e of exits) {
    const list = byDay.get(e.day);
    if (list) list.push(e);
    else byDay.set(e.day, [e]);
  }
  const days: Day[] = [];
  for (const [day, list] of byDay) {
    if (list.length < cal.purgeMinExits) continue;
    let prior = 0;
    for (let k = 1; k <= BACKGROUND_DAYS; k++) prior += byDay.get(day - k)?.length ?? 0;
    const mean = Math.max(prior / BACKGROUND_DAYS, 1 / BACKGROUND_DAYS);
    if (list.length < cal.purgeRatio * mean) continue;
    if (median(list.map((e) => e.x)) < cal.purgeMinDays) continue;
    days.push(day);
  }
  return days.sort((a, b) => a - b);
}

/** Purge days less than `purgeGapDays` apart merge into one window [first, last]. */
function mergeWindows(days: Day[], gap: number): { first: Day; last: Day }[] {
  const out: { first: Day; last: Day }[] = [];
  for (const day of days) {
    const w = out[out.length - 1];
    if (w && day - w.last < gap) w.last = day;
    else out.push({ first: day, last: day });
  }
  return out;
}

/**
 * Censors the long-duration exits inside each purge window at `max(eff[stage], first - 1)`.
 * `tally.of` counts the exits of all histories, `fired` the censored ones.
 */
export function purgeCensor(
  norm: NormHistory[],
  cal: CalProfile
): { norm: NormHistory[]; tally: RuleTally; windows: PurgeWindow[] } {
  const exits: Exit[] = [];
  for (const h of norm) {
    const e = exitOf(h);
    if (e) exits.push(e);
  }
  const spans = mergeWindows(purgeDays(exits, cal), cal.purgeGapDays);

  const censor = new Map<NormHistory, Day>();
  const windows: PurgeWindow[] = spans.map(({ first, last }) => {
    const inside = exits.filter((e) => e.day >= first && e.day <= last);
    const w: PurgeWindow = {
      first,
      last,
      exits: inside.length,
      censored: 0,
      byReason: {},
      byStage: {},
      medianDays: median(inside.map((e) => e.x))
    };
    for (const e of inside) {
      w.byReason[e.reason] = (w.byReason[e.reason] ?? 0) + 1;
      w.byStage[e.stage] = (w.byStage[e.stage] ?? 0) + 1;
      if (e.x < cal.purgeMinDays) continue;
      w.censored++;
      censor.set(e.h, Math.max(e.day - e.x, first - 1));
    }
    return w;
  });

  const sample: string[] = [];
  const out = norm.map((h) => {
    const lastObserved = censor.get(h);
    if (lastObserved === undefined) return h;
    sample.push(`${h.id}:${(h.end as { stage: Stage }).stage}`);
    return { ...h, end: { kind: 'open' as const, lastObserved }, purgeCensored: true };
  });
  sample.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { norm: out, tally: { fired: sample.length, of: exits.length, sample }, windows };
}
