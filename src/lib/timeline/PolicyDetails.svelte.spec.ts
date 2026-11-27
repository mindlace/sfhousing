/// <reference types="@vitest/browser-playwright" />
// The read-only pane of a policy the player cannot edit yet: its values in words, no controls.
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { entryOf } from '$lib/game/catalogue/rounds';
import { monthFirstDay } from '$lib/sim/world/months';
import type { Policy } from './policy4';
import PolicyDetails from './PolicyDetails.svelte';

const asOf = 20_000;
const metro: Policy = {
  id: 'transit-metro',
  label: 'Taller near Muni Metro',
  preset: null,
  on: false,
  where: { tag: 'transit', stopTypes: ['metro'] },
  spans: [
    {
      from: monthFirstDay(asOf, 1),
      to: null,
      what: {
        tag: 'bands',
        bands: [
          { maxM: 402, stories: 6 },
          { maxM: 805, stories: 5 }
        ]
      }
    }
  ]
};
const bond: Policy = {
  id: 'm1',
  label: 'Housing bond',
  preset: 'housing-bond',
  on: false,
  where: { tag: 'fund', pool: 'p' },
  spans: [{ from: monthFirstDay(asOf, 1), to: null, what: { tag: 'baseline' } as never }]
};

function setup(policy: Policy = metro, key = 'transit-metro') {
  const onclose = vi.fn();
  const kind = policy.where.tag === 'transit' ? 'zoning' : 'money';
  render(PolicyDetails, {
    props: { kind, policy, entry: entryOf(key), asOf, onclose }
  });
  return { onclose };
}

describe('PolicyDetails', () => {
  it('the Muni Metro pane reads in words, with its source', async () => {
    setup();
    const pane = page.getByTestId('policy-details');
    await expect
      .element(pane.getByRole('heading', { name: 'Taller near Muni Metro' }))
      .toBeVisible();
    await expect.element(pane).toHaveTextContent('Zoning · off · New');
    await expect.element(pane).toHaveTextContent('Stops');
    await expect.element(pane).toHaveTextContent('Muni Metro');
    await expect.element(pane).toHaveTextContent('Within 402 m');
    await expect.element(pane).toHaveTextContent('6 stories (65 ft)');
    await expect.element(pane).toHaveTextContent('402 to 805 m');
    await expect.element(pane).toHaveTextContent('5 stories (55 ft)');
    await expect.element(pane).toHaveTextContent('When');
    await expect.element(pane).toHaveTextContent(/, no end/);
    await expect.element(pane).toHaveTextContent('Editable after a win with it on.');
    const link = page.getByRole('link', { name: 'SB 79 (2025), Tier 2' });
    await expect.element(link).toHaveAttribute('href', expect.stringContaining('leginfo'));
    expect(pane.element().querySelectorAll('input, select, [role=switch]')).toHaveLength(0);
  });

  it('on reads "on"', async () => {
    setup({ ...metro, on: true });
    await expect.element(page.getByTestId('policy-details')).toHaveTextContent('Zoning · on · New');
  });

  it('a money policy gives its rules in a line', async () => {
    setup(bond, 'housing-bond');
    const pane = page.getByTestId('policy-details');
    await expect.element(pane).toHaveTextContent('Public money · off · New');
    // The entry's line, once, and no Rules row repeating it.
    const text = pane.element().textContent ?? '';
    const line = 'A City bond for affordable homes, repaid over 20 years.';
    expect(text.split(line)).toHaveLength(2);
    expect(text.toLowerCase().split('city bond for affordable homes')).toHaveLength(2);
    expect(text).not.toContain('Rules');
  });

  it('Close and Escape call onclose', async () => {
    const { onclose } = setup();
    await page.getByRole('button', { name: 'Close details' }).click();
    expect(onclose).toHaveBeenCalledTimes(1);
    page.getByRole('heading', { name: 'Taller near Muni Metro' }).element().focus();
    await userEvent.keyboard('{Escape}');
    expect(onclose).toHaveBeenCalledTimes(2);
  });
});
