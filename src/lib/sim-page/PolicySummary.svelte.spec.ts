// The read-only policy summary (plan 5, Call 15): what a shared policy turns on, in words, with
// the timelines' changed stages behind a disclosure.
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import { fixtureCalibration } from '$lib/fzp/fixtures/calibration';
import type { LotStatus } from './brush-summary';
import { DEFAULT_BANDS, type CustomBrush, type SimPolicy, type ZoningRule } from './policy';
import PolicySummary from './PolicySummary.svelte';
import { DEFAULT_POLICY } from './sim-doc';
import { OBSERVED_TIMING, setStageMonths } from './timing';
import { dayOf } from '$lib/sim/scenario/dates';
import {
  BOND_POLICY,
  FUND_ASOF,
  TERM_POLICY,
  fundingCalibration,
  policyWith
} from './test/funding';

const calibration = fixtureCalibration();
const FINDING: LotStatus = { kind: 'finding' };

const transit: ZoningRule = {
  id: 't1',
  kind: 'transit',
  stopTypes: ['metro'],
  bands: DEFAULT_BANDS
};
const paint: CustomBrush = {
  id: 'p1',
  kind: 'paint',
  strokes: [
    { path: [[-122.42, 37.76]], radiusM: 30 },
    { path: [[-122.41, 37.76]], radiusM: 30 }
  ],
  stories: 8
};

function customPolicy(): SimPolicy {
  const { set } = setStageMonths(
    calibration,
    OBSERVED_TIMING.current,
    'discretionary',
    'permitFiled',
    6
  );
  return {
    ...DEFAULT_POLICY,
    rules: [transit],
    custom: [paint],
    protect: { ...DEFAULT_POLICY.protect, rentControl: true, newerThanYears: 20 },
    timing: { current: set, saved: null }
  };
}

