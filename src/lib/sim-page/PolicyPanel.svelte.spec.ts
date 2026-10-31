/// <reference types="@vitest/browser-playwright" />
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import PolicyPanelHost from './test/PolicyPanelHost.svelte';

async function setup(open = true) {
  const onclose = vi.fn();
  const view = await render(PolicyPanelHost, { props: { open, onclose } });
  return { onclose, view };
}

const map = () => page.getByTestId('map').element() as HTMLElement;
const panelWidth = () => getComputedStyle(map()).getPropertyValue('--sim-panel-w').trim();

describe('PolicyPanel', () => {
  it('is a modal dialog named "Policy" at 375 px', async () => {
    await page.viewport(375, 700);
    await setup();
    const dialog = page.getByRole('dialog', { name: 'Policy' });
    await expect.element(dialog).toBeVisible();
    expect((dialog.element() as HTMLDialogElement).matches(':modal')).toBe(true);
    expect(panelWidth()).toBe('');
  });

  it('Escape closes the sheet through onclose', async () => {
    await page.viewport(375, 700);
    const { onclose } = await setup();
    await expect.element(page.getByRole('dialog', { name: 'Policy' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    expect(onclose).toHaveBeenCalled();
  });

  it('docks from md', async () => {
    await page.viewport(768, 700);
    await setup();
    const region = page.getByRole('region', { name: 'Policy' });
    await expect.element(region).toBeVisible();
    expect(region.element().tagName).toBe('SECTION');
    expect(document.querySelector('dialog')).toBeNull();
    expect(panelWidth()).toBe('320px');
    expect(region.element().getBoundingClientRect().width).toBe(320);
    const card = page.getByRole('region', { name: 'Project details' }).element();
    const left = card.getBoundingClientRect().left - map().getBoundingClientRect().left;
    expect(left).toBeGreaterThanOrEqual(320);
  });

  it('is a modal dialog at 767 px', async () => {
    await page.viewport(767, 700);
    await setup();
    const dialog = page.getByRole('dialog', { name: 'Policy' });
    await expect.element(dialog).toBeVisible();
    expect((dialog.element() as HTMLDialogElement).matches(':modal')).toBe(true);
    expect(panelWidth()).toBe('');
  });

  it('publishes no width while closed', async () => {
    await page.viewport(1024, 700);
    await setup(false);
    expect(document.querySelector('[data-testid="policy-panel"]')).toBeNull();
    expect(panelWidth()).toBe('');
    const card = page.getByRole('region', { name: 'Project details' }).element();
    expect(card.getBoundingClientRect().left - map().getBoundingClientRect().left).toBe(16);
  });

  it('has no "Zoning layers" section, and its sections start collapsed', async () => {
    await page.viewport(1024, 700);
    await setup();
    const toggle = (name: string) => page.getByRole('button', { name, exact: true });
    expect(page.getByRole('button', { name: 'Zoning layers' }).query()).toBeNull();
    await expect.element(toggle('Your zoning')).toBeVisible();
    await expect.element(toggle('Your zoning')).toHaveAttribute('aria-expanded', 'false');
    await expect.element(toggle('Protections')).toHaveAttribute('aria-expanded', 'false');
    await toggle('Your zoning').click();
    await expect.element(toggle('Your zoning')).toHaveAttribute('aria-expanded', 'true');
  });

  it('"Permitting timelines" starts collapsed and its button shows the summary', async () => {
    await page.viewport(1024, 700);
    await setup();
    const button = page.getByRole('button', { name: /Permitting timelines/ });
    await expect.element(button).toHaveAttribute('aria-expanded', 'false');
    await expect.element(button).toHaveTextContent('SF as observed');
    // A separator keeps the title and the summary apart in the accessible name.
    await expect.element(button).toHaveAccessibleName('Permitting timelines, SF as observed');
  });

  it('docked: opening focuses the panel, and Escape there closes it', async () => {
    await page.viewport(1024, 700);
    const { onclose } = await setup();
    const region = page.getByRole('region', { name: 'Policy' });
    await expect.element(region).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(onclose).toHaveBeenCalledOnce();
  });

  it('the Close button calls onclose', async () => {
    await page.viewport(1024, 700);
    const { onclose } = await setup();
    await page.getByRole('button', { name: 'Close policy' }).click();
    expect(onclose).toHaveBeenCalledOnce();
  });
});
