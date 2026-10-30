/// <reference types="@vitest/browser-playwright" />
// SimPage with the real header: the Policy panel's default (open and docked from md, closed
// below), focus on close, and the notices it must not cover.
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { parseManifest } from '$lib/data/manifest';
import { fixtureCalibration } from '$lib/fzp/fixtures/calibration';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import SimPageHost from './test/SimPageHost.svelte';

vi.mock('$lib/map/SimMap.svelte', () => import('$lib/fzp/test/FzpSimMapStub.svelte'));
vi.mock('$lib/sim/client', async (orig) => {
  const { FakeScenarioWorker } = await import('$lib/fzp/test/fake-worker');
  return {
    ...(await orig<typeof import('$lib/sim/client')>()),
    spawnSimWorker: () => new FakeScenarioWorker()
  };
});

const manifest = parseManifest(manifestJson);
const calibration = fixtureCalibration();

type Over = Partial<{ noScenario: boolean; manifestError: boolean }>;
async function setup(over: Over = {}) {
  return render(SimPageHost, {
    props: {
      manifest,
      manifestError: false,
      calibration,
      calibrationError: false,
      noScenario: false,
      datasetVersion: 'fixture-0',
      start: null,
      urlSeed: null,
      reload: async () => ({ manifest, calibration }),
      ...over
    }
  });
}

const policyButton = () => page.getByRole('button', { name: 'Policy', exact: true });
const policyPanel = () => document.querySelector('[data-testid="policy-panel"]');
const sfhFzp = () => document.querySelector('.sfh-fzp') as HTMLElement;

describe('SimPage policy panel', () => {
  it('opens docked by default at 1024 px, without moving focus', async () => {
    await page.viewport(1024, 768);
    await setup();
    const region = page.getByRole('region', { name: 'Policy' });
    await expect.element(region).toBeVisible();
    await expect.element(policyButton()).toHaveAttribute('aria-expanded', 'true');
    expect(region.element().contains(document.activeElement)).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });

  it('starts closed at 375 px', async () => {
    await page.viewport(375, 700);
    await setup();
    await expect.element(page.getByRole('button', { name: 'Menu' })).toBeVisible();
    // The Policy button sits in the closed Menu (hidden), so it is found by text.
    const hidden = [...document.querySelectorAll('header button')].find(
      (b) => b.textContent?.trim() === 'Policy'
    );
    expect(hidden?.getAttribute('aria-expanded')).toBe('false');
    expect(policyPanel()).toBeNull();
  });

  it('at 375 px, opened from the Menu, Escape returns focus to the Menu button', async () => {
    await page.viewport(375, 700);
    await setup();
    const menu = page.getByRole('button', { name: 'Menu' });
    await menu.click();
    await policyButton().click();
    const dialog = page.getByRole('dialog', { name: 'Policy' });
    await expect.element(dialog).toBeVisible();
    await expect.element(menu).toHaveAttribute('aria-expanded', 'false');
    await userEvent.keyboard('{Escape}');
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(menu).toHaveFocus();
  });

  it('opening it with the button moves focus into the docked panel', async () => {
    await page.viewport(1024, 768);
    await setup();
    await page.getByRole('button', { name: 'Close policy' }).click();
    await expect.element(policyButton()).toHaveAttribute('aria-expanded', 'false');
    await expect.element(policyButton()).toHaveFocus();
    await policyButton().click();
    await expect.element(page.getByRole('region', { name: 'Policy' })).toHaveFocus();
  });

  it('no-scenario: no panel and no Policy button, so the notice stays clear', async () => {
    await page.viewport(1024, 768);
    await setup({ noScenario: true });
    await expect.element(page.getByTestId('fzp-status')).toBeVisible();
    expect(policyPanel()).toBeNull();
    await expect.element(policyButton()).not.toBeInTheDocument();
    expect(getComputedStyle(sfhFzp()).getPropertyValue('--sim-panel-w').trim()).toBe('');
  });

  it('failed: the notice sits right of the docked panel', async () => {
    await page.viewport(1024, 768);
    await setup({ manifestError: true });
    const alert = page.getByRole('alert');
    await expect.element(alert).toBeVisible();
    await expect.element(page.getByRole('region', { name: 'Policy' })).toBeVisible();
    const notice = alert.element().parentElement!.getBoundingClientRect();
    expect(notice.left - sfhFzp().getBoundingClientRect().left).toBeGreaterThanOrEqual(320);
    expect(notice.right).toBeLessThanOrEqual(sfhFzp().getBoundingClientRect().right);
  });
});
