// Administrative-purge censoring, rule sc.exit.purge-censor (spec §4.4 step 6).
import { describe, expect, it } from 'vitest';
import { FIXTURE_CAL, LIVE_CAL } from '../../lib/fzp-cal/config';
import { purgeCensor } from '../../lib/fzp-cal/purge';
import { CalibrationError, type NormHistory } from '../../lib/fzp-cal/types';
import { isoToDay } from '../../project-records/multiphase';
import type { Day, ExitReason, ProjectHistory, Stage } from '../../../src/lib/timelapse/types';

const d = isoToDay;

function exitHist(
  id: string,
  stage: Stage,
  entry: Day,
  day: Day,
  reason: ExitReason = 'withdrawn'
): NormHistory {
  const end: ProjectHistory['end'] = { kind: 'exit', stage, reason, day };
  return {
    id,
    pathway: 'discretionary',
    parcelIds: [],
    eff: { [stage]: entry },
    end,
    purgeCensored: false,
    src: {
      id,
      pathway: 'discretionary',
      parcelIds: [],
      entered: { [stage]: entry },
      end,
      unitsAt: { filed: 10 },
      existingUnits: 0,
      storiesProposed: null,
      baseStoriesAtFiling: null,
      sources: []
    }
  };
}

/** About one short exit a week from 2020 to the end of 2026 (x = 100 days). */
function background(): NormHistory[] {
  const out: NormHistory[] = [];
  for (let day = d('2020-01-03'), i = 0; day <= d('2026-12-31'); day += 7, i++) {
    out.push(exitHist(`bg${i}`, 'filed', day - 100, day));
  }
  return out;
}

/** `long` exits of 1,200 days and `short` of 200 days, all on `day`. */
function burst(tag: string, day: Day, long: number, short: number): NormHistory[] {
  const out: NormHistory[] = [];
  for (let i = 0; i < long; i++) {
    out.push(exitHist(`${tag}L${i}`, 'entitled', day - 1200, day, i % 2 ? 'expired' : 'withdrawn'));
  }
  for (let i = 0; i < short; i++) {
    out.push(exitHist(`${tag}S${i}`, 'filed', day - 200, day));
  }
  return out;
}

