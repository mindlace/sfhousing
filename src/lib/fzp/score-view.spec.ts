import { describe, expect, it } from 'vitest';
import {
  FIX_ASOF,
  TIMELINE_SCORE,
  TIMELINE_SCORE_NO_PHASING,
  TIMELINE_SCORE_R0,
  makeTimelineScore
} from './fixtures/timeline-score';
import {
  CALCULATING,
  RHNA_ID,
  announcement,
  bandLine,
  barText,
  deadlineIndex,
  formatRange,
  inProgressRows,
  phasingFootnote,
  planBandLine,
  scoreAt,
  scrubMarkers
} from './score-view';
import { YEAR_2045, dayFromUtc } from './time';

const DEADLINE = dayFromUtc(2031, 1, 31);

describe('shared copy', () => {
  it('is defined once: calculating, the en-dash range and the RHNA id', () => {
    expect(CALCULATING).toBe('calculating…');
    expect(formatRange(12300, 15800)).toBe('12,300–15,800');
    expect(RHNA_ID).toBe('rhna');
  });
});

describe('deadlineIndex', () => {
  it('is the month index of the deadline', () => {
    expect(deadlineIndex(TIMELINE_SCORE, DEADLINE)).toBe(51);
  });

  it('clamps to the series', () => {
    expect(deadlineIndex(TIMELINE_SCORE, dayFromUtc(2020, 1, 1))).toBe(0);
    expect(deadlineIndex(TIMELINE_SCORE, dayFromUtc(2090, 1, 1))).toBe(290);
  });
});

