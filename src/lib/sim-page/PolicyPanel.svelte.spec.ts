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

  it('has no "Zoning layers" section; four sections in order, the two zoning ones open', async () => {
    await page.viewport(1024, 700);
    await setup();
    expect(page.getByRole('button', { name: 'Zoning layers' }).query()).toBeNull();
    expect(page.getByRole('button', { name: 'Your zoning' }).query()).toBeNull();
    const toggles = page.getByRole('heading', { level: 3 }).getByRole('button').elements();
    const titles = ['New zoning rules', 'Custom zoning', 'Permitting timelines', 'Protections'];
    expect(toggles).toHaveLength(4);
    titles.forEach((t, i) => expect(toggles[i].textContent).toContain(t));
    expect(toggles.map((b) => b.getAttribute('aria-expanded'))).toEqual([
      'true',
      'true',
      'false',
      'false'
    ]);
    await expect.element(page.getByText('Rules body')).toBeVisible();
    await expect.element(page.getByText('Custom body')).toBeVisible();
    expect(page.getByText('Protections body').query()).toBeNull();
  });

  it('a section toggles open and closed', async () => {
    await page.viewport(1024, 700);
    await setup();
    const protections = page.getByRole('button', { name: 'Protections', exact: true });
    await protections.click();
    await expect.element(protections).toHaveAttribute('aria-expanded', 'true');
    await expect.element(page.getByText('Protections body')).toBeVisible();
    await page.getByRole('button', { name: 'New zoning rules', exact: true }).click();
    expect(page.getByText('Rules body').query()).toBeNull();
  });

  it('renders the history row above the sections', async () => {
    await page.viewport(1024, 700);
    await setup();
    const undo = page.getByRole('button', { name: /^Undo/ }).element();
    const first = page.getByRole('button', { name: 'New zoning rules', exact: true }).element();
    expect(undo.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(page.getByRole('button', { name: /^Undo/ }).elements()).toHaveLength(1);
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
