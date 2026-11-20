import { describe, expect, it } from 'vitest';
import { viewOfLog, logCompiled, logFilled, EMPTY_LOG } from './chunk-log';
import { chunk, statics } from './test/fixtures';
import { keyTally } from './key';
import type { TimelineView } from '$lib/sim/world/score/types';

const LAST = 5;
const OPTS = { provisional: false, inForce: false };

function view(filled = LAST): TimelineView {
  let log = logCompiled(EMPTY_LOG, statics({ lastIndex: LAST }));
  if (filled >= 0) log = logFilled(log, chunk(0, filled + 1));
  return viewOfLog(log)!;
}

describe('keyTally', () => {
  it('sums the in-progress stages into four groups at the playhead month', () => {
    const v = view();
    v.rows[3] = {
      ...v.rows[3],
      inProgress: {
        preApplication: 5,
        filed: 7,
        entitled: 11,
        permitFiled: 13,
        permitIssued: 17,
        construction: 19
      }
    };
    const t = keyTally(v, { index: 3, atToday: false }, OPTS)!;
    expect(t.planning).toBe(12);
    expect(t.approved).toBe(24);
    expect(t.issued).toBe(17);
    expect(t.building).toBe(19);
  });

  it('completed is rows[i].completedNet and stopped rows[i].exitedUnits', () => {
    const v = view();
    v.rows[2] = { ...v.rows[2], completedNet: 42, exitedUnits: 9 };
    expect(keyTally(v, { index: 2, atToday: false }, OPTS)).toMatchObject({
      completed: 42,
      stopped: 9
    });
  });

  it('at today: completed and stopped 0, in progress from month 0', () => {
    const v = view();
    v.rows[0] = { ...v.rows[0], completedNet: 40, exitedUnits: 3 };
    expect(keyTally(v, { index: 0, atToday: true }, OPTS)).toEqual({
      planning: 2,
      approved: 3,
      issued: 1,
      building: 3,
      completed: 0,
      stopped: 0
    });
  });

  it('null while calculating: no view, provisional, or the month not filled', () => {
    expect(keyTally(null, { index: 0, atToday: true }, OPTS)).toBeNull();
    expect(
      keyTally(view(), { index: 1, atToday: false }, { provisional: true, inForce: false })
    ).toBeNull();
    expect(keyTally(view(2), { index: 3, atToday: false }, OPTS)).toBeNull();
    expect(keyTally(view(-1), { index: 0, atToday: true }, OPTS)).toBeNull();
    expect(keyTally(view(2), { index: 2, atToday: false }, OPTS)).not.toBeNull();
  });
});
