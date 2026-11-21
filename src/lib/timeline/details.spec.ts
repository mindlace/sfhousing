import { describe, expect, it } from 'vitest';
import { EMPTY_LOG, logCompiled, logFilled, viewOfLog } from './chunk-log';
import { YEAR_COLUMNS, yearRows } from './details';
import { calendarMonths, chunk, cut, statics } from './test/fixtures';
import { headlineAt } from './results';

/** 36 calendar months from Nov 2026 (Dec 2026 is month 1, Dec 2027 month 13, Dec 2028 month 25). */
const view = () =>
  calendarMonths(
    viewOfLog(logFilled(logCompiled(EMPTY_LOG, statics({ lastIndex: 35 })), chunk(0, 36)))!
  );

describe('yearRows', () => {
  it("yearRows stops at the playhead's month; the playhead's year reads its own month", () => {
    const v = view();
    // Month 18 is May 2028: Dec 2026, Dec 2027, then May 2028 itself.
    const rows = yearRows(v, 18, false);
    expect(rows.map((r) => [r.year, r.index, r.label])).toEqual([
      [2026, 1, '2026'],
      [2027, 13, '2027'],
      [2028, 18, 'May 2028']
    ]);
    // At December the playhead's row is the whole year.
    expect(yearRows(v, 13, false).map((r) => r.label)).toEqual(['2026', '2027']);
    // Month 0 (Nov 2026): one row, its own month.
    expect(yearRows(v, 0, false).map((r) => r.label)).toEqual(['Nov 2026']);
    // Nothing after the playhead, nothing unfilled: a playhead past the fill has no row of its own.
    const part = cut(v, 15);
    expect(yearRows(part, 20, false).map((r) => r.index)).toEqual([1, 13]);
    expect(yearRows(v, -1, false)).toEqual([]);
  });

  it('yearRows counts from today: homes is rows[i].completedNet, effect null without a policy', () => {
    const v = view();
    const rows = yearRows(v, 18, false);
    for (const r of rows) {
      expect(r.homes).toBe(v.rows[r.index].completedNet);
      expect(r.pipeline).toBe(v.rows[r.index].completedNetPipeline);
      expect(r.fresh).toBe(v.rows[r.index].completedNetNew);
      expect(r.effect).toBeNull();
    }
    // The playhead's row says what the header says at that month.
    const head = headlineAt(
      v,
      { index: 18, atToday: false },
      { provisional: false, inForce: true }
    );
    const withPolicy = yearRows(v, 18, true);
    expect(withPolicy.at(-1)!.homes).toBe(head!.homes);
    expect(withPolicy.at(-1)!.effect).toBe(head!.effect);
    expect(withPolicy.map((r) => r.effect)).toEqual(
      withPolicy.map((r) => v.planEffect[r.index].completedNetNew)
    );
  });

  it('YEAR_COLUMNS names the columns; the last only with a policy in force', () => {
    expect(YEAR_COLUMNS).toEqual([
      'Year',
      'Homes',
      "From today's pipeline",
      'New projects',
      'From your policy'
    ]);
  });
});
