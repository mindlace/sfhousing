// The read-only policy summary (plan 5, Call 15): what a shared policy turns on, in words, with
// the timelines' changed stages behind a disclosure.
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import { fixtureCalibration } from '$lib/fzp/fixtures/calibration';
import { brushSummary, type LotStatus } from './brush-summary';
import { DEFAULT_BANDS, type SimPolicy, type ZoningBrush } from './policy';
import PolicySummary from './PolicySummary.svelte';
import { DEFAULT_POLICY } from './sim-doc';
import { OBSERVED_TIMING, setStageMonths } from './timing';

const calibration = fixtureCalibration();
const FINDING: LotStatus = { kind: 'finding' };

const transit: ZoningBrush = {
  id: 't1',
  kind: 'transit',
  stopTypes: ['metro'],
  bands: DEFAULT_BANDS,
  mode: 'raise',
  densityLimits: false
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
    brushes: [transit],
    protect: { ...DEFAULT_POLICY.protect, rentControl: true },
    timing: { current: set, saved: null }
  };
}

describe('PolicySummary', () => {
  it('the default policy lists Current law and SF as observed', async () => {
    render(PolicySummary, { policy: DEFAULT_POLICY, calibration, lotsOf: () => FINDING });
    await expect.element(page.getByText('Current law', { exact: true })).toBeVisible();
    await expect.element(page.getByText('SF as observed', { exact: true })).toBeVisible();
    await expect.element(page.getByText('No brushes')).toBeVisible();
    // Nothing differs from observed: no disclosure to open.
    expect(page.getByRole('button').elements()).toHaveLength(0);
  });

  it('lists the brush, the protection and the changed stage behind a closed disclosure', async () => {
    render(PolicySummary, {
      policy: customPolicy(),
      calibration,
      lotsOf: (key) => (key === 't1' ? { kind: 'found', lots: 1204 } : FINDING)
    });
    await expect.element(page.getByText(brushSummary(transit, '1,204 lots'))).toBeVisible();
    await expect.element(page.getByText(/rent-controlled buildings/i)).toBeVisible();
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
    await expect.element(page.getByText(/Finding lots/)).toBeVisible();
    expect(page.getByRole('button').elements()).toHaveLength(0);
  });

  describe('lot lookup states', () => {
    const withLots = (status: LotStatus) =>
      render(PolicySummary, { policy: customPolicy(), calibration, lotsOf: () => status });

    it('a failed lookup reads "Couldn\'t find lots" on the brush and the protections', async () => {
      const policy = customPolicy();
      policy.protect = { ...policy.protect, strokes: [{ path: [[0, 0]], radiusM: 20 } as never] };
      render(PolicySummary, {
        policy,
        calibration,
        lotsOf: () => ({ kind: 'failed', keys: ['t1'] })
      });
      await expect.element(page.getByText(/Couldn't find lots · /)).toBeVisible();
      await expect.element(page.getByText(/Couldn't find lots by brush/)).toBeVisible();
      expect(page.getByText(/Finding lots/).elements()).toHaveLength(0);
    });

    it('a finding lookup reads "Finding lots…"', async () => {
      withLots({ kind: 'finding' });
      await expect.element(page.getByText(/Finding lots…/)).toBeVisible();
      expect(page.getByText(/Couldn't find lots/).elements()).toHaveLength(0);
    });

    it('a found lookup reads the count', async () => {
      withLots({ kind: 'found', lots: 1204 });
      await expect.element(page.getByText(/1,204 lots/)).toBeVisible();
      expect(page.getByText(/Finding lots|Couldn't find lots/).elements()).toHaveLength(0);
    });
  });
});
