import { describe, expect, it } from 'vitest';
import { EMPTY_LOG, logCompiled, logFilled, viewOfLog } from './chunk-log';
import { YEAR_COLUMNS, yearRows } from './details';
import { calendarMonths, chunk, cut, statics } from './test/fixtures';
import { headlineAt } from './results';
import { formatShortMonthYear } from '$lib/fzp/format';
import { utcParts } from '$lib/fzp/time';

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

  it('yearRows reads one month a year, not every month to the playhead; figures unchanged', () => {
    const long = calendarMonths(
      viewOfLog(logFilled(logCompiled(EMPTY_LOG, statics({ lastIndex: 479 })), chunk(0, 480)))!
    );
    // Every month to i, as the table read before: the rows to match.
    const walk = (v: typeof long, i: number) => {
      const out: { index: number; label: string; homes: number; effect: number }[] = [];
      for (let k = 0; k <= Math.min(i, v.filledThrough); k++) {
        const { y, m } = utcParts(v.months[k]);
        if (m !== 12 && k !== i) continue;
        const label = m === 12 ? String(y) : formatShortMonthYear(v.months[k]);
        out.push({
          index: k,
          label,
          homes: v.rows[k].completedNet,
          effect: v.planEffect[k].completedNetNew
        });
      }
      return out;
    };
    const part = cut(long, 20);
    for (const [v, i] of [
      ...[-1, 0, 1, 11, 12, 13, 200, 478, 479, 600].map((i) => [long, i] as const),
      [part, 13] as const,
      [part, 30] as const
    ])
      expect(
        yearRows(v, i, true).map(({ index, label, homes, effect }) => ({
          index,
          label,
          homes,
          effect
        }))
      ).toEqual(walk(v, i));
    let reads = 0;
    const months = new Proxy(long.months as number[], {
      get(t, p, r) {
        if (typeof p === 'string' && /^\d+$/.test(p)) reads++;
        return Reflect.get(t, p, r);
      }
    });
    const rows = yearRows({ ...long, months }, 479, true);
    expect(rows).toHaveLength(41);
    // Two reads per row (its year and its label) and one to find the first December.
    expect(reads).toBeLessThanOrEqual(2 * rows.length + 1);
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
