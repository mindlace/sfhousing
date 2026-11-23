/// <reference types="@vitest/browser-playwright" />
import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { cdp, page } from 'vitest/browser';
import axe from 'axe-core';
import '../../routes/layout.css';
import { MARKET_TERMS, resolveTerms } from '$lib/sim/finance';
import type { TimelineScore } from '$lib/sim/protocol';
import type { MoneyView } from '$lib/sim/world/score/types';
import type { Day } from '$lib/timelapse/time';
import { dayFromUtc } from './time';
import MoneyResults from './MoneyResults.svelte';

const CITY = 'City: general-obligation bonds and other debt';
const MONTHS = 60;
const zeros = () => Array.from({ length: MONTHS }, () => 0);
const nulls = () => Array.from({ length: MONTHS }, () => null);

const money: MoneyView = {
  pools: [
    {
      id: 'go',
      label: CITY,
      kind: 'goBond',
      received: zeros(),
      committed: zeros(),
      out: zeros(),
      spent: zeros(),
      repaid: zeros(),
      lost: zeros(),
      lostCredit: zeros()
    }
  ],
  fundedHomes: zeros(),
  displacedHomes: zeros(),
  publicSpent: zeros(),
  owed: [],
  limits: [],
  displacedHomesCompleted: zeros(),
  perAddedHome: { all: null, city: null },
  displacedShare: null,
  perAddedHomeByMonth: { all: nulls(), city: nulls() },
  displacedShareByMonth: nulls(),
  closed: { go: dayFromUtc(2030, 4, 1) },
  shut: { go: Array.from({ length: MONTHS }, () => false) }
};

const score = { money } as unknown as TimelineScore;

function props(at: Day, i = 0) {
  return {
    score,
    i,
    at,
    terms: resolveTerms(MARKET_TERMS),
    pending: false,
    part: 'money' as const
  };
}

async function scheme(value: 'light' | 'dark') {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value }]
  });
}

afterEach(async () => {
  await scheme('light');
});

describe('MoneyResults, ran-out lines', () => {
  it('at March 2030 one ran-out line sits after the all-money line, before Money details', async () => {
    render(MoneyResults, { props: props(dayFromUtc(2030, 3, 1)) });
    const lines = page.getByTestId('fzp-money-closed');
    await expect.element(lines).toHaveTextContent(`${CITY}: ran out Mar 2030`);
    expect(lines.elements()).toHaveLength(1);
    const all = page.getByTestId('fzp-money-all').element();
    const button = page.getByRole('button', { name: /Money details/ }).element();
    const line = lines.element();
    expect(all.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(line.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(line.closest('[aria-live]')).toBeNull();
    expect(line.className).toContain('tabular-nums');
  });

  it('at February 2030 there is none', async () => {
    render(MoneyResults, { props: props(dayFromUtc(2030, 2, 1)) });
    await expect.element(page.getByTestId('fzp-money-all')).toBeVisible();
    expect(page.getByTestId('fzp-money-closed').elements()).toHaveLength(0);
  });

  it('axe: clean in light and dark', async () => {
    render(MoneyResults, { props: props(dayFromUtc(2030, 3, 1)) });
    await expect.element(page.getByTestId('fzp-money-closed')).toBeVisible();
    for (const value of ['light', 'dark'] as const) {
      await scheme(value);
      const r = await axe.run(page.getByTestId('fzp-money').element(), {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa']
        }
      });
      expect(r.violations).toEqual([]);
    }
  });
});