describe('scoreAt', () => {
  const at = scoreAt(TIMELINE_SCORE, 50);

  it('reads the shown run, the baseline and the plan effect', () => {
    expect(at.monthIndex).toBe(50);
    expect(at.total).toBe(12000 + 5000);
    expect(at.actual).toBe(12000);
    expect(at.pipeline).toBe(3000);
    expect(at.fresh).toBe(2000);
    expect(at.planCompleted).toBe(1200);
    expect(at.planEntitled).toBe(2050);
    expect(at.exitedUnits).toBe(250);
  });

  it('puts the baseline on the band but not on the plan band', () => {
    expect(at.planBand).toEqual({ low: 1150, high: 1250 });
    expect(at.band).toEqual({ low: 12000 + 4500, high: 12000 + 5500 });
  });

  it('lists the in-progress stages in stage order', () => {
    expect(at.inProgress.map((r) => r.stage)).toEqual([
      'preApplication',
      'filed',
      'entitled',
      'permitFiled',
      'permitIssued',
      'construction'
    ]);
    expect(at.inProgress.map((r) => r.units)).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it('carries target progress now and at the deadline', () => {
    expect(at.targets).toHaveLength(2);
    expect(at.targets[0].tp.target.id).toBe('rhna');
    expect(at.targets[0].tp.fraction).toBe(17000 / 82069);
    expect(at.targets[0].atDeadline).toBe(TIMELINE_SCORE.targets[0].fraction[51]);
    expect(at.targets[1].tp.target.id).toBe('rhna-buffer');
  });

  it('has a null band when the band is empty', () => {
    expect(scoreAt({ ...makeTimelineScore(), band: [] }, 50).band).toBeNull();
  });

  it('has null plan values in revision 0 and every other field unchanged', () => {
    const r0 = scoreAt(TIMELINE_SCORE_R0, 50);
    expect(r0.planCompleted).toBeNull();
    expect(r0.planEntitled).toBeNull();
    expect(r0.planBand).toBeNull();
    expect({ ...r0, planCompleted: 1, planEntitled: 1, planBand: null }).toEqual({
      ...at,
      planCompleted: 1,
      planEntitled: 1,
      planBand: null
    });
  });
});

describe('inProgressRows', () => {
  it('lists stage-order stages first, then unknown keys, labelled', () => {
    const rows = inProgressRows({ ...TIMELINE_SCORE.shown[1].inProgress, designReview: 7 });
    expect(rows.map((r) => r.stage)).toEqual([
      'preApplication',
      'filed',
      'entitled',
      'permitFiled',
      'permitIssued',
      'construction',
      'designReview'
    ]);
    expect(rows[0]).toEqual({ stage: 'preApplication', label: 'Pre-application', units: 10 });
    expect(rows[5].label).toBe('Under construction');
    expect(rows[6]).toEqual({ stage: 'designReview', label: 'designReview', units: 7 });
  });

  it('orders by stage, not by key order', () => {
    const rows = inProgressRows({ construction: 1, filed: 2 });
    expect(rows.map((r) => r.stage)).toEqual(['filed', 'construction']);
  });
});

describe('bandLine', () => {
  it('shows the range with the provisional suffix', () => {
    expect(bandLine(TIMELINE_SCORE, 50, true)).toEqual({
      text: 'In 8 of 10 simulated futures: 16,500–17,500 (still calculating)',
      busy: true
    });
  });

  it('drops the suffix once the band is complete', () => {
    expect(bandLine(TIMELINE_SCORE, 50, false)).toEqual({
      text: 'In 8 of 10 simulated futures: 16,500–17,500',
      busy: false
    });
  });

  it('reads "Range: calculating…" until any band value exists', () => {
    const none = { ...makeTimelineScore(), band: [] };
    expect(bandLine(none, 50, true)).toEqual({ text: 'Range: calculating…', busy: true });
    expect(bandLine(none, 50, false)).toEqual({ text: 'Range: calculating…', busy: true });
  });
});

describe('planBandLine', () => {
  it('shows the range without the baseline', () => {
    expect(planBandLine(TIMELINE_SCORE, 50, false)).toEqual({
      text: 'In 8 of 10 futures: 1,150–1,250',
      busy: false
    });
    expect(planBandLine(TIMELINE_SCORE, 50, true)).toEqual({
      text: 'In 8 of 10 futures: 1,150–1,250 (still calculating)',
      busy: true
    });
  });

  it('uses the U+2212 minus for negative values', () => {
    expect(planBandLine(TIMELINE_SCORE, 0, false).text).toBe('In 8 of 10 futures: −350–−250');
  });

  it('reads "Range: calculating…" while planEffectBand is empty', () => {
    expect(planBandLine(TIMELINE_SCORE_R0, 50, false)).toEqual({
      text: 'Range: calculating…',
      busy: true
    });
  });
});

describe('phasingFootnote', () => {
  const head =
    'Multi-phase projects: 5 phases scheduled from published plans, 3 estimated from past projects';

  it('counts drawn and score-only projects', () => {
    expect(phasingFootnote(TIMELINE_SCORE.phasing)).toBe(
      `${head}; 2 projects without phase data are simulated as one project each: ` +
        '1 drawn as one footprint on a free lot, 1 counted in the score but not drawn.'
    );
  });

  it('omits the score-only clause with its comma when every project is drawn', () => {
    const p = {
      ...TIMELINE_SCORE.phasing,
      unenriched: TIMELINE_SCORE.phasing.unenriched.filter((u) => u.drawn)
    };
    expect(phasingFootnote(p)).toBe(
      `${head}; 1 projects without phase data are simulated as one project each: ` +
        '1 drawn as one footprint on a free lot.'
    );
  });

  it('omits the drawn clause when none is drawn', () => {
    const p = {
      ...TIMELINE_SCORE.phasing,
      unenriched: TIMELINE_SCORE.phasing.unenriched.filter((u) => !u.drawn)
    };
    expect(phasingFootnote(p)).toBe(
      `${head}; 1 projects without phase data are simulated as one project each: ` +
        '1 counted in the score but not drawn.'
    );
  });

  it('ends after "estimated from past projects" with no unenriched projects', () => {
    expect(phasingFootnote({ ...TIMELINE_SCORE.phasing, unenriched: [] })).toBe(`${head}.`);
  });

  it('is null when there are no master plans', () => {
    expect(phasingFootnote(TIMELINE_SCORE_NO_PHASING.phasing)).toBeNull();
  });
});

describe('scrubMarkers', () => {
  it('marks the RHNA deadline and the 2045 reference', () => {
    expect(scrubMarkers(TIMELINE_SCORE)).toEqual([
      {
        day: DEADLINE,
        label: 'RHNA deadline',
        name: 'Jump to RHNA deadline, January 2031'
      },
      { day: dayFromUtc(2045, 6, 30), label: '2045', name: 'Jump to 2045' }
    ]);
  });

  it('falls back to 2045-01-01 with no reference in 2045', () => {
    const s = { ...makeTimelineScore(), references: [] };
    expect(scrubMarkers(s)[1].day).toBe(YEAR_2045);
  });

  it('ignores references outside 2045', () => {
    const s = makeTimelineScore();
    s.references = s.references.map((r) => ({ ...r, by: dayFromUtc(2040, 1, 1) }));
    expect(scrubMarkers(s)[1].day).toBe(YEAR_2045);
  });

  it('drops the RHNA marker without an rhna target', () => {
    const s = makeTimelineScore();
    s.targets = s.targets.filter((t) => t.target.id !== 'rhna');
    const markers = scrubMarkers(s);
    expect(markers.map((m) => m.label)).toEqual(['2045']);
  });
});

describe('announcement and barText', () => {
  const at = scoreAt(TIMELINE_SCORE, 50);

  it('speaks the month, the total and the RHNA share', () => {
    expect(announcement(dayFromUtc(2031, 3, 1), at)).toBe(
      'March 2031: 17,000 net new homes in this simulation, 20% of RHNA.'
    );
  });

  it('shows the collapsed mobile bar line', () => {
    expect(barText(at)).toBe('17,000 net new homes · 20% of RHNA');
  });

  it('compacts large totals on the bar only', () => {
    const big = { ...at, total: 123_456 };
    expect(barText(big)).toBe('123.5K net new homes · 20% of RHNA');
    expect(announcement(FIX_ASOF, big)).toContain('123,456 net new homes');
  });
});