describe('PolicySummary', () => {
  it('the default policy lists no transit layers, no painted areas and SF as observed', async () => {
    render(PolicySummary, { policy: DEFAULT_POLICY, calibration, lotsOf: () => FINDING });
    await expect.element(page.getByText('SF as observed', { exact: true })).toBeVisible();
    // The sections use the editing tabs' words (spec Goal 10), not the old section titles.
    await expect
      .element(page.getByRole('region', { name: 'Transit layers' }).getByText('No transit layers'))
      .toBeVisible();
    await expect
      .element(page.getByRole('region', { name: 'Painted areas' }).getByText('No painted areas'))
      .toBeVisible();
    expect(page.getByText(/new zoning rules|custom zoning/i).elements()).toHaveLength(0);
    // No zoning layers or comparison line any more.
    expect(page.getByText(/zoning layers|Compared with/i).elements()).toHaveLength(0);
    expect(page.getByText('Family Zoning Plan map').elements()).toHaveLength(0);
    // Nothing differs from observed: no disclosure to open (the Public money section has none).
    expect(page.getByRole('button').elements()).toHaveLength(0);
  });

  it('lists the rule, the custom brush, the protections and the changed stage', async () => {
    const found = (lots: number): LotStatus => ({ kind: 'found', lots });
    render(PolicySummary, {
      policy: customPolicy(),
      calibration,
      lotsOf: (key) => (key === 'rule:t1' ? found(1204) : key === 'custom:p1' ? found(31) : FINDING)
    });
    await expect
      .element(
        page.getByText(
          'Up to 6 stories within 402 m, 4 stories within 805 m · Near Muni Metro · 1,204 lots'
        )
      )
      .toBeVisible();
    await expect.element(page.getByText('Allow 8 stories · 2 strokes · 31 lots')).toBeVisible();
    await expect
      .element(page.getByText('Rent-controlled buildings; buildings newer than 20 years'))
      .toBeVisible();
    await expect.element(page.getByText('Custom (from SF as observed)')).toBeVisible();

    const disclosure = page.getByRole('button', { name: 'Shares and changed stages' });
    await expect.element(disclosure).toHaveAttribute('aria-expanded', 'false');
    // The brief's example reads "(observed 12)"; fixture-0's observed permit review is 7 months.
    const line = 'Permit review, discretionary: 6 months (observed 7)';
    const region = document.getElementById(disclosure.element().getAttribute('aria-controls')!)!;
    expect(region.textContent).toContain(line);
    await expect.element(page.getByText(line)).not.toBeVisible();

    await disclosure.click();
    await expect.element(disclosure).toHaveAttribute('aria-expanded', 'true');
    await expect.element(page.getByText(line)).toBeVisible();
  });

  it('without a calibration it still names the timelines, with no stage details', async () => {
    render(PolicySummary, { policy: customPolicy(), calibration: null, lotsOf: () => FINDING });
    await expect.element(page.getByText('Custom (from SF as observed)')).toBeVisible();
    await expect.element(page.getByText(/Finding lots/).first()).toBeVisible();
    expect(page.getByRole('button').elements()).toHaveLength(0);
  });

  describe('lot lookup states', () => {
    const withLots = (status: LotStatus) =>
      render(PolicySummary, { policy: customPolicy(), calibration, lotsOf: () => status });

    it('a failed lookup reads "Couldn\'t find lots" on the rule and the custom brush', async () => {
      withLots({ kind: 'failed', keys: ['t1'] });
      await expect.element(page.getByText(/Couldn't find lots/).first()).toBeVisible();
      expect(page.getByText(/· Couldn't find lots$/).elements()).toHaveLength(2);
      expect(page.getByText(/Finding lots/).elements()).toHaveLength(0);
    });

    it('a finding lookup reads "Finding lots…"', async () => {
      withLots({ kind: 'finding' });
      await expect.element(page.getByText(/Finding lots…/).first()).toBeVisible();
      expect(page.getByText(/Couldn't find lots/).elements()).toHaveLength(0);
    });

    it('a found lookup reads the count', async () => {
      withLots({ kind: 'found', lots: 1204 });
      await expect.element(page.getByText(/1,204 lots/).first()).toBeVisible();
      expect(page.getByText(/1,204 lots/).elements()).toHaveLength(2);
      expect(page.getByText(/Finding lots|Couldn't find lots/).elements()).toHaveLength(0);
    });
  });
});

describe('PolicySummary: Public money (funding-ui 4.14)', () => {
  const fcal = fundingCalibration();
  const JULY_2027 = dayOf(2027, 7, 1);
  const region = () => page.getByRole('region', { name: 'Public money' });
  const rows = () =>
    [...region().element().querySelectorAll('li')].map((li) => li.textContent?.trim());

  it('As today', async () => {
    render(PolicySummary, { policy: DEFAULT_POLICY, calibration: fcal, lotsOf: () => FINDING });
    await expect.element(region()).toBeVisible();
    // The coverage line sits on top when the calibration has baselineFunding.
    await expect.element(region().getByText('Affordable homes: fully funded today')).toBeVisible();
    expect(rows()[0]).toBe("Today's funding: as today");
    // The section comes after "Permitting timelines".
    const headings = [...document.querySelectorAll('h3')].map((h) => h.textContent);
    expect(headings.slice(-2)).toEqual(['Permitting timelines', 'Public money']);
    // Read-only: no controls in the section.
    expect(region().getByRole('button').elements()).toHaveLength(0);
  });

  it('dated change row reads switched off at scale 0 on a capped pool', async () => {
    const policy = policyWith({ baselineScale: [{ pool: 'state', from: JULY_2027, scale: 0 }] });
    render(PolicySummary, { policy, calibration: fcal, lotsOf: () => FINDING });
    await expect.element(region()).toBeVisible();
    expect(rows()[0]).toBe('State money: switched off from July 2027');
    expect(rows()).not.toContain("Today's funding: as today");
  });

  it('a City-group change is one row, worded as a share of today', async () => {
    const JULY_2029 = dayOf(2029, 7, 1);
    const policy = policyWith({
      baselineScale: [
        { pool: 'city-gf', from: JULY_2029, scale: 2 },
        { pool: 'city-tax', from: JULY_2029, scale: 2 }
      ]
    });
    render(PolicySummary, { policy, calibration: fcal, lotsOf: () => FINDING });
    await expect.element(region()).toBeVisible();
    expect(rows().filter((r) => r?.startsWith('City money'))).toEqual([
      "City money: 200% of today's from July 2029"
    ]);
  });

  it('pool and its programme rows', async () => {
    render(PolicySummary, { policy: BOND_POLICY, calibration: fcal, lotsOf: () => FINDING });
    const pool = region().getByText(
      'City bond, 2028: $300 million in July 2028; repaid at 6% over 20 years',
      { exact: true }
    );
    await expect.element(pool).toBeVisible();
    const programme = region().getByText(
      'Grant to affordable homes of 20 homes or more: 35% of the uncovered cost',
      { exact: true }
    );
    await expect.element(programme).toBeVisible();
    // The programme row is indented under its pool, and comes right after it.
    expect(programme.element().getAttribute('data-indent')).toBe('true');
    expect(pool.element().getAttribute('data-indent')).toBe('false');
    expect(pool.element().nextElementSibling).toBe(programme.element());
    expect(region().getByText('No money added').elements()).toHaveLength(0);
  });

  it('added programme on a baseline pool reads Added to the City', async () => {
    const policy = policyWith({
      programmes: [
        {
          id: 'u-prog-1',
          label: 'stale stored label',
          pool: 'city-tax',
          reach: 'affordable',
          instrument: { kind: 'grant', share: 0.1 },
          from: FUND_ASOF,
          to: null,
          minHomes: 20,
          tiers: { veryLow: 0.52, low: 0.31, moderate: 0.17, aboveModerate: 0 }
        }
      ]
    });
    render(PolicySummary, { policy, calibration: fcal, lotsOf: () => FINDING });
    await expect
      .element(
        region().getByText(
          'Added to the City: Grant to affordable homes of 20 homes or more: 10% of the uncovered cost',
          { exact: true }
        )
      )
      .toBeVisible();
    // The stored label is never shown: the sentence is computed live.
    expect(
      region()
        .getByText(/stale stored label/)
        .elements()
    ).toHaveLength(0);
    expect(region().getByText('No money added').elements()).toHaveLength(0);
  });

  it('typed term row', async () => {
    render(PolicySummary, { policy: TERM_POLICY, calibration: fcal, lotsOf: () => FINDING });
    await expect
      .element(
        region().getByText('Guarantee rate cut: 0.5 points (custom, not sourced)', { exact: true })
      )
      .toBeVisible();
  });

  it('(custom, not sourced) on an edited bond rate', async () => {
    const policy = structuredClone(BOND_POLICY);
    policy.funding.pools[0].debt = { rate: 0.07, termYears: 20 };
    render(PolicySummary, { policy, calibration: fcal, lotsOf: () => FINDING });
    await expect
      .element(
        region().getByText(
          'City bond, 2028: $300 million in July 2028; repaid at 7% (custom, not sourced) over 20 years',
          { exact: true }
        )
      )
      .toBeVisible();
  });

  it('No money added', async () => {
    render(PolicySummary, { policy: DEFAULT_POLICY, calibration: fcal, lotsOf: () => FINDING });
    const none = region().getByText('No money added', { exact: true });
    await expect.element(none).toBeVisible();
    expect(none.element().className).toContain('text-ink-muted');
  });

  it('with a null calibration the section shows the rows only', async () => {
    render(PolicySummary, { policy: BOND_POLICY, calibration: null, lotsOf: () => FINDING });
    await expect
      .element(region().getByText(/^City bond, 2028: \$300 million in July 2028/))
      .toBeVisible();
    expect(
      region()
        .getByText(/^Affordable homes:/)
        .elements()
    ).toHaveLength(0);
  });
});
