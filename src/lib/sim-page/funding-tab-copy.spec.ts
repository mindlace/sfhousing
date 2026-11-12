// The Funding tab's announcement and "Sources and tiers" copy (funding-ui spec 4.9, 4.10), and
// the group editor's provenance (4.5 item 5).
import { describe, expect, it } from 'vitest';
import { fixtureCalibration } from '$lib/fzp/fixtures/calibration';
import { dayOf } from '$lib/sim/scenario/dates';
import {
  addProgrammeName,
  affordableCostText,
  baselineProgrammeText,
  checkLineText,
  coverageSummaryText,
  notOfferedText
} from './funding-copy';
import { groupProvenance, tiersText, type CoverageStep } from './funding-view';

const step = (from: number, coverage: number, certain: boolean): CoverageStep => ({
  from,
  coverage,
  certain,
  cityPerHome: 0,
  cityLentPerHome: 0,
  minHomes: 20
});

describe('coverageSummaryText', () => {
  it('reads the line today, then each later step', () => {
    expect(coverageSummaryText([step(0, 1, true), step(dayOf(2027, 7, 1), 0.863, false)])).toBe(
      'Affordable homes: fully funded today; from July 2027, 86%.'
    );
  });

  it('a single step is the coverage line with a full stop', () => {
    expect(coverageSummaryText([step(0, 0.5, false)])).toBe(
      'Affordable homes: 50% of the cost is covered today; they start only by chance.'
    );
  });
});

describe('Sources and tiers lines', () => {
  it('check, cost and not-offered lines', () => {
    expect(checkLineText(780, 1200)).toBe(
      "Today's City money funds about 780 affordable homes a year by this arithmetic; San " +
        "Francisco's bond and tax-credit awards show about 1,200."
    );
    expect(affordableCostText(954_127, 92_602, 1)).toBe(
      "Affordable homes' cost: $954,127 a home, of which $92,602 is paid by the project's own " +
        'loans and other income (Budget Analyst, Exhibit F, tier 1)'
    );
    expect(notOfferedText('A loan', 'No source.')).toBe('Not offered yet: A loan: No source.');
  });
});

describe('groupProvenance', () => {
  it("lists a group's pools' entries, then the entries that name no pool", () => {
    const b = fixtureCalibration().baselineFunding!;
    const labels = (g: 'city' | 'state' | 'federal') => groupProvenance(b, g).map((p) => p.label);
    expect(labels('state')).toEqual([
      'Fixture (tier 4): State of California: housing programmes: $3.0 million a year (a lower bound)',
      "Fixture (tier 4): Income mix and smallest size of the City's 100% affordable new construction"
    ]);
    expect(labels('city')).toHaveLength(7);
    expect(labels('city').every((l) => !l.includes('State of California'))).toBe(true);
    expect(labels('federal')[0]).toContain('Federal: low-income housing tax credits');
  });
});

describe('group editor copy', () => {
  it('a baseline programme line in the 4.5 item 4 wording', () => {
    const tiers = tiersText({ veryLow: 0.52, low: 0.31, moderate: 0.17, aboveModerate: 0 });
    expect(baselineProgrammeText(20, 0.348251, tiers)).toBe(
      'Grants to affordable homes of 20 or more: 34% of the uncovered cost ' +
        '(52% very low, 31% low, 17% moderate)'
    );
    expect(baselineProgrammeText(2, 0.072329, null)).toBe(
      'Grants to affordable homes of 2 or more: 7.2% of the uncovered cost'
    );
  });

  it('+ What it pays for is named starting with its visible label', () => {
    expect(addProgrammeName('City')).toBe('What it pays for: add a programme to City');
  });
});
