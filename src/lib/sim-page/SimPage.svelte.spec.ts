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
import { stub, callsOf } from '$lib/fzp/test/sim-map-stub';
import { timelineMsg } from '$lib/fzp/test/fake-worker';
import SimPageHost from './test/SimPageHost.svelte';
import { testCatalog } from './test/catalog';

vi.mock('$lib/map/SimMap.svelte', () => import('$lib/fzp/test/FzpSimMapStub.svelte'));
const workers = vi.hoisted(() => [] as import('$lib/fzp/test/fake-worker').FakeScenarioWorker[]);
vi.mock('$lib/sim/client', async (orig) => {
  const { FakeScenarioWorker } = await import('$lib/fzp/test/fake-worker');
  return {
    ...(await orig<typeof import('$lib/sim/client')>()),
    spawnSimWorker: () => {
      const w = new FakeScenarioWorker();
      workers.push(w);
      return w;
    }
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

/** The scenario answers `ready` and its first timeline: the brush tools come on. */
async function toReady() {
  await expect.poll(() => workers.at(-1)?.lastOf('initScenario')).toBeTruthy();
  const w = workers.at(-1)!;
  const rev = w.lastOf('initScenario')!.rev;
  w.emit({ type: 'ready', rev, datasetVersion: 'fixture-0', chunkCount: 4 });
  w.emit(timelineMsg(rev, 7));
}

const yourZoning = () => page.getByRole('button', { name: 'Your zoning' });

describe('SimPage strokes (Task 8)', () => {
  it('a Paint stroke on the map adds a freehand brush that Undo names and undoes', async () => {
    stub.reset();
    await page.viewport(1024, 768);
    await setup();
    await toReady();
    await yourZoning().click();
    const paint = page.getByRole('radio', { name: 'Paint' });
    await expect.element(paint).toBeEnabled();
    await paint.click();
    await expect.poll(() => callsOf('setPanEnabled').at(-1)?.[0]).toBe(false);
    const canvas = stub.map.getCanvas();
    const ev = (type: string, x: number) =>
      canvas.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: 10,
          pointerId: 1,
          pointerType: 'mouse',
          button: type === 'pointermove' ? -1 : 0,
          isPrimary: true
        })
      );
    ev('pointerdown', 10);
    for (let x = 20; x <= 80; x += 10) ev('pointermove', x);
    ev('pointerup', 80);
    const undo = page.getByRole('button', { name: 'Undo: Raised lots to 6 stories' });
    await expect.element(undo).toBeEnabled();
    await expect.element(page.getByText('Finding lots…')).toBeVisible();
    await undo.click();
    await expect
      .element(page.getByRole('status').filter({ hasText: 'Undid: Raised lots to 6 stories' }))
      .toBeInTheDocument();
    await expect.element(page.getByText('Finding lots…')).not.toBeInTheDocument();
  });

  it('at 375 px, Paint closes the sheet for the tool bar; Done goes back to Move and the sheet', async () => {
    stub.reset();
    await page.viewport(375, 700);
    await setup();
    await toReady();
    await page.getByRole('button', { name: 'Menu' }).click();
    await policyButton().click();
    const dialog = page.getByRole('dialog', { name: 'Policy' });
    await expect.element(dialog).toBeVisible();
    await yourZoning().click();
    await page.getByRole('radio', { name: 'Paint' }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    const bar = page.getByRole('group', { name: 'Brush' });
    await expect.element(bar).toBeVisible();
    await expect.element(bar.getByRole('button').first()).toHaveFocus();
    await bar.getByRole('button', { name: 'Done' }).click();
    await expect.element(dialog).toBeVisible();
    await expect.element(page.getByRole('radio', { name: 'Move' })).toBeChecked();
    await expect.element(bar).not.toBeInTheDocument();
  });

  it('while protecting, B and E stay on the protections', async () => {
    stub.reset();
    await page.viewport(1024, 768);
    await setup();
    await toReady();
    await yourZoning().click();
    await page.getByRole('radio', { name: 'Protect', exact: true }).click();
    await userEvent.keyboard('e');
    await expect.element(page.getByRole('radio', { name: 'Unprotect' })).toBeChecked();
    await userEvent.keyboard('b');
    await expect.element(page.getByRole('radio', { name: 'Protect', exact: true })).toBeChecked();
    // From Move, B is zoning Paint.
    await userEvent.keyboard('v');
    await expect.element(page.getByRole('radio', { name: 'Move' })).toBeChecked();
    await userEvent.keyboard('b');
    await expect.element(page.getByRole('radio', { name: 'Paint' })).toBeChecked();
  });
});

describe('SimPage rule brushes (Task 9)', () => {
  it('fetches the catalog once, when the panel first opens', async () => {
    await page.viewport(375, 700);
    await setup();
    await toReady();
    const w = workers.at(-1)!;
    expect(w.allOf('brushCatalog')).toHaveLength(0);
    await page.getByRole('button', { name: 'Menu' }).click();
    await policyButton().click();
    await expect.poll(() => w.allOf('brushCatalog').length).toBe(1);
    await page.getByRole('button', { name: 'Close policy' }).click();
    await page.getByRole('button', { name: 'Menu' }).click();
    await policyButton().click();
    await expect.element(page.getByRole('dialog', { name: 'Policy' })).toBeVisible();
    expect(w.allOf('brushCatalog')).toHaveLength(1);
  });

  it('at 375 px, "Add a brush" → Street replaces the sheet body; Back returns', async () => {
    stub.reset();
    await page.viewport(375, 700);
    await setup();
    await toReady();
    await page.getByRole('button', { name: 'Menu' }).click();
    await policyButton().click();
    const w = workers.at(-1)!;
    await expect.poll(() => w.lastOf('brushCatalog')).toBeTruthy();
    w.emit({
      type: 'brushCatalog',
      reqId: w.lastOf('brushCatalog')!.reqId,
      catalog: testCatalog()
    });
    await yourZoning().click();
    await page.getByRole('button', { name: 'Add a brush' }).click();
    await page.getByRole('button', { name: 'Street', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Policy' });
    await expect.element(dialog.getByRole('checkbox', { name: 'Arterials' })).toBeVisible();
    // No second dialog: the only open dialog is the Policy sheet (FzpMode's closed sources
    // dialog stays in the DOM).
    expect([...document.querySelectorAll('dialog[open]')]).toEqual([dialog.element()]);
    await expect.element(yourZoning()).not.toBeInTheDocument();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect.element(yourZoning()).toBeVisible();
    await expect.element(page.getByRole('checkbox', { name: 'Arterials' })).not.toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Add a brush' })).toHaveFocus();
  });

  /** At 375 px: open the sheet, answer the catalog, open the Street form. */
  async function openStreetForm() {
    await page.getByRole('button', { name: 'Menu' }).click();
    await policyButton().click();
    const w = workers.at(-1)!;
    await expect.poll(() => w.lastOf('brushCatalog')).toBeTruthy();
    w.emit({
      type: 'brushCatalog',
      reqId: w.lastOf('brushCatalog')!.reqId,
      catalog: testCatalog()
    });
    await yourZoning().click();
    await page.getByRole('button', { name: 'Add a brush' }).click();
    await page.getByRole('button', { name: 'Street', exact: true }).click();
    await expect.element(page.getByRole('checkbox', { name: 'Arterials' })).toBeVisible();
  }

  it('closing the sheet discards the open form; reopening shows the brush list', async () => {
    stub.reset();
    await page.viewport(375, 700);
    await setup();
    await toReady();
    await openStreetForm();
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByRole('dialog', { name: 'Policy' })).not.toBeInTheDocument();
    await page.getByRole('button', { name: 'Menu' }).click();
    await policyButton().click();
    await expect.element(page.getByRole('dialog', { name: 'Policy' })).toBeVisible();
    await expect.element(yourZoning()).toBeVisible();
    await expect
      .element(page.getByRole('button', { name: 'Back', exact: true }))
      .not.toBeInTheDocument();
    await expect.element(page.getByRole('checkbox', { name: 'Arterials' })).not.toBeInTheDocument();
  });

  it('crossing md discards the open form', async () => {
    stub.reset();
    await page.viewport(375, 700);
    await setup();
    await toReady();
    await openStreetForm();
    await page.viewport(1024, 768);
    await expect.element(page.getByRole('region', { name: 'Policy' })).toBeVisible();
    await expect.element(page.getByRole('checkbox', { name: 'Arterials' })).not.toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Add a brush' })).toBeVisible();
  });
});
