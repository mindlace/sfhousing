// Paint's save state sits in the shell's status slot, beside the nav, apart from the actions.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { Manifest } from '$lib/data/manifest';
import { emptyPlan } from '$lib/plan';
import { stubProps } from '$lib/brush/test/sim-map-stub';
import './layout.css';
import manifestJson from '../../e2e/fixtures/data/fixture-0/manifest.json';
import PaintHeaderHost from './test/PaintHeaderHost.svelte';

vi.mock('$lib/map/SimMap.svelte', async () => import('$lib/brush/test/SimMapStub.svelte'));

const data = {
  plan: emptyPlan('fixture-0'),
  manifest: manifestJson as unknown as Manifest,
  fellBack: false,
  manifestError: false,
  datasetVersion: 'fixture-0',
  appRelease: 'dev'
};

const box = (el: Element) => el.getBoundingClientRect();

describe('/ header save state', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'Worker',
      class {
        onmessage = null;
        postMessage() {}
        terminate() {}
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    stubProps.view = undefined;
  });

  it('renders the indicator in the status slot, before the actions, at 1280px', async () => {
    await page.viewport(1280, 800);
    render(PaintHeaderHost, { props: { data } });
    const saved = page.getByText('Saved', { exact: true });
    await expect.element(saved).toBeVisible();
    const status = document.querySelector('[data-header-status]')!;
    expect(status.contains(saved.element())).toBe(true);
    const publish = page.getByRole('button', { name: /Publish/ });
    await expect.element(publish).toBeVisible();
    expect(status.contains(publish.element())).toBe(false);
    const simulate = page.getByRole('link', { name: 'Simulate' }).element();
    expect(box(saved.element()).left).toBeGreaterThanOrEqual(box(simulate).right);
    expect(box(saved.element()).right).toBeLessThanOrEqual(box(publish.element()).left);
  });

  it('renders the indicator in the status slot after the site title at 375px', async () => {
    await page.viewport(375, 812);
    render(PaintHeaderHost, { props: { data } });
    const saved = page.getByText('Saved', { exact: true });
    await expect.element(saved).toBeVisible();
    const status = document.querySelector('[data-header-status]')!;
    expect(status.contains(saved.element())).toBe(true);
    // Publish is in the closed Menu, so the indicator is not among the actions.
    expect(page.getByRole('button', { name: /Publish/ }).elements()).toEqual([]);
    const title = page.getByRole('link', { name: /SF Housing/ }).element();
    expect(box(saved.element()).left).toBeGreaterThanOrEqual(box(title).right);
  });

  for (const width of [768, 375]) {
    it(`fits with Autosave off and nothing overlaps at ${width}px`, async () => {
      await page.viewport(width, 812);
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      vi.spyOn(console, 'error').mockImplementation(() => {});
      render(PaintHeaderHost, { props: { data } });
      const chip = page.getByRole('button', { name: 'Autosave off' });
      await expect.element(chip).toBeVisible();
      const banner = page.getByRole('banner').element() as HTMLElement;
      expect(box(banner).height).toBe(48);
      expect(banner.scrollWidth).toBeLessThanOrEqual(banner.clientWidth);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      const row = [
        page.getByRole('link', { name: /SF Housing/ }).element(),
        ...(width >= 768 ? [page.getByRole('navigation', { name: 'Modes' }).element()] : []),
        chip.element(),
        (width >= 768
          ? page.getByRole('button', { name: /Publish/ })
          : page.getByRole('button', { name: 'Menu' })
        ).element()
      ];
      for (let i = 1; i < row.length; i++)
        expect(box(row[i]).left, `item ${i} after item ${i - 1}`).toBeGreaterThanOrEqual(
          box(row[i - 1]).right
        );
      expect(box(row.at(-1)!).right).toBeLessThanOrEqual(width);
    });
  }
});
