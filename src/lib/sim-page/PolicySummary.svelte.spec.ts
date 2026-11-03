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
    // Nothing differs from observed: no disclosure to open.
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
