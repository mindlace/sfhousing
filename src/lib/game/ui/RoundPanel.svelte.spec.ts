/// <reference types="@vitest/browser-playwright" />
// The round panel: text only, nothing to operate.
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../../routes/layout.css';
import type { RoundPanelData } from '../round-panel';
import RoundPanel from './RoundPanel.svelte';

const DATA: RoundPanelData = {
  title: 'Round 2',
  items: ['Taller near Muni Metro: 65 ft within 402 m', 'Benchmark permits (off): permit review'],
  earlier: ['Round 1: goal reached Jun 2060, 1 yr 4 mo earlier', 'Baseline: Oct 2061']
};

const FOCUSABLE =
  'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable]';

describe('RoundPanel', () => {
  it('shows the round, its policies, and Earlier with what was achieved', async () => {
    await render(RoundPanel, { props: { data: DATA } });
    await expect.element(page.getByRole('heading', { name: 'Round 2' })).toBeVisible();
    for (const line of [...DATA.items, ...DATA.earlier]) {
      await expect.element(page.getByText(line)).toBeVisible();
    }
    await expect.element(page.getByRole('heading', { name: 'Earlier' })).toBeVisible();
    expect(page.getByRole('listitem').elements()).toHaveLength(4);
  });

  it('holds no focusable element', async () => {
    await render(RoundPanel, { props: { data: DATA } });
    await expect.element(page.getByTestId('round-panel')).toBeVisible();
    expect(page.getByTestId('round-panel').element().querySelectorAll(FOCUSABLE)).toHaveLength(0);
  });

  it('leaves out an empty list and an empty Earlier', async () => {
    await render(RoundPanel, {
      props: { data: { title: 'Every policy', items: [], earlier: [] } }
    });
    await expect.element(page.getByRole('heading', { name: 'Every policy' })).toBeVisible();
    expect(page.getByRole('list').elements()).toHaveLength(0);
    expect(page.getByRole('heading', { name: 'Earlier' }).elements()).toHaveLength(0);
  });
});
