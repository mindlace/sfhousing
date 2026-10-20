import { describe, expect, it } from 'vitest';
import { formatCompactCount, formatCount } from '$lib/scoreboard';
import type { TimelineScore } from '$lib/sim/protocol';
import { CHART_H, COLORS, SERIES_NAME, chartLabel, chartModel, niceCeil, tableRows } from './chart';
import {
  FIX_ASOF,
  FIX_HORIZON,
  TIMELINE_SCORE,
  TIMELINE_SCORE_R0,
  makeTimelineScore
} from './fixtures/timeline-score';
import { dayFromUtc, monthIndex } from './time';

const W = 300;

/** The numbers of an SVG path, as [x, y] pairs. */
function points(path: string): [number, number][] {
  const nums = (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
}

/** A score whose shown completedNet climbs linearly to `final` at the last month. */
function climbingTo(final: number): TimelineScore {
  const s = makeTimelineScore();
  s.shown = s.shown.map((r, i) => ({ ...r, completedNet: (final * i) / 290 }));
  return s;
}

describe('niceCeil', () => {
  it.each([
    [0, 1],
    [1, 1],
    [1.2, 2],
    [3, 5],
    [7, 10],
    [82069, 100000],
    [120001, 200000],
    [100000, 100000],
    [350, 500]
  ])('niceCeil(%d) = %d', (v, want) => {
    expect(niceCeil(v)).toBe(want);
  });
});

describe('chartModel', () => {
  const m = chartModel(TIMELINE_SCORE, FIX_ASOF, FIX_HORIZON, W);

  it('has the fixed height and spans asOf to the horizon', () => {
    expect(CHART_H).toBe(140);
    expect(m.width).toBe(W);
    expect(m.height).toBe(CHART_H);
    expect(m.x(FIX_ASOF)).toBe(0);
    expect(m.x(FIX_HORIZON)).toBe(W);
  });

  it('labels 2030, 2040 and 2050 at January 1', () => {
    expect(m.xTicks.map((t) => t.label)).toEqual(['2030', '2040', '2050']);
    expect(m.xTicks.map((t) => t.x)).toEqual(
      [2030, 2040, 2050].map((y) => m.x(dayFromUtc(y, 1, 1)))
    );
  });

  it('labels 2030, 2040, 2050 and 2060 for a 2066 horizon', () => {
    const long = chartModel(TIMELINE_SCORE, FIX_ASOF, dayFromUtc(2066, 12, 31), W);
    expect(long.xTicks.map((t) => t.label)).toEqual(['2030', '2040', '2050', '2060']);
  });

  it('labels every 20 years past a 50-year span', () => {
    const long = chartModel(TIMELINE_SCORE, FIX_ASOF, dayFromUtc(2100, 12, 31), W);
    expect(long.xTicks.map((t) => t.label)).toEqual(['2040', '2060', '2080', '2100']);
  });

  it('sets yMax to niceCeil of the largest drawn value, RHNA included', () => {
    expect(m.yMax).toBe(niceCeil(82069));
    // The baseline (12,000) decides the step: 190,000 alone rounds to 200,000, 202,000 to 500,000.
    expect(chartModel(climbingTo(190000), FIX_ASOF, FIX_HORIZON, W).yMax).toBe(500000);
  });

  it('includes the band high plus baseline and the references in yMax', () => {
    const band = makeTimelineScore();
    band.band = band.band.map((b, i) => ({ ...b, p90: (195000 * i) / 290 }));
    // 195,000 alone rounds to 200,000; with the baseline it is 207,000, so 500,000
    expect(chartModel(band, FIX_ASOF, FIX_HORIZON, W).yMax).toBe(500000);
    const ref = makeTimelineScore();
    ref.references[0] = { ...ref.references[0], units: 150000 };
    expect(chartModel(ref, FIX_ASOF, FIX_HORIZON, W).yMax).toBe(200000);
  });

  it('draws three gridlines labelled with formatCompactCount', () => {
    const flat = chartModel(TIMELINE_SCORE_R0, FIX_ASOF, FIX_HORIZON, W);
    expect(flat.gridlines).toHaveLength(3);
    expect(flat.gridlines.map((g) => g.label)).toEqual(
      [0, flat.yMax / 2, flat.yMax].map((v) => formatCompactCount(v))
    );
    expect(flat.gridlines[0].y).toBe(CHART_H);
    expect(flat.gridlines[2].y).toBe(0);
    // a floor of -500 is under 1 px from zero, so it gets no gridline of its own
    expect(m.yMin).toBe(-500);
    expect(m.gridlines.map((g) => g.label)).toEqual(
      [0, m.yMax / 2, m.yMax].map((v) => formatCompactCount(v))
    );
  });

  it('plots point i at the end of month i, the last at the horizon', () => {
    const pts = points(m.total);
    const y = (v: number) => CHART_H - ((v - m.yMin) / (m.yMax - m.yMin)) * CHART_H;
    expect(pts).toHaveLength(291);
    expect(m.total.startsWith('M')).toBe(true);
    expect(pts[0][0]).toBeCloseTo(m.x(TIMELINE_SCORE.months[1]), 1);
    expect(pts[0][1]).toBeCloseTo(y(12000), 1);
    expect(pts[1][1]).toBeCloseTo(y(12100), 1);
    expect(pts[289][0]).toBeCloseTo(m.x(TIMELINE_SCORE.months[290]), 1);
    expect(pts[290][0]).toBeCloseTo(m.x(FIX_HORIZON), 1);
    expect(pts[290][1]).toBeCloseTo(y(12000 + 29000), 1);
  });

  it('draws pipeline and new projects without the baseline', () => {
    const y = (v: number) => CHART_H - ((v - m.yMin) / (m.yMax - m.yMin)) * CHART_H;
    expect(points(m.pipeline)[1][1]).toBeCloseTo(y(60), 1);
    expect(points(m.fresh)[1][1]).toBeCloseTo(y(40), 1);
  });

  it('closes the band area', () => {
    expect(m.band).not.toBeNull();
    expect(m.band!.startsWith('M')).toBe(true);
    expect(m.band!.endsWith('Z')).toBe(true);
    expect(points(m.band!)).toHaveLength(2 * 291);
  });

  it('has no band path when the band is empty', () => {
    expect(
      chartModel({ ...makeTimelineScore(), band: [] }, FIX_ASOF, FIX_HORIZON, W).band
    ).toBeNull();
  });

  it('places RHNA and the two verticals', () => {
    expect(m.rhnaY).toBeCloseTo(CHART_H - ((82069 - m.yMin) / (m.yMax - m.yMin)) * CHART_H, 6);
    expect(m.verticals).toEqual([
      { x: m.x(dayFromUtc(2031, 1, 31)), label: 'RHNA deadline' },
      { x: m.x(dayFromUtc(2045, 6, 30)), label: '2045' }
    ]);
  });

  it('draws plan-effect series with an end-of-month x', () => {
    expect(m.planCompleted).not.toBeNull();
    expect(m.planEntitled).not.toBeNull();
    expect(m.planBand).not.toBeNull();
    expect(m.planBand!.endsWith('Z')).toBe(true);
    expect(points(m.planCompleted!)[0][0]).toBeCloseTo(m.x(TIMELINE_SCORE.months[1]), 1);
    expect(points(m.planEntitled!)[290][0]).toBeCloseTo(W, 1);
  });
});

describe('references', () => {
  const m = chartModel(TIMELINE_SCORE, FIX_ASOF, FIX_HORIZON, W);

  it('runs from max(from, asOf) to by at the units level', () => {
    const [planning, controller] = m.references;
    const y = (v: number) => CHART_H - ((v - m.yMin) / (m.yMax - m.yMin)) * CHART_H;
    expect(planning.x1).toBe(0);
    expect(planning.x2).toBe(m.x(dayFromUtc(2045, 12, 31)));
    expect(planning.y).toBeCloseTo(y(39000), 6);
    expect(controller.x2).toBe(m.x(dayFromUtc(2045, 6, 30)));
    expect(controller.y).toBeCloseTo(y(14646), 6);
  });

  it('starts at from when from is after asOf', () => {
    const s = makeTimelineScore();
    s.references[0] = { ...s.references[0], from: dayFromUtc(2030, 1, 1) };
    expect(chartModel(s, FIX_ASOF, FIX_HORIZON, W).references[0].x1).toBe(
      chartModel(s, FIX_ASOF, FIX_HORIZON, W).x(dayFromUtc(2030, 1, 1))
    );
  });

  it('takes the colour of the series its measure names', () => {
    expect(m.references.map((r) => r.color)).toEqual([COLORS.plan, COLORS.plan]);
    const s = makeTimelineScore();
    s.references[0] = { ...s.references[0], measure: 'completedNet' };
    expect(chartModel(s, FIX_ASOF, FIX_HORIZON, W).references[0].color).toBe(COLORS.total);
  });

  it('ends each label with the series to compare with', () => {
    expect(m.references[0].label).toBe(
      `${TIMELINE_SCORE.references[0].label} (compare with: ${SERIES_NAME.planEntitled})`
    );
    expect(m.references[1].label).toBe(
      `${TIMELINE_SCORE.references[1].label} (compare with: ${SERIES_NAME.planCompleted})`
    );
    const s = makeTimelineScore();
    s.references[0] = { ...s.references[0], measure: 'completedNet' };
    expect(chartModel(s, FIX_ASOF, FIX_HORIZON, W).references[0].label).toMatch(
      /\(compare with: Total net new homes\)$/
    );
  });
});

describe('series names and colours', () => {
  it('names every series', () => {
    expect(SERIES_NAME).toEqual({
      total: 'Total net new homes',
      pipeline: "From today's pipeline",
      fresh: 'New projects',
      planCompleted: 'Plan effect, completed',
      planEntitled: 'Plan effect, approved',
      band: '8 in 10 futures',
      planBand: 'Plan effect, 8 in 10 futures'
    });
    expect(COLORS).toEqual({
      total: '#1d4ed8',
      pipeline: '#374151',
      fresh: '#b45309',
      plan: '#6d28d9'
    });
  });
});

describe('chart domain extends below zero', () => {
  it('uses the most negative drawn value, here the plan band low', () => {
    const m = chartModel(TIMELINE_SCORE, FIX_ASOF, FIX_HORIZON, W);
    expect(m.yMin).toBe(-niceCeil(350));
    const zero = m.gridlines.find((g) => g.label === '0');
    expect(zero).toBeDefined();
    expect(zero!.y).toBeCloseTo((m.yMax / (m.yMax - m.yMin)) * CHART_H, 6);
    // the lowest plan-band point sits inside the plot
    const lows = points(m.planBand!).map(([, y]) => y);
    expect(Math.max(...lows)).toBeLessThanOrEqual(CHART_H);
    expect(Math.max(...lows)).toBeGreaterThan(zero!.y);
  });

  it('adds a floor gridline only when it is at least 12 px below the zero line', () => {
    const deep = makeTimelineScore();
    deep.planEffectBand = deep.planEffectBand.map((p) => ({ ...p, p10: p.p10 - 9000 }));
    const m = chartModel(deep, FIX_ASOF, FIX_HORIZON, W);
    expect(m.yMin).toBe(-10000);
    expect(m.gridlines.map((g) => g.label)).toEqual(['−10,000', '0', '50,000', '100K']);
    const [floor, zero] = m.gridlines;
    expect(floor.y).toBe(CHART_H);
    expect(floor.y - zero.y).toBeGreaterThanOrEqual(12);
  });

  it('suppresses the floor gridline when it would crowd zero', () => {
    const m = chartModel(TIMELINE_SCORE, FIX_ASOF, FIX_HORIZON, W);
    const zero = m.gridlines.find((g) => g.label === '0')!;
    expect(CHART_H - zero.y).toBeLessThan(12);
    expect(m.gridlines).toHaveLength(3);
    expect(m.gridlines.every((g) => g.label !== formatCompactCount(m.yMin))).toBe(true);
  });

  it('stays at 0 when no drawn series is negative', () => {
    const s = makeTimelineScore();
    s.planEffect = s.planEffect.map((p) => ({
      completedNetNew: p.completedNetNew + 300,
      entitledNew: p.entitledNew + 200
    }));
    s.planEffectBand = s.planEffectBand.map((p) => ({
      p10: p.p10 + 350,
      p50: p.p50 + 350,
      p90: p.p90 + 350
    }));
    const m = chartModel(s, FIX_ASOF, FIX_HORIZON, W);
    expect(m.yMin).toBe(0);
    expect(m.gridlines.map((g) => g.label)).toEqual(['0', '50,000', '100K']);
  });
});

describe('chartModel in revision 0', () => {
  const m = chartModel(TIMELINE_SCORE_R0, FIX_ASOF, FIX_HORIZON, W);

  it('draws no plan series but keeps the references', () => {
    expect(m.planCompleted).toBeNull();
    expect(m.planEntitled).toBeNull();
    expect(m.planBand).toBeNull();
    expect(m.references).toHaveLength(2);
  });

  it('ignores the empty series in the domain', () => {
    expect(m.yMin).toBe(0);
    expect(m.yMax).toBe(niceCeil(82069));
  });
});

describe('tableRows', () => {
  const rows = tableRows(TIMELINE_SCORE, FIX_ASOF);

  it('has one row per January, the deadline and the final month, with no duplicates', () => {
    const idx = rows.map((r) => r.index);
    expect(idx).toEqual([...new Set(idx)].sort((a, b) => a - b));
    const januaries = Array.from({ length: 24 }, (_, k) =>
      monthIndex(dayFromUtc(2027 + k, 1, 1), TIMELINE_SCORE.months[0], 291)
    );
    for (const i of januaries) expect(idx).toContain(i);
    expect(idx).toContain(51);
    expect(idx[idx.length - 1]).toBe(290);
    // January 2031 is the RHNA deadline's month: one row, not two
    expect(rows).toHaveLength(25);
  });

  it('dates ordinary rows by month and the deadline row by date', () => {
    expect(rows[0].date).toBe('January 2027');
    expect(rows.find((r) => r.index === 51)!.date).toBe('Jan 31, 2031');
    expect(rows[rows.length - 1].date).toBe('December 2050');
  });

  it('adds a separate deadline row when the deadline is not in January', () => {
    const s = makeTimelineScore();
    s.targets = s.targets.map((t) => ({ ...t, deadline: dayFromUtc(2031, 6, 30) }));
    const out = tableRows(s, FIX_ASOF);
    expect(out).toHaveLength(26);
    const at = out.map((r) => r.index);
    expect(at.indexOf(56)).toBe(at.indexOf(51) + 1);
  });

  it('formats every cell', () => {
    const r = rows.find((x) => x.index === 51)!;
    expect(r).toEqual({
      index: 51,
      date: 'Jan 31, 2031',
      total: formatCount(12000 + 5100),
      pipeline: formatCount(3060),
      fresh: formatCount(2040),
      planCompleted: formatCount(30 * 51 - 300),
      planEntitled: formatCount(45 * 51 - 200),
      band: `${formatCount(12000 + 4590)}–${formatCount(12000 + 5610)}`,
      planBand: `${formatCount(30 * 51 - 350)}–${formatCount(30 * 51 - 250)}`
    });
  });

  it('reads "calculating…" for the plan cells in revision 0', () => {
    for (const r of tableRows(TIMELINE_SCORE_R0, FIX_ASOF)) {
      expect(r.planCompleted).toBe('calculating…');
      expect(r.planEntitled).toBe('calculating…');
      expect(r.planBand).toBe('calculating…');
      expect(r.band).not.toBe('calculating…');
    }
  });

  it('reads "calculating…" for the band while it is empty', () => {
    const out = tableRows({ ...makeTimelineScore(), band: [] }, FIX_ASOF);
    expect(out.every((r) => r.band === 'calculating…')).toBe(true);
  });
});

describe('chartLabel', () => {
  it('summarises the total at the deadline, 2045 and the end', () => {
    const at2045 = monthIndex(dayFromUtc(2045, 6, 30), TIMELINE_SCORE.months[0], 291);
    expect(chartLabel(TIMELINE_SCORE)).toBe(
      'Net new homes in this simulation: 17,100 by the RHNA deadline, ' +
        `${formatCount(12000 + 100 * at2045)} by 2045, ` +
        `${formatCount(12000 + 29000)} by the end of 2050.`
    );
  });

  it('names the last year of the score', () => {
    const s = makeTimelineScore();
    s.months = [...s.months.slice(0, -1), dayFromUtc(2066, 12, 1)];
    expect(chartLabel(s)).toContain('by the end of 2066.');
  });
});