describe('purgeCensor', () => {
  it('finds one window for two long-duration bursts and censors only the long exits', () => {
    const norm = [
      ...background(),
      ...burst('a', d('2026-09-15'), 30, 10),
      ...burst('b', d('2026-10-01'), 30, 10)
    ];
    const r = purgeCensor(norm, LIVE_CAL);
    expect(r.windows).toHaveLength(1);
    const w = r.windows[0];
    expect(w).toMatchObject({
      first: d('2026-09-15'),
      last: d('2026-10-01'),
      // 80 in the bursts plus the 2 weekly background exits dated inside the window
      exits: 82,
      censored: 60,
      byStage: { entitled: 60, filed: 22 }
    });
    expect(w.byReason).toEqual({ withdrawn: 52, expired: 30 });
    expect(w.medianDays).toBe(1200);
    const censored = r.norm.filter((h) => h.purgeCensored);
    expect(censored).toHaveLength(60);
    for (const h of censored) {
      expect(h.id).toMatch(/L\d+$/);
      expect(h.end).toEqual({ kind: 'open', lastObserved: d('2026-09-14') });
    }
    const short = r.norm.filter((h) => /S\d+$/.test(h.id));
    expect(short).toHaveLength(20);
    expect(short.every((h) => h.end.kind === 'exit' && !h.purgeCensored)).toBe(true);
    expect(r.norm.filter((h) => h.id.startsWith('bg')).every((h) => h.end.kind === 'exit')).toBe(
      true
    );
  });

  it('tallies fired as the censored count and of as every exit', () => {
    const norm = [
      ...background(),
      ...burst('a', d('2026-09-15'), 30, 10),
      ...burst('b', d('2026-10-01'), 30, 10)
    ];
    const exits = norm.length;
    // an open history is not an exit
    const open = exitHist('o', 'filed', d('2020-01-01'), d('2020-02-01'));
    open.end = { kind: 'open', lastObserved: d('2020-02-01') };
    const r = purgeCensor([...norm, open], LIVE_CAL);
    expect(r.tally.of).toBe(exits);
    expect(r.tally.fired).toBe(60);
    expect(r.tally.sample).toHaveLength(60);
    expect(r.tally.sample[0]).toBe('aL0:entitled');
    expect(r.tally.sample).toEqual([...r.tally.sample].sort());
  });

  it('does not mutate its input', () => {
    const norm = [...burst('a', d('2026-09-15'), 40, 0)];
    const before = JSON.stringify(norm);
    const r = purgeCensor(norm, LIVE_CAL);
    expect(r.tally.fired).toBe(40);
    expect(JSON.stringify(norm)).toBe(before);
  });

  it('does not treat a burst of short-duration exits on one day as a purge', () => {
    const norm = [...background(), ...burst('a', d('2026-09-15'), 0, 40)];
    const r = purgeCensor(norm, LIVE_CAL);
    expect(r.windows).toEqual([]);
    expect(r.tally.fired).toBe(0);
    expect(r.tally.of).toBe(norm.length);
    expect(r.tally.sample).toEqual([]);
    expect(r.norm.every((h) => !h.purgeCensored)).toBe(true);
  });

  it('does not flag a burst below the exit count or the background ratio', () => {
    const few = purgeCensor(burst('a', d('2026-09-15'), 9, 0), LIVE_CAL);
    expect(few.windows).toEqual([]);
    // 12 long exits on a day when the background is 3 a day (1,095 in the year before)
    const dense: NormHistory[] = [];
    for (let day = d('2025-09-15'); day < d('2026-09-15'); day++) {
      for (let k = 0; k < 3; k++) dense.push(exitHist(`x${day}-${k}`, 'filed', day - 10, day));
    }
    const r = purgeCensor([...dense, ...burst('a', d('2026-09-15'), 12, 0)], LIVE_CAL);
    expect(r.windows).toEqual([]);
  });

  it('floors the background mean at one exit a year', () => {
    // no background at all: the mean of 0 floors to 1/365, so the minimum count decides
    const r = purgeCensor(burst('a', d('2026-09-15'), 10, 0), LIVE_CAL);
    expect(r.windows).toHaveLength(1);
    expect(r.tally.fired).toBe(10);
  });

  it('keeps bursts 45 days apart as two windows', () => {
    const norm = [
      ...background(),
      ...burst('a', d('2026-08-01'), 30, 0),
      ...burst('b', d('2026-09-15'), 30, 0)
    ];
    const r = purgeCensor(norm, LIVE_CAL);
    expect(r.windows.map((w) => [w.first, w.last])).toEqual([
      [d('2026-08-01'), d('2026-08-01')],
      [d('2026-09-15'), d('2026-09-15')]
    ]);
    const lastObserved = r.norm
      .filter((h) => h.purgeCensored)
      .map((h) => (h.end.kind === 'open' ? h.end.lastObserved : -1));
    expect(new Set(lastObserved)).toEqual(new Set([d('2026-07-31'), d('2026-09-14')]));
  });

  it('censors a long exit on a non-purge day inside the window', () => {
    const norm = [
      ...burst('a', d('2026-09-15'), 30, 0),
      ...burst('b', d('2026-10-01'), 30, 0),
      exitHist('mid', 'filed', d('2022-01-01'), d('2026-09-20'))
    ];
    const r = purgeCensor(norm, LIVE_CAL);
    const mid = r.norm.find((h) => h.id === 'mid');
    expect(mid?.purgeCensored).toBe(true);
    expect(r.windows[0].exits).toBe(61);
  });

  it('never censors earlier than the stage entry', () => {
    const cal = { ...FIXTURE_CAL, purgeMinExits: 3, purgeMinDays: 5 };
    const norm: NormHistory[] = [];
    for (const day of ['2026-09-01', '2026-09-20']) {
      for (let i = 0; i < 3; i++) norm.push(exitHist(`${day}-${i}`, 'filed', d(day) - 5, d(day)));
    }
    const r = purgeCensor(norm, cal);
    expect(r.windows).toHaveLength(1);
    const ends = r.norm.map((h) => (h.end.kind === 'open' ? h.end.lastObserved : -1));
    // the 09-20 exits entered on 09-15, after the day before the window (08-31): entry wins
    expect(ends.slice(0, 3)).toEqual([d('2026-08-31'), d('2026-08-31'), d('2026-08-31')]);
    expect(ends.slice(3)).toEqual([d('2026-09-15'), d('2026-09-15'), d('2026-09-15')]);
  });

  it('throws on an exit dated before its stage entry or at a stage never entered', () => {
    const bad = exitHist('bad', 'filed', d('2020-02-01'), d('2020-01-01'));
    expect(() => purgeCensor([bad], LIVE_CAL)).toThrow(CalibrationError);
    const noStage = exitHist('nostage', 'filed', d('2020-01-01'), d('2020-02-01'));
    noStage.eff = {};
    expect(() => purgeCensor([noStage], LIVE_CAL)).toThrow(/nostage/);
  });
});
