/// <reference types="@vitest/browser-playwright" />
// SimPage with the real header: the policy dock (open on Transit from md, a handle below; Run
// flips it to Results, Edit policy back), focus on open and close, and the notices it must not
// cover.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { cdp, page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { parseManifest } from '$lib/data/manifest';
import { fixtureCalibration } from '$lib/fzp/fixtures/calibration';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import { stub, callsOf, FakeMap } from '$lib/fzp/test/sim-map-stub';
import { timelineMsg } from '$lib/fzp/test/fake-worker';
import SimPageHost from './test/SimPageHost.svelte';
import { BrushController } from '$lib/brush/BrushController.svelte';
import './debug';
import { testCatalog } from './test/catalog';
import type { ComponentProps } from 'svelte';
import { copyFor } from '$lib/sharing/copy';
import { MemoryStorage } from '$lib/sharing/fixtures/memory-storage';
import { replaceStateCalls } from '../../test-stubs/app/navigation';
import type SimPage from './SimPage.svelte';
import { DEFAULT_POLICY, SIM_CODEC, SIM_KEY, type SimDoc } from './sim-doc';
import { resolvePreset } from './timing';
import { DEFAULT_VIEW, HIDDEN_VIEW, VIEW_KEY } from '$lib/view/prefs';
import type { PackedCell } from '$lib/map/types';
import { chanceTable, typicalMonths } from '$lib/timelapse/model';
import { LIMITS_LAYER_ID } from '$lib/map/height/limits-layer';
import { LID_MAX_SPAN_M } from '$lib/map/height/lids';
import { tinyLimits } from '$lib/map/height/test/fixtures';
import { clampBbox } from './lid-request';

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

type Over = Partial<ComponentProps<typeof SimPage>>;
async function setup(over: Over = {}) {
  return render(SimPageHost, {
    props: {
      manifest,
      manifestError: false,
      calibration,
      calibrationError: false,
      noScenario: false,
      datasetVersion: 'fixture-0',
      urlSeed: null,
      reload: async () => ({ manifest, calibration }),
      ...over
    }
  });
}

/** The header's Policy button (from md in the header; below md in the open Menu). */
const policyButton = () =>
  page.getByRole('banner').getByRole('button', { name: 'Policy', exact: true });
const dockEl = () => document.querySelector('[data-testid="dock"]');
const dockPanel = () => document.querySelector('.sfh-dock-panel');
const sfhFzp = () => document.querySelector('.sfh-fzp') as HTMLElement;
const tab = (name: string) => page.getByRole('tab', { name, exact: true });
const results = () => page.getByRole('region', { name: 'Results' });
const editPolicy = () => page.getByRole('button', { name: 'Edit policy', exact: true });
const handle = () => page.getByTestId('dock-handle');
const runButton = () => page.getByRole('button', { name: 'Run', exact: true });
const scoreButton = () => page.getByTestId('score-bar');
/** `window.__sfhFzp` (installed while `VITE_E2E` is '1', see `readySim`). */
const fzpDebug = () => window.__sfhFzp!;

/**
 * The scenario answers `ready` and its first timeline: the brush tools come on. The timeline
 * answers the latest barrier, as the worker's would: a restored draft's levers go out as
 * `setLevers` before the first timeline.
 */
async function toReady() {
  await expect.poll(() => workers.at(-1)?.lastOf('initScenario')).toBeTruthy();
  const w = workers.at(-1)!;
  const rev = w.lastOf('initScenario')!.rev;
  w.emit({ type: 'ready', rev, datasetVersion: 'fixture-0', chunkCount: 4 });
  w.emit(timelineMsg(Math.max(rev, w.lastOf('setLevers')?.rev ?? 0), 7));
}

/** /sim at `width` (1024 by default), ready in Setup, with the debug hook on. */
async function readySim(width = 1024, over: Over = {}) {
  vi.stubEnv('VITE_E2E', '1');
  stub.reset();
  await page.viewport(width, width < 768 ? 700 : 768);
  await setup(over);
  await toReady();
  return { w: workers.at(-1)! };
}

/** Run: the page enters the run at once (it plays once the score is current). */
async function pressRun(_w?: (typeof workers)[number]) {
  await runButton().click();
  await expect.poll(() => fzpDebug().runPhase).toBe('run');
}

describe('SimPage dock', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('opens docked on the Transit tab at 1024 px, without moving focus', async () => {
    await readySim();
    await expect.element(page.getByRole('tablist', { name: 'Policy' })).toBeVisible();
    await expect.element(tab('Transit')).toHaveAttribute('aria-selected', 'true');
    expect(
      page
        .getByRole('tab')
        .elements()
        .map((t) => t.textContent?.trim())
    ).toEqual(['Transit', 'Paint', 'Permits', 'Protect']);
    await expect.element(policyButton()).toHaveAttribute('aria-expanded', 'true');
    expect(policyButton().element().getAttribute('aria-controls')).toBe(dockEl()!.id);
    expect(dockEl()!.contains(document.activeElement)).toBe(false);
    expect(document.activeElement).toBe(document.body);
    // The editing face: Undo and Redo above the Transit tab's rules.
    await expect.element(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Add transit layer' })).toBeVisible();
    expect(getComputedStyle(sfhFzp()).getPropertyValue('--dock-w').trim()).toBe('320px');
  });

  it('without a calibration the dock has no Permits tab (no empty face)', async () => {
    await page.viewport(1024, 768);
    await setup({ calibration: null, calibrationError: true });
    await expect.poll(dockPanel).not.toBeNull();
    expect(
      page
        .getByRole('tab')
        .elements()
        .map((t) => t.textContent?.trim())
    ).toEqual(['Transit', 'Paint', 'Protect']);
  });

  it('starts with only the handle at 375 px; the handle opens the sheet on Transit', async () => {
    await readySim(375);
    await expect.element(handle()).toBeVisible();
    await expect.element(handle()).toHaveAttribute('aria-expanded', 'false');
    await expect.element(handle()).toHaveTextContent('Transit');
    expect(page.getByRole('tablist').elements()).toHaveLength(0);
    // The Policy button sits in the closed Menu (hidden), so it is found by text.
    const hidden = [...document.querySelectorAll('header button')].find(
      (b) => b.textContent?.trim() === 'Policy'
    );
    expect(hidden?.getAttribute('aria-expanded')).toBe('false');
    await handle().click();
    await expect.element(tab('Transit')).toHaveAttribute('aria-selected', 'true');
    await expect.element(handle()).toHaveAttribute('aria-expanded', 'true');
    // No modal sheet: the dock is not a dialog.
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(0);
  });

  it('Run flips the dock to Results; Edit policy ends the run on the tab used before', async () => {
    const { w } = await readySim();
    await tab('Permits').click();
    await pressRun(w);
    await expect.element(results()).toBeVisible();
    expect(page.getByRole('tablist').elements()).toHaveLength(0);
    expect(page.getByRole('button', { name: /^Undo/ }).elements()).toHaveLength(0);
    await expect.element(scoreButton()).toHaveAttribute('aria-expanded', 'true');
    await editPolicy().click();
    await expect.poll(() => fzpDebug().runPhase).toBe('setup');
    await expect.element(tab('Permits')).toHaveAttribute('aria-selected', 'true');
    // The flip button went with the run: focus moves to the selected tab, not the body.
    await expect.element(tab('Permits')).toHaveFocus();
    await expect.element(runButton()).toBeVisible();
  });

  it('the header score flips to Results in Set Policy and back; in a run it keeps Results', async () => {
    const { w } = await readySim();
    await expect.element(scoreButton()).toHaveAttribute('aria-expanded', 'false');
    expect(scoreButton().element().getAttribute('aria-controls')).toBe(dockEl()!.id);
    await scoreButton().click();
    await expect.element(results()).toBeVisible();
    await expect.element(scoreButton()).toHaveAttribute('aria-expanded', 'true');
    expect(fzpDebug().runPhase).toBe('setup');
    await scoreButton().click();
    await expect.element(tab('Transit')).toHaveAttribute('aria-selected', 'true');
    await expect.element(scoreButton()).toHaveAttribute('aria-expanded', 'false');
    // In Set Policy the Results face's flip only flips back.
    await scoreButton().click();
    await editPolicy().click();
    await expect.element(tab('Transit')).toBeVisible();
    expect(fzpDebug().runPhase).toBe('setup');

    await pressRun(w);
    await scoreButton().click();
    await scoreButton().click();
    await expect.element(results()).toBeVisible();
    await expect.element(scoreButton()).toHaveAttribute('aria-expanded', 'true');
    expect(fzpDebug().runPhase).toBe('run');
  });

  it('collapsing the dock during a run and reopening shows Results first; its rail offers only Results', async () => {
    const { w } = await readySim();
    await pressRun(w);
    await page.getByRole('button', { name: 'Collapse Policy' }).click();
    await expect.element(policyButton()).toHaveAttribute('aria-expanded', 'false');
    await expect.element(policyButton()).toHaveFocus();
    const rail = page.getByTestId('dock-rail');
    await expect.element(rail).toBeVisible();
    expect(
      rail
        .getByRole('button')
        .elements()
        .map((b) => b.getAttribute('aria-label'))
    ).toEqual(['Results']);
    await policyButton().click();
    await expect.element(results()).toBeVisible();
    // "Edit policy" is the first control, and focus moves to it.
    await expect.element(editPolicy()).toHaveFocus();
    expect(fzpDebug().runPhase).toBe('run');
  });

  it('Run with the desktop dock collapsed opens the panel on Results', async () => {
    const { w } = await readySim();
    await page.getByRole('button', { name: 'Collapse Policy' }).click();
    await expect.element(page.getByTestId('dock-rail')).toBeVisible();
    expect(getComputedStyle(sfhFzp()).getPropertyValue('--dock-w').trim()).toBe('48px');
    await pressRun(w);
    await expect.element(results()).toBeVisible();
    expect(dockPanel()).not.toBeNull();
    // Run keeps focus at the scrubber: the page opened the dock, the user did not.
    expect(dockEl()!.contains(document.activeElement)).toBe(false);
  });

  it('scrubbing back to Today shows the editing face', async () => {
    const { w } = await readySim();
    await tab('Protect').click();
    await pressRun(w);
    await expect.element(results()).toBeVisible();
    (page.getByRole('slider', { name: 'Date in the simulation' }).element() as HTMLElement).focus();
    await userEvent.keyboard('{Home}');
    await expect.poll(() => fzpDebug().runPhase).toBe('setup');
    await expect.element(tab('Protect')).toHaveAttribute('aria-selected', 'true');
    expect(results().query()).toBeNull();
  });

  it('the store stays locked during a run: Ctrl+Z changes nothing', async () => {
    const { w } = await readySim();
    await tab('Protect').click();
    const historic = () =>
      page.getByRole('checkbox', { name: 'Historic buildings (status A or A*)' });
    await historic().click(); // one change to undo
    await tab('Paint').click();
    await page.getByRole('radio', { name: 'Paint' }).click(); // Run resets the tool to Move
    await pressRun(w);
    await userEvent.keyboard('{Control>}z{/Control}');
    await new Promise((res) => setTimeout(res, 50));
    // Its tool keys change nothing either.
    await userEvent.keyboard('b');
    await editPolicy().click();
    await expect.element(tab('Paint')).toHaveAttribute('aria-selected', 'true');
    await expect.element(page.getByRole('radio', { name: 'Move' })).toBeChecked();
    await tab('Protect').click();
    await expect.element(historic()).toBeChecked(); // the controller's undo key changed nothing
    await userEvent.keyboard('{Control>}z{/Control}');
    await expect.element(historic()).not.toBeChecked(); // unlocked: the key undoes again
  });

  it('at 375 px Run peeks Results above the time bar', async () => {
    const { w } = await readySim(375);
    await pressRun(w);
    await expect.element(results()).toBeVisible();
    await expect.element(handle()).toHaveTextContent('Results');
    const sheet = document.querySelector('.sfh-dock-sheet') as HTMLElement;
    const bar = page.getByTestId('fzp-scrubber').element().getBoundingClientRect();
    const box = sheet.getBoundingClientRect();
    expect(box.bottom).toBeLessThanOrEqual(bar.top + 1);
    expect(box.height).toBeLessThanOrEqual(window.innerHeight * 0.4 + 1);
    // The map's bottom inset grows by the sheet, so the attribution stays clear of it.
    await expect.poll(() => callsOf('setBottomInset').at(-1)?.[0]).toBe(bar.height + box.height);
  });

  it('at 375 px Paint closes the sheet for the palette strip; Done goes back to Move and the Paint tab', async () => {
    await readySim(375);
    await handle().click();
    await tab('Paint').click();
    await page.getByRole('radio', { name: 'Paint' }).click();
    await expect.element(handle()).toHaveAttribute('aria-expanded', 'false');
    const bar = page.getByTestId('palette-strip');
    await expect.element(bar).toBeVisible();
    await expect.element(bar.getByRole('button').first()).toHaveFocus();
    // The strip sits above the sheet's handle.
    const hb = handle().element().getBoundingClientRect();
    expect(bar.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(hb.top);
    await bar.getByRole('button', { name: 'Done' }).click();
    await expect.element(handle()).toHaveAttribute('aria-expanded', 'true');
    await expect.element(tab('Paint')).toHaveAttribute('aria-selected', 'true');
    await expect.element(page.getByRole('radio', { name: 'Move' })).toBeChecked();
    await expect.element(bar).not.toBeInTheDocument();
  });

  it('+ Transit layer adds a layer expanded in place in the Transit tab at 375 px too', async () => {
    const { w } = await readySim(375);
    await handle().click();
    await expect.poll(() => w.lastOf('brushCatalog')).toBeTruthy();
    w.emit({
      type: 'brushCatalog',
      reqId: w.lastOf('brushCatalog')!.reqId,
      catalog: testCatalog()
    });
    await page.getByRole('button', { name: 'Add transit layer' }).click();
    const panel = page.getByRole('tabpanel', { name: 'Transit' });
    const chips = panel.getByRole('group', { name: 'Stop types' });
    await expect.element(chips).toBeVisible();
    await expect.element(chips.getByRole('button').first()).toHaveFocus();
    await expect.element(tab('Transit')).toBeVisible(); // the tabs stay: no sub-view
    expect(page.getByRole('button', { name: 'Back', exact: true }).query()).toBeNull();
    // No form and no Save: the layer is in the policy already.
    expect(page.getByRole('form').query()).toBeNull();
    expect(page.getByRole('button', { name: /^Save/ }).query()).toBeNull();
    await expect.element(page.getByRole('button', { name: /^Undo/ })).toBeEnabled();
  });

  it('at 375 px, opened from the Menu, Escape returns focus to the Menu button', async () => {
    await readySim(375);
    const menu = page.getByRole('button', { name: 'Menu' });
    await menu.click();
    await policyButton().click();
    await expect.element(tab('Transit')).toBeVisible();
    await expect.element(menu).toHaveAttribute('aria-expanded', 'false');
    await userEvent.keyboard('{Escape}');
    await expect.element(handle()).toHaveAttribute('aria-expanded', 'false');
    await expect.element(menu).toHaveFocus();
  });

  it('opening it with the button moves focus to the selected tab', async () => {
    await readySim();
    await page.getByRole('button', { name: 'Collapse Policy' }).click();
    await expect.element(policyButton()).toHaveAttribute('aria-expanded', 'false');
    await expect.element(policyButton()).toHaveFocus();
    await policyButton().click();
    await expect.element(tab('Transit')).toHaveFocus();
  });

  it('no-scenario: no dock and no Policy button, so the notice stays clear', async () => {
    await page.viewport(1024, 768);
    await setup({ noScenario: true });
    await expect.element(page.getByTestId('fzp-status')).toBeVisible();
    expect(dockEl()).toBeNull();
    await expect.element(policyButton()).not.toBeInTheDocument();
    expect(getComputedStyle(sfhFzp()).getPropertyValue('--dock-w').trim()).toBe('');
  });

  it('failed: the notice sits right of the docked panel', async () => {
    await page.viewport(1024, 768);
    await setup({ manifestError: true });
    const alert = page.getByRole('alert');
    await expect.element(alert).toBeVisible();
    await expect.poll(dockPanel).not.toBeNull();
    const notice = alert.element().parentElement!.getBoundingClientRect();
    expect(notice.left - sfhFzp().getBoundingClientRect().left).toBeGreaterThanOrEqual(320);
    expect(notice.right).toBeLessThanOrEqual(sfhFzp().getBoundingClientRect().right);
  });
});

describe('SimPage strokes (Task 8)', () => {
  it('a Paint stroke on the map adds a custom brush that Undo names and undoes', async () => {
    stub.reset();
    await page.viewport(1024, 768);
    await setup();
    await toReady();
    await tab('Paint').click();
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
    const undo = page.getByRole('button', { name: 'Undo: Allowed 6 stories' });
    await expect.element(undo).toBeEnabled();
    const row = page.getByRole('button', { name: '6 stories · 1 stroke · Finding lots…' });
    await expect.element(row).toBeVisible();
    await undo.click();
    await expect
      .element(page.getByRole('status').filter({ hasText: 'Undid: Allowed 6 stories' }))
      .toBeInTheDocument();
    await expect.element(row).not.toBeInTheDocument();
  });

  it('B and E pick Paint and Erase; V goes back to Move', async () => {
    stub.reset();
    await page.viewport(1024, 768);
    await setup();
    await toReady();
    await tab('Paint').click();
    await page.getByRole('radio', { name: 'Paint' }).click();
    await userEvent.keyboard('e');
    await expect.element(page.getByRole('radio', { name: 'Erase' })).toBeChecked();
    await userEvent.keyboard('b');
    await expect.element(page.getByRole('radio', { name: 'Paint' })).toBeChecked();
    await userEvent.keyboard('v');
    await expect.element(page.getByRole('radio', { name: 'Move' })).toBeChecked();
  });
});

describe('SimPage Paint tab (sim-ux plan 3, Task 3)', () => {
  /** The row select buttons ("8 stories · 2 strokes · 52 lots"), not Retry or Remove. */
  const paintRows = () =>
    page
      .getByRole('list', { name: 'Painted areas' })
      .getByRole('button', { name: /^(\d+ stor(y|ies)|Erased) · / });
  const overlayIds = () =>
    ((callsOf('setOverlayLayers').at(-1)?.[0] ?? []) as { id: string }[]).map((l) => l.id);
  const brushLots = ['P0', 'P1'];
  const OUTLINE = 'sim-painted-outline';

  /** One stroke across the stub map's canvas with the current tool. */
  function drawStroke(): void {
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
  }

  /** Choose Paint on the Paint tab (the tools come on once the scenario is ready). */
  async function choosePaint() {
    await tab('Paint').click();
    const paint = page.getByRole('radio', { name: 'Paint' });
    await expect.element(paint).toBeEnabled();
    await paint.click();
  }

  /** Answers the latest brush query with `lots`. */
  function answer(w: (typeof workers)[number], lots: string[] = brushLots) {
    w.emit({
      type: 'brushLots',
      reqId: w.lastOf('resolveBrush')!.reqId,
      result: { ok: true, lots, points: new Float64Array(lots.length * 2) }
    });
  }

  /** Answers the latest `lotOutlines` request with one ring for `lots`. */
  function answerOutlines(w: (typeof workers)[number]) {
    const req = w.lastOf('lotOutlines')!;
    const c = stub.map.getCenter();
    const d = 1e-3;
    w.emit({
      type: 'lotOutlines',
      reqId: req.reqId,
      result: {
        ok: true,
        lots: req.lots,
        ringLot: Uint32Array.from([0]),
        starts: Uint32Array.from([0, 4]),
        positions: Float64Array.from([
          c.lng,
          c.lat,
          c.lng + d,
          c.lat,
          c.lng + d,
          c.lat + d,
          c.lng,
          c.lat + d
        ]),
        missing: 0
      }
    });
  }

  /** /sim ready, Paint chosen, one stroke painted and its lots answered. */
  async function readySimWithPaint() {
    const { w } = await readySim();
    await choosePaint();
    drawStroke();
    await expect.poll(() => w.allOf('resolveBrush').length).toBe(1);
    answer(w);
    await expect.element(paintRows().first()).toHaveAccessibleName('6 stories · 1 stroke · 2 lots');
    return { w };
  }

  /** Paints strokes at 8, 4 and 8 stories: three painted areas. */
  async function paintThreeAreas() {
    const { w } = await readySim();
    await choosePaint();
    for (const n of [8, 4, 8]) {
      await page.getByRole('button', { name: `${n} stories`, exact: true }).click();
      drawStroke();
    }
    await expect.poll(() => paintRows().elements().length).toBe(3);
    return { w };
  }

  it('a Paint stroke adds a row to the Paint tab with its stroke and lot counts', async () => {
    const { w } = await readySim();
    await choosePaint();
    drawStroke();
    const list = page.getByRole('list', { name: 'Painted areas' });
    await expect
      .element(list.getByRole('button', { name: '6 stories · 1 stroke · Finding lots…' }))
      .toBeVisible();
    await expect.poll(() => w.allOf('resolveBrush').length).toBe(1);
    answer(w);
    await expect
      .element(list.getByRole('button', { name: '6 stories · 1 stroke · 2 lots' }))
      .toBeVisible();
  });

  it('selecting a painted area asks for its outlines; unselecting drops them', async () => {
    const { w } = await readySimWithPaint();
    await page.getByRole('tab', { name: 'Paint' }).click();
    await paintRows().first().click();
    await expect.poll(() => w.lastOf('lotOutlines')?.lots).toEqual(brushLots);
    answerOutlines(w);
    await expect.poll(overlayIds).toContain('sim-painted-outline');
    await paintRows().first().click();
    await expect.poll(overlayIds).not.toContain('sim-painted-outline');
  });

  it('Remove on the selected area is one change Undo names; the selection clears', async () => {
    const { w } = await readySimWithPaint();
    await paintRows().first().click();
    await expect.poll(() => w.lastOf('lotOutlines')?.lots).toEqual(brushLots);
    answerOutlines(w);
    await expect.poll(overlayIds).toContain(OUTLINE);
    const asked = w.allOf('lotOutlines').length;
    await page.getByRole('button', { name: /^Remove:/ }).click();
    expect(paintRows().elements()).toHaveLength(0);
    // The selection and its outline go with the area, not on a later request.
    await expect.poll(overlayIds).not.toContain(OUTLINE);
    await expect
      .element(page.getByRole('button', { name: 'Undo: Removed: 6 stories' }))
      .toBeEnabled();
    await expect
      .element(page.getByRole('status').filter({ hasText: 'Removed: 6 stories' }))
      .toBeInTheDocument();
    await page.getByRole('button', { name: /^Undo:/ }).click();
    await expect.element(paintRows().first()).toHaveAttribute('aria-pressed', 'false');
    expect(page.getByRole('button', { name: /^Remove:/ }).elements()).toHaveLength(0);
    // Undo does not bring the selection, and so the outline, back.
    await new Promise((res) => setTimeout(res, 50));
    expect(overlayIds()).not.toContain(OUTLINE);
    expect(w.allOf('lotOutlines')).toHaveLength(asked);
  });

  it('after Remove, focus lands on the row now at its place', async () => {
    await paintThreeAreas();
    // Remove the first of the 8 / 4 / 8 rows: the 4-story row takes its place.
    await paintRows().first().click();
    await page.getByRole('button', { name: /^Remove:/ }).click();
    await expect
      .poll(() => (document.activeElement as HTMLElement | null)?.dataset.paintRow !== undefined)
      .toBe(true);
    expect((document.activeElement as HTMLElement).getAttribute('aria-label')).toMatch(
      /^4 stories/
    );
  });

  it('removing the middle of three rows with the outer two at one height leaves one row; Undo restores three', async () => {
    await paintThreeAreas();
    await paintRows().nth(1).click();
    await page.getByRole('button', { name: /^Remove:/ }).click();
    await expect.poll(() => paintRows().elements().length).toBe(1);
    await expect.element(paintRows().first()).toHaveAccessibleName(/^8 stories · 2 strokes/);
    await expect
      .element(page.getByRole('button', { name: 'Undo: Removed: 4 stories' }))
      .toBeEnabled();
    await page.getByRole('button', { name: /^Undo:/ }).click();
    await expect.poll(() => paintRows().elements().length).toBe(3);
    await expect.element(paintRows().nth(1)).toHaveAccessibleName(/^4 stories · 1 stroke/);
  });

  it('undoing the stroke that made the selected area clears the selection; Redo does not restore it', async () => {
    const { w } = await readySimWithPaint();
    await paintRows().first().click();
    await expect.element(paintRows().first()).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => w.lastOf('lotOutlines')?.lots).toEqual(brushLots);
    answerOutlines(w);
    await expect.poll(overlayIds).toContain(OUTLINE);
    const asked = w.allOf('lotOutlines').length;
    await page.getByRole('button', { name: 'Undo: Allowed 6 stories' }).click();
    expect(paintRows().elements()).toHaveLength(0);
    await expect.poll(overlayIds).not.toContain(OUTLINE);
    await page.getByRole('button', { name: 'Redo: Allowed 6 stories' }).click();
    await expect.element(paintRows().first()).toHaveAttribute('aria-pressed', 'false');
    expect(page.getByRole('button', { name: /^Remove:/ }).elements()).toHaveLength(0);
    // Redo brings the row back, but neither the selection nor its outline.
    await new Promise((res) => setTimeout(res, 50));
    expect(overlayIds()).not.toContain(OUTLINE);
    expect(w.allOf('lotOutlines')).toHaveLength(asked);
  });
});

describe('SimPage protections (Task 10)', () => {
  it('a category checkbox is a change that Undo names', async () => {
    stub.reset();
    await page.viewport(1024, 768);
    await setup();
    await toReady();
    await tab('Protect').click();
    await page.getByRole('checkbox', { name: 'Historic buildings (status A or A*)' }).click();
    await expect
      .element(page.getByRole('button', { name: 'Undo: Protected historic buildings' }))
      .toBeEnabled();
  });
});

describe('SimPage rule brushes (Task 9)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('fetches the catalog once, when the editing face first shows', async () => {
    await page.viewport(375, 700);
    await setup();
    await toReady();
    const w = workers.at(-1)!;
    expect(w.allOf('brushCatalog')).toHaveLength(0);
    await page.getByRole('button', { name: 'Menu' }).click();
    await policyButton().click();
    await expect.poll(() => w.allOf('brushCatalog').length).toBe(1);
    await page.getByRole('button', { name: 'Collapse Policy' }).click();
    await expect.element(handle()).toHaveAttribute('aria-expanded', 'false');
    await handle().click();
    await expect.element(tab('Transit')).toBeVisible();
    expect(w.allOf('brushCatalog')).toHaveLength(1);
  });

  it('a selected layer stays selected and expanded across a tab change; a run clears it', async () => {
    vi.stubEnv('VITE_E2E', '1');
    stub.reset();
    await page.viewport(1024, 768);
    await setup();
    await toReady();
    const w = workers.at(-1)!;
    await expect.poll(() => w.lastOf('brushCatalog')).toBeTruthy();
    w.emit({
      type: 'brushCatalog',
      reqId: w.lastOf('brushCatalog')!.reqId,
      catalog: testCatalog()
    });
    await page.getByRole('button', { name: 'Add transit layer' }).click();
    const chips = () => page.getByRole('group', { name: 'Stop types' });
    const distance = () =>
      page
        .getByRole('group', { name: 'Band 1' })
        .getByRole('spinbutton', { name: 'Within metres, band 1' });
    await expect.element(chips()).toBeVisible();
    await distance().fill('777');
    await userEvent.keyboard('{Enter}');
    await tab('Permits').click();
    await expect.element(chips()).not.toBeInTheDocument();
    await tab('Transit').click();
    await expect.element(chips()).toBeVisible();
    await expect.element(distance()).toHaveValue(777);
    // A remount does not take focus from the tab the user pressed.
    await expect.element(tab('Transit')).toHaveFocus();

    await pressRun(w);
    await editPolicy().click();
    await expect.element(distance()).not.toBeInTheDocument();
    await expect
      .element(page.getByRole('button', { name: /^Near regional rail and Muni Metro/ }))
      .toHaveAttribute('aria-pressed', 'false');
  });
});

describe('SimPage autosave, restore and publish (plan 5, Task 5)', () => {
  const SD = "Permits at San Diego's pace";
  const sim = copyFor('sim');
  const timingToggle = () => tab('Permits');
  const presetPicker = () => page.getByRole('combobox', { name: 'Preset' });
  const timingLabel = () => page.getByTestId('timing-label');
  const notices = () => page.getByTestId('fzp-notices');
  const publish = () => page.getByTestId('publish-open');
  /** The Permits tab shows `label` as the current set's label. */
  async function expectTiming(label: string) {
    await timingToggle().click();
    await expect.element(timingLabel()).toHaveTextContent(label);
  }

  const docWith = (current = resolvePreset('benchmarkPermits', calibration)): SimDoc => ({
    schema: 2,
    kind: 'sim',
    datasetVersion: 'fixture-0',
    policy: { ...DEFAULT_POLICY, timing: { current, saved: null } }
  });
  function seeded(d: SimDoc = docWith()): MemoryStorage {
    const mem = new MemoryStorage();
    mem.setItem(SIM_KEY, JSON.stringify({ v: 1, savedAt: 'x', plan: SIM_CODEC.serialize(d) }));
    return mem;
  }
  const storedDoc = (mem: MemoryStorage) =>
    JSON.parse(JSON.parse(mem.getItem(SIM_KEY)!).plan) as SimDoc;

  it('a reload keeps the policy and its snapshot', async () => {
    await page.viewport(1024, 768);
    const mem = new MemoryStorage();
    const first = await setup({ storage: () => mem });
    await timingToggle().click();
    await presetPicker().selectOptions(SD);
    await page.getByRole('button', { name: 'Save timelines' }).click();
    const share = page.getByRole('spinbutton', { name: 'Discretionary share, %' });
    await userEvent.fill(share, '37');
    await userEvent.keyboard('{Tab}');
    await expect.element(timingLabel()).toHaveTextContent(`Custom (from ${SD})`);
    await first.unmount(); // flushes the pending write

    await setup({ storage: () => mem });
    await expectTiming(`Custom (from ${SD})`);
    await expect.element(page.getByRole('button', { name: 'Revert to saved' })).toBeVisible();
  });

  it('a reload whose autosave holds a street rule restores the rest and the next save drops it', async () => {
    await page.viewport(1024, 768);
    const d = brushed(); // transit rule 'r' + paint 'a'
    const STREET_RAW = {
      id: 's',
      kind: 'street',
      classes: ['arterial'],
      names: [],
      depth: 0,
      ncOnly: true,
      stories: 6
    };
    const raw = { ...d, policy: { ...d.policy, rules: [STREET_RAW, ...d.policy.rules] } };
    const mem = new MemoryStorage();
    mem.setItem(SIM_KEY, JSON.stringify({ v: 1, savedAt: 'x', plan: JSON.stringify(raw) }));
    const first = await setup({ storage: () => mem });
    await toReady();
    // one rule card and one custom card, no reset notice
    await expect
      .poll(() => document.querySelectorAll('[data-layer-row]:not([data-layer-row="fzp"])').length)
      .toBe(1);
    await timingToggle().click();
    await presetPicker().selectOptions(SD);
    await first.unmount(); // flushes the pending write
    expect(storedDoc(mem).policy.rules.map((r) => r.kind)).toEqual(['transit']);
    expect(storedDoc(mem).policy.custom).toEqual(d.policy.custom);
  });

  it('a reload shows no timing notice', async () => {
    await page.viewport(1024, 768);
    await setup({ storage: () => seeded() });
    await toReady();
    await expect.element(notices()).toBeInTheDocument();
    await expectTiming(`${SD}`);
    expect(notices().element().textContent).not.toContain('re-fit');
  });

  it('a tampered stored preset opens refit, with the timing notice and its Details', async () => {
    await page.viewport(1024, 768);
    const sd = resolvePreset('benchmarkPermits', calibration);
    const mem = seeded(
      docWith({ ...sd, presetTimers: sd.presetTimers.map((t) => ({ ...t, scale: 0.3 })) })
    );
    await setup({ storage: () => mem });
    await toReady();
    const n = notices().getByText(
      'Some permitting timelines were re-fit to the data this simulation runs on.'
    );
    await expect.element(n).toBeVisible();
    const details = notices().getByRole('button', { name: 'Details' });
    await expect.element(details).toHaveAttribute('aria-expanded', 'false');
    await details.click();
    await expect.element(details).toHaveAttribute('aria-expanded', 'true');
    await expect.element(notices().getByText(`${SD} was re-computed for this data`)).toBeVisible();
    // The refit policy is autosaved.
    await expect
      .poll(() => storedDoc(mem).policy.timing.current.presetTimers, { timeout: 2000 })
      .toEqual(sd.presetTimers);
  });

  it('a corrupt record is kept and the page starts on the default', async () => {
    await page.viewport(1024, 768);
    const mem = new MemoryStorage();
    mem.setItem(SIM_KEY, '{nope');
    await setup({ storage: () => mem });
    await toReady();
    await expect.element(notices().getByText(sim.n1)).toBeVisible();
    const kept = mem.keys().filter((k) => k.startsWith('sfhousing:sim:corrupt:'));
    expect(kept).toHaveLength(1);
    expect(mem.getItem(kept[0])).toBe('{nope');
    await expectTiming('SF as observed');
    await expect.element(publish()).toBeDisabled();
  });

  it('quota errors show Autosave off and recover', async () => {
    await page.viewport(1024, 768);
    const mem = new MemoryStorage();
    await setup({ storage: () => mem });
    await expect.element(page.getByRole('banner').getByText('Saved')).toBeVisible();
    mem.failWrites = true;
    await timingToggle().click();
    await presetPicker().selectOptions(SD);
    const off = page.getByRole('banner').getByRole('button', { name: 'Autosave off' });
    await expect.element(off).toBeVisible();
    mem.failWrites = false;
    await presetPicker().selectOptions('No discretionary review');
    await expect.element(page.getByRole('banner').getByText('Saved')).toBeVisible();
    expect(storedDoc(mem).policy.timing.current.preset).toBe('noDiscretionary');
  });

  it('Share link after publish, Publish again after an edit', async () => {
    await page.viewport(1024, 768);
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: 'AbCdEfGh' }), {
          status: 201,
          headers: { 'content-type': 'application/json' }
        })
    );
    const mem = new MemoryStorage();
    await setup({ storage: () => mem, fetchFn: fetchFn as unknown as typeof fetch });
    await timingToggle().click();
    await presetPicker().selectOptions(SD);
    await expect.element(publish()).toBeEnabled();
    await publish().click();
    const dialog = page.getByRole('dialog');
    await expect
      .element(dialog.getByRole('heading', { name: 'Publish this policy' }))
      .toBeVisible();
    await dialog.getByLabelText('Title').fill('SD permits');
    await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect
      .element(dialog.getByLabelText('Link'))
      .toHaveValue(`${location.origin}/s/AbCdEfGh`);
    const body = JSON.parse(
      (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string
    );
    expect(body.title).toBe('SD permits');
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect.element(publish()).toHaveTextContent('Share link');
    // The title and the link are autosaved with the policy.
    const rec = JSON.parse(mem.getItem(SIM_KEY)!);
    expect(rec.lastPublished.id).toBe('AbCdEfGh');
    expect(JSON.parse(rec.plan).title).toBe('SD permits');

    await presetPicker().selectOptions('No discretionary review');
    await expect.element(publish()).toHaveTextContent('Publish');
  });

  it('Publish is disabled on the default policy', async () => {
    await page.viewport(1024, 768);
    await setup();
    await expect.element(publish()).toBeDisabled();
    await expect.element(publish()).toHaveAccessibleDescription('Change the policy first.');
  });

  it('the first restore does not add an undo entry', async () => {
    await page.viewport(1024, 768);
    await setup({ storage: () => seeded() });
    await expectTiming(`${SD}`);
    await expect.element(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  });

  it('a remix hand-off loads the document, toasts once and clears the history state', async () => {
    await page.viewport(1024, 768);
    replaceStateCalls.length = 0;
    const mem = new MemoryStorage();
    const doc = { ...docWith(), title: 'SD permits' };
    await setup({
      storage: () => mem,
      remix: { from: 'SD permits', doc: SIM_CODEC.serialize(doc) }
    });
    await toReady();
    await expect
      .element(notices().getByText("Remixed from SD permits. You're editing your own copy."))
      .toBeVisible();
    await expectTiming(`${SD}`);
    expect(replaceStateCalls).toEqual([{ url: '', state: {} }]);
    expect(storedDoc(mem).title).toBe('SD permits');
  });

  // C1: a restored policy goes through LeverSync, so its rules and custom brushes resolve and the
  // full levers (with their lots) are sent, without waiting for an edit.
  const brushed = (): SimDoc => ({
    schema: 2,
    kind: 'sim',
    datasetVersion: 'fixture-0',
    policy: {
      ...DEFAULT_POLICY,
      rules: [
        { id: 'r', kind: 'transit', stopTypes: ['metro'], bands: [{ maxM: 402, stories: 8 }] }
      ],
      custom: [
        { id: 'a', kind: 'paint', strokes: [{ path: [[-122.4, 37.7]], radiusM: 50 }], stories: 6 }
      ]
    }
  });

  for (const via of ['reload', 'remix'] as const) {
    it(`a ${via} resolves the restored rules and custom brushes and sends their lots`, async () => {
      stub.reset();
      await page.viewport(1024, 768);
      const d = brushed();
      await setup(
        via === 'reload'
          ? { storage: () => seeded(d) }
          : {
              storage: () => new MemoryStorage(),
              remix: { from: 'Brushed', doc: SIM_CODEC.serialize(d) }
            }
      );
      await toReady();
      const w = workers.at(-1)!;
      await expect.poll(() => w.allOf('resolveBrush').length).toBe(2);
      const asks = w.allOf('resolveBrush');
      asks.forEach((a, i) =>
        w.emit({
          type: 'brushLots',
          reqId: a.reqId,
          result: { ok: true, lots: [`P${i}`, `Q${i}`], points: new Float64Array(4) }
        })
      );
      await expect.poll(() => w.lastOf('setLevers')?.levers.rules.length ?? 0).toBe(1);
      const sent = w.lastOf('setLevers')!.levers;
      expect(sent.rules[0].lots.length).toBe(2);
      expect(sent.paint[0].lots.length).toBe(2);
      // The rule's row in the Transit tab, the custom brush's in Paint.
      for (const t of ['Transit', 'Paint']) {
        await tab(t).click();
        await expect.element(page.getByRole('button', { name: /· 2 lots$/ })).toBeVisible();
        expect(page.getByText('Finding lots…').elements()).toHaveLength(0);
      }
      // The next real change still goes through LeverSync, once.
      const before = w.allOf('setLevers').length;
      await timingToggle().click();
      await presetPicker().selectOptions(SD);
      await expect.poll(() => w.allOf('setLevers').length).toBe(before + 1);
      expect(w.lastOf('setLevers')!.levers.rules[0].lots.length).toBe(2);
    });
  }

  it('the save state sits in the header status slot, apart from the actions', async () => {
    await page.viewport(375, 700);
    await setup();
    const banner = page.getByRole('banner');
    await expect.element(banner.getByText('Saved')).toBeVisible();
    // Publish waits in the closed Menu with the other actions.
    expect(publish().element().checkVisibility()).toBe(false);
    await page.getByRole('button', { name: 'Menu' }).click();
    await expect.element(publish()).toBeVisible();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
  });
});

describe('SimPage Setup and Run (Task 7, spec §1)', () => {
  const run = () => page.getByRole('button', { name: 'Run', exact: true });
  const historic = () =>
    page.getByRole('checkbox', { name: 'Historic buildings (status A or A*)' });
  const rentControl = () => page.getByRole('checkbox', { name: /Rent-controlled/ });

  it('Home on the slider during a run returns to Setup and unlocks the policy', async () => {
    vi.stubEnv('VITE_E2E', '1');
    try {
      stub.reset();
      await page.viewport(1024, 768);
      await setup();
      await toReady();
      await tab('Protect').click();
      await run().click();
      const fzp = () => window.__sfhFzp!;
      await expect.poll(() => fzp().playing).toBe(true);
      expect(rentControl().query()).toBeNull(); // a run shows Results, not the tabs
      const slider = page.getByRole('slider', { name: 'Date in the simulation' });
      (slider.element() as HTMLElement).focus();
      await userEvent.keyboard('{Home}');
      await expect.poll(() => fzp().runPhase).toBe('setup');
      expect(fzp().playing).toBe(false);
      await rentControl().click(); // the policy store is unlocked
      await expect
        .element(page.getByRole('button', { name: /^Undo: .*rent-controlled/i }))
        .toBeEnabled();
      await expect.element(run()).toBeVisible();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('at 375 px the palette strip goes when Run starts', async () => {
    stub.reset();
    await page.viewport(375, 700);
    await setup();
    await toReady();
    await page.getByRole('button', { name: 'Menu' }).click();
    await policyButton().click();
    await tab('Paint').click();
    await page.getByRole('radio', { name: 'Paint' }).click();
    const bar = page.getByTestId('palette-strip');
    await expect.element(bar).toBeVisible();
    await run().click();
    await expect.element(bar).not.toBeInTheDocument();
  });

  it("the view's dock has one Policy tab with the summary and no Undo", async () => {
    await page.viewport(1024, 768);
    await setup({ mode: 'view', initialPolicy: DEFAULT_POLICY });
    await toReady();
    expect(
      page
        .getByRole('tab')
        .elements()
        .map((t) => t.textContent?.trim())
    ).toEqual(['Policy']);
    await expect.element(tab('Policy')).toHaveAttribute('aria-selected', 'true');
    await expect.element(page.getByRole('tablist', { name: 'Policy (read-only)' })).toBeVisible();
    await expect.element(page.getByText('No transit layers')).toBeVisible();
    expect(page.getByRole('button', { name: /^Undo/ }).elements()).toHaveLength(0);
    expect(page.getByRole('button', { name: /^Redo/ }).elements()).toHaveLength(0);
    expect(editPolicy().query()).toBeNull();
    await expect.element(policyButton()).toHaveAttribute('aria-expanded', 'true');
  });

  it('in the view, Run flips to Results and Policy ends the run', async () => {
    await page.viewport(1024, 768);
    await setup({ mode: 'view', initialPolicy: DEFAULT_POLICY });
    await toReady();
    await run().click();
    await expect.element(results()).toBeVisible();
    expect(page.getByRole('tablist').elements()).toHaveLength(0);
    expect(page.getByRole('button', { name: 'Back to start' }).query()).toBeNull();
    expect(editPolicy().query()).toBeNull();
    // The flip's visible label is "Policy"; its name differs from the header's Policy button, so
    // no two buttons answer to the same name.
    const flip = page.getByTestId('dock-flip');
    await expect.element(flip).toHaveTextContent('Policy');
    expect(page.getByRole('button', { name: 'Policy', exact: true }).elements()).toHaveLength(1);
    await flip.click();
    await expect.element(tab('Policy')).toHaveFocus();
    await expect.element(run()).toBeVisible();
  });

  it('in the view, a folded rail names its Policy button apart from the header', async () => {
    await page.viewport(1024, 768);
    await setup({ mode: 'view', initialPolicy: DEFAULT_POLICY });
    await toReady();
    await policyButton().click();
    await expect.poll(dockPanel).toBeNull();
    expect(page.getByRole('button', { name: 'Policy', exact: true }).elements()).toHaveLength(1);
    await expect.element(page.getByRole('button', { name: 'Policy summary' })).toBeVisible();
  });

  it('in the view at 375 px, one button is named Policy with the Menu open (the handle is not)', async () => {
    await page.viewport(375, 700);
    await setup({ mode: 'view', initialPolicy: DEFAULT_POLICY });
    await toReady();
    await page.getByRole('button', { name: 'Menu' }).click();
    await expect.element(policyButton()).toBeVisible();
    expect(page.getByRole('button', { name: 'Policy', exact: true }).elements()).toHaveLength(1);
    // The handle keeps its visible "Policy" and is named "Policy summary", as the rail's button.
    await expect.element(handle()).toHaveTextContent('Policy');
    await expect.element(handle()).toHaveAccessibleName('Policy summary');
  });

  it('/sim at 375 px keeps the handle named by its tab', async () => {
    await readySim(375);
    await expect.element(handle()).toHaveAccessibleName('Transit');
  });

  it('a remount opens in Setup', async () => {
    await page.viewport(1024, 768);
    const first = await setup();
    await toReady();
    await run().click();
    await expect.element(editPolicy()).toBeVisible();
    await first.unmount();
    await setup();
    await toReady();
    await expect.element(run()).toBeVisible();
    expect(editPolicy().query()).toBeNull();
    await expect.element(tab('Transit')).toHaveAttribute('aria-selected', 'true');
  });

  const playLabel = () => page.getByTestId('fzp-play-label');
  const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));

  it('Run inside the 250 ms debounce waits, then plays the new policy', async () => {
    stub.reset();
    await page.viewport(1024, 768);
    // The debounce is held until the test releases it, so Run lands inside it on any machine.
    const held = new Map<number, () => void>();
    let nextId = 1;
    const leverTimers = {
      setTimeout: ((fn: () => void) => {
        const id = nextId++;
        held.set(id, fn);
        return id;
      }) as unknown as typeof setTimeout,
      clearTimeout: ((id: number) => void held.delete(id)) as unknown as typeof clearTimeout
    };
    const release = () => {
      const fns = [...held.values()];
      held.clear();
      for (const fn of fns) fn();
    };
    await setup({ leverTimers });
    await toReady();
    const w = workers.at(-1)!;
    await tab('Protect').click();
    await historic().click();
    await run().click();
    await wait(50);
    expect(held.size).toBe(1); // still inside the debounce
    expect(w.allOf('setLevers')).toHaveLength(0);
    await expect.element(playLabel()).toHaveTextContent(/^Run$/);
    release();
    await expect.poll(() => w.allOf('setLevers').length).toBe(1);
    await wait(50);
    await expect.element(playLabel()).toHaveTextContent(/^Run$/);
    // A second press while waiting plays nothing.
    await run().click();
    await wait(50);
    await expect.element(playLabel()).toHaveTextContent(/^Run$/);
    w.emit(timelineMsg(w.lastOf('setLevers')!.rev, 7));
    await expect.element(page.getByTestId('fzp-play')).toHaveAttribute('aria-pressed', 'true');
  });

  it("Run while a brush's lots are being found waits for them", async () => {
    stub.reset();
    await page.viewport(1024, 768);
    await setup();
    await toReady();
    const w = workers.at(-1)!;
    await tab('Paint').click();
    await page.getByRole('radio', { name: 'Paint' }).click();
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
    await expect.poll(() => w.allOf('resolveBrush').length).toBe(1);
    await run().click();
    await wait(400); // past the debounce: the lots still hold the send
    expect(w.allOf('setLevers')).toHaveLength(0);
    await expect.element(playLabel()).toHaveTextContent(/^Run$/);
    w.emit({
      type: 'brushLots',
      reqId: w.lastOf('resolveBrush')!.reqId,
      result: { ok: true, lots: ['P0'], points: new Float64Array(2) }
    });
    await expect.poll(() => w.allOf('setLevers').length).toBe(1);
    await wait(50);
    await expect.element(playLabel()).toHaveTextContent(/^Run$/);
    w.emit(timelineMsg(w.lastOf('setLevers')!.rev, 7));
    await expect.element(page.getByTestId('fzp-play')).toHaveAttribute('aria-pressed', 'true');
  });

  it('at 375 px, Edit policy in the sheet keeps focus in the sheet', async () => {
    await page.viewport(375, 700);
    await setup();
    await toReady();
    await run().click();
    await editPolicy().click();
    await expect.element(tab('Transit')).toHaveFocus();
    expect(document.querySelector('.sfh-dock-sheet')!.contains(document.activeElement)).toBe(true);
  });
});

describe('SimPage score comparison (spec §5)', () => {
  const historic = () =>
    page.getByRole('checkbox', { name: 'Historic buildings (status A or A*)' });
  /** The comparison line, read on the dock's Results face (flipped to by the header score). */
  async function comparison() {
    const b = scoreButton();
    await expect.element(b).toBeInTheDocument();
    if (b.element().getAttribute('aria-expanded') !== 'true') await b.click();
    return results().getByText(/vs (no )?FZP/);
  }

  it('names the comparison of the score on show until the new revision answers', async () => {
    stub.reset();
    await page.viewport(1024, 768);
    await setup();
    await toReady();
    const w = workers.at(-1)!;
    await expect.element(await comparison()).toHaveTextContent(/^FZP added .* vs no FZP$/);
    await editPolicy().click();
    await tab('Protect').click();
    await historic().click();
    await expect.poll(() => w.allOf('setLevers').length).toBe(1);
    // Sent, not answered: the score on show is still FZP vs no FZP.
    await expect.element(await comparison()).toHaveTextContent(/^FZP added .* vs no FZP$/);
    w.emit(timelineMsg(w.lastOf('setLevers')!.rev, 7));
    await expect.element(await comparison()).toHaveTextContent(/^Your policy added .* vs FZP$/);

    // Undo back to the default: the line stays on "your policy" until that revision answers.
    await editPolicy().click();
    await page.getByRole('button', { name: 'Undo: Protected historic buildings' }).click();
    await expect.poll(() => w.allOf('setLevers').length).toBe(2);
    await expect.element(await comparison()).toHaveTextContent(/^Your policy added .* vs FZP$/);
    w.emit(timelineMsg(w.lastOf('setLevers')!.rev, 7));
    await expect.element(await comparison()).toHaveTextContent(/^FZP added .* vs no FZP$/);
  });
});

describe('SimPage map overlays (plan 2, Task 4)', () => {
  const run = () => page.getByRole('button', { name: 'Run', exact: true });
  const viewButton = () => page.getByRole('button', { name: 'View', exact: true });
  const overlays = () => (callsOf('setOverlayLayers').at(-1)?.[0] ?? []) as LimitsLayerLike[];
  const overlayIds = () => overlays().map((l) => l.id);
  type LimitsLayerLike = {
    id: string;
    props: { city: unknown; lids: unknown; mode: unknown; theme: string };
  };
  /** The limits layer in the latest overlay, or undefined. */
  const lastLayer = () => overlays().find((l) => l.id === LIMITS_LAYER_ID);
  /** The worker posts the height regions of its latest lever revision. */
  function emitHeights(w: (typeof workers)[number]) {
    const rev = Math.max(w.lastOf('initScenario')!.rev, ...w.allOf('setLevers').map((m) => m.rev));
    const { city } = tinyLimits();
    w.emit({ type: 'heights', rev, city: { ...city, rev } });
    return city;
  }
  /** Zooms the stub map to `zoom` and ends the move. */
  function moveTo(zoom: number) {
    stub.map.zoom = zoom;
    stub.map.fire('moveend');
  }
  async function scheme(value: 'light' | 'dark') {
    await cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value }]
    });
  }

  it('the View menu and the limits layer show in Setup only', async () => {
    stub.reset();
    await page.viewport(1024, 768);
    await setup();
    await toReady();
    await expect.element(viewButton()).toBeVisible();
    expect(stub.props.view).toEqual(DEFAULT_VIEW);
    emitHeights(workers.at(-1)!);
    await expect.poll(overlayIds).toContain(LIMITS_LAYER_ID);
    expect(lastLayer()!.props).toMatchObject({ lids: null, mode: { kind: 'plain' } });
    await run().click();
    expect(viewButton().query()).toBeNull();
    expect(stub.props.view).toEqual(HIDDEN_VIEW);
    await expect.poll(overlayIds).not.toContain(LIMITS_LAYER_ID);
    await editPolicy().click();
    await expect.poll(overlayIds).toContain(LIMITS_LAYER_ID);
  });

  it('at zoom ≥ 14.5 the page asks heightLids for the view; below, it asks nothing', async () => {
    stub.reset();
    await page.viewport(1024, 768);
    await setup();
    await toReady();
    const w = workers.at(-1)!;
    emitHeights(w);
    await expect.poll(overlayIds).toContain(LIMITS_LAYER_ID);
    moveTo(14);
    await new Promise((res) => setTimeout(res, 50));
    expect(w.allOf('heightLids')).toHaveLength(0);
    // The stub's view is 4.4 km wide (a 2560 px window at z14.5): clamped around the view's
    // centre, which a pitched map puts off the middle of its bounds (R14).
    const centre = { lng: -122.44, lat: 37.76 };
    stub.map.getCenter = () => centre;
    moveTo(14.5);
    await expect.poll(() => w.allOf('heightLids').length).toBe(1);
    const asked = w.lastOf('heightLids')!.bbox;
    expect(asked).toEqual(clampBbox(stub.map.bounds, LID_MAX_SPAN_M, [centre.lng, centre.lat]));
    expect(asked[0] <= centre.lng && centre.lng <= asked[2]).toBe(true);
    expect(asked[2] - asked[0]).toBeLessThan(stub.map.bounds[2] - stub.map.bounds[0]);
    const { lids } = tinyLimits();
    w.emit({
      type: 'heightLids',
      reqId: w.lastOf('heightLids')!.reqId,
      result: { ok: true, lids, missing: 0 }
    });
    await expect.poll(() => lastLayer()?.props.lids).toBe(lids);
    // Zoomed out again: the lids go, the contours stay.
    moveTo(13);
    await expect.poll(() => lastLayer()?.props.lids).toBeNull();
    expect(lastLayer()!.props.city).not.toBeNull();
    expect(w.allOf('heightLids')).toHaveLength(1);
  });

  it('a theme change or a tool change rebuilds the layer without a new heightLids', async () => {
    stub.reset();
    await page.viewport(1024, 768);
    await setup();
    await toReady();
    const w = workers.at(-1)!;
    emitHeights(w);
    moveTo(15);
    await expect.poll(() => w.allOf('heightLids').length).toBe(1);
    const { lids } = tinyLimits();
    w.emit({
      type: 'heightLids',
      reqId: w.lastOf('heightLids')!.reqId,
      result: { ok: true, lids, missing: 0 }
    });
    await expect.poll(() => lastLayer()?.props.lids).toBe(lids);
    const before = w.allOf('heightLids').length;
    try {
      await scheme('dark');
      await expect.poll(() => lastLayer()?.props.theme).toBe('dark');
      await tab('Paint').click();
      await page.getByRole('radio', { name: 'Paint' }).click();
      await expect.poll(() => lastLayer()?.props.mode).toEqual({ kind: 'paint' });
      await page.getByRole('radio', { name: 'Erase' }).click();
      expect(lastLayer()!.props.mode).toEqual({ kind: 'paint' });
      await page.getByRole('radio', { name: 'Move' }).click();
      await expect.poll(() => lastLayer()?.props.mode).toEqual({ kind: 'plain' });
      await page.getByRole('radio', { name: 'Paint' }).click();
      await expect.poll(() => lastLayer()?.props.mode).toEqual({ kind: 'paint' });
      expect(lastLayer()!.props.lids).toBe(lids);
      expect(w.allOf('heightLids')).toHaveLength(before);
    } finally {
      await scheme('light');
    }
  });

  it('no-session drops the lids, keeps the contours and asks again on the next client', async () => {
    stub.reset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await page.viewport(1024, 768);
    await setup();
    await toReady();
    const w = workers.at(-1)!;
    emitHeights(w);
    moveTo(15);
    await expect.poll(() => w.allOf('heightLids').length).toBe(1);
    const { lids } = tinyLimits();
    w.emit({
      type: 'heightLids',
      reqId: w.lastOf('heightLids')!.reqId,
      result: { ok: true, lids, missing: 0 }
    });
    await expect.poll(() => lastLayer()?.props.lids).toBe(lids);
    // A pan: asked again; the worker crashes before answering (no-session).
    stub.map.bounds = [-122.44, 37.75, -122.43, 37.76];
    moveTo(15);
    await expect.poll(() => w.allOf('heightLids').length).toBe(2);
    w.crash();
    await expect.poll(() => lastLayer()?.props.lids).toBeNull();
    expect(lastLayer()!.props.city).not.toBeNull();
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect.poll(() => workers.at(-1)).not.toBe(w);
    const w2 = workers.at(-1)!;
    await expect.poll(() => w2.allOf('heightLids').length).toBe(1);
  });

  it('a stored heightLimits: false draws nothing until turned on', async () => {
    stub.reset();
    await page.viewport(1024, 768);
    const mem = new MemoryStorage();
    mem.setItem(
      VIEW_KEY,
      JSON.stringify({ transitStops: false, transitAccess: true, heightFog: false })
    );
    await setup({ storage: () => mem });
    await toReady();
    const w = workers.at(-1)!;
    emitHeights(w);
    moveTo(15);
    await new Promise((res) => setTimeout(res, 50));
    expect(overlayIds()).not.toContain(LIMITS_LAYER_ID);
    expect(w.allOf('heightLids')).toHaveLength(0);
    await viewButton().click();
    await page.getByRole('checkbox', { name: 'Zoning height limits' }).click();
    await expect.poll(overlayIds).toContain(LIMITS_LAYER_ID);
    await expect.poll(() => w.allOf('heightLids').length).toBe(1);
  });

  describe('layer selection (Task 13; sim-ux plan 4, Task 2)', () => {
    const RULES_DOC: SimDoc = {
      schema: 2,
      kind: 'sim',
      datasetVersion: 'fixture-0',
      policy: {
        ...DEFAULT_POLICY,
        rules: [
          { id: 'r1', kind: 'transit', stopTypes: ['metro'], bands: [{ maxM: 402, stories: 8 }] }
        ]
      }
    };
    const layerRow = () => page.getByRole('button', { name: /^Near Muni Metro/ });
    const fzpRow = () => page.getByRole('button', { name: 'FZP baseline', exact: true });
    async function withRule() {
      stub.reset();
      await page.viewport(1024, 768);
      const mem = new MemoryStorage();
      mem.setItem(
        SIM_KEY,
        JSON.stringify({ v: 1, savedAt: 'x', plan: SIM_CODEC.serialize(RULES_DOC) })
      );
      await setup({ storage: () => mem });
      await toReady();
      emitHeights(workers.at(-1)!);
      await expect.poll(overlayIds).toContain(LIMITS_LAYER_ID);
    }

    it('selecting a layer sets the limits mode to its rule; the FZP row sets fzp mode', async () => {
      await withRule();
      await layerRow().click();
      await expect.element(layerRow()).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => lastLayer()?.props.mode).toEqual({ kind: 'rule', ruleId: 'r1' });
      await layerRow().click();
      await expect.poll(() => lastLayer()?.props.mode).toEqual({ kind: 'plain' });
      await fzpRow().click();
      await expect.element(fzpRow()).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => lastLayer()?.props.mode).toEqual({ kind: 'fzp' });
      // One selection: a layer replaces the baseline.
      await layerRow().click();
      await expect.element(fzpRow()).toHaveAttribute('aria-pressed', 'false');
      await expect.poll(() => lastLayer()?.props.mode).toEqual({ kind: 'rule', ruleId: 'r1' });
    });

    it('rule mode wins over the paint tool', async () => {
      await withRule();
      await tab('Paint').click();
      await page.getByRole('radio', { name: 'Paint' }).click();
      await expect.poll(() => lastLayer()?.props.mode).toEqual({ kind: 'paint' });
      await tab('Transit').click();
      await layerRow().click();
      await expect.poll(() => lastLayer()?.props.mode).toEqual({ kind: 'rule', ruleId: 'r1' });
    });

    it('removing the selected layer clears the selection and Undo does not bring it back', async () => {
      await withRule();
      await layerRow().click();
      await expect.poll(() => lastLayer()?.props.mode).toEqual({ kind: 'rule', ruleId: 'r1' });
      await page.getByRole('button', { name: 'Remove layer' }).click();
      await expect.poll(() => lastLayer()?.props.mode).toEqual({ kind: 'plain' });
      await expect
        .element(
          page.getByRole('button', {
            name: 'Undo: Removed: Allowed up to 8 stories near Muni Metro'
          })
        )
        .toBeVisible();
      await page.getByRole('button', { name: /^Undo/ }).click();
      await expect.element(layerRow()).toHaveAttribute('aria-pressed', 'false');
      expect(page.getByRole('group', { name: 'Stop types' }).query()).toBeNull();
      expect(lastLayer()!.props.mode).toEqual({ kind: 'plain' });
    });

    it('Undo of an edit keeps the layer selected and expanded', async () => {
      await withRule();
      await layerRow().click();
      const more = page.getByRole('group', { name: 'Band 1' }).getByRole('button', {
        name: 'More stories, band 1'
      });
      await more.click();
      await more.click();
      await expect
        .element(page.getByRole('button', { name: /^Undo: Edited: Allowed up to 10 stories/ }))
        .toBeVisible();
      await page.getByRole('button', { name: /^Undo/ }).click();
      await expect.element(layerRow()).toHaveAttribute('aria-pressed', 'true');
      await expect
        .element(page.getByRole('group', { name: 'Band 1' }))
        .toHaveTextContent(/8\s*stories/);
      expect(lastLayer()!.props.mode).toEqual({ kind: 'rule', ruleId: 'r1' });
      // One undo took the whole run back: the next undoes nothing (the restore is not a change).
      await expect.element(page.getByRole('button', { name: /^Undo/ })).toBeDisabled();
    });

    it('the selected layer leaving through Undo of its add clears the selection', async () => {
      stub.reset();
      await page.viewport(1024, 768);
      await setup();
      await toReady();
      const w = workers.at(-1)!;
      emitHeights(w);
      await expect.poll(() => w.lastOf('brushCatalog')).toBeTruthy();
      w.emit({
        type: 'brushCatalog',
        reqId: w.lastOf('brushCatalog')!.reqId,
        catalog: testCatalog()
      });
      await page.getByRole('button', { name: 'Add transit layer' }).click();
      await expect.poll(() => lastLayer()?.props.mode).toMatchObject({ kind: 'rule' });
      await page.getByRole('button', { name: /^Undo/ }).click();
      await expect.poll(() => lastLayer()?.props.mode).toEqual({ kind: 'plain' });
      await page.getByRole('button', { name: /^Redo/ }).click();
      const added = page.getByRole('button', { name: /^Near regional rail and Muni Metro/ });
      await expect.element(added).toHaveAttribute('aria-pressed', 'false');
      expect(lastLayer()!.props.mode).toEqual({ kind: 'plain' });
    });

    it('with Zoning height limits off, selecting a layer or the FZP row turns them on', async () => {
      for (const row of [layerRow, fzpRow]) {
        stub.reset();
        await page.viewport(1024, 768);
        const mem = new MemoryStorage();
        mem.setItem(
          SIM_KEY,
          JSON.stringify({ v: 1, savedAt: 'x', plan: SIM_CODEC.serialize(RULES_DOC) })
        );
        mem.setItem(
          VIEW_KEY,
          JSON.stringify({ transitStops: false, transitAccess: true, heightLimits: false })
        );
        const r = await setup({ storage: () => mem });
        await toReady();
        emitHeights(workers.at(-1)!);
        await new Promise((res) => setTimeout(res, 50));
        expect(overlayIds()).not.toContain(LIMITS_LAYER_ID);
        await row().click();
        await expect.poll(overlayIds).toContain(LIMITS_LAYER_ID);
        expect(lastLayer()!.props.mode).toEqual(
          row === layerRow ? { kind: 'rule', ruleId: 'r1' } : { kind: 'fzp' }
        );
        expect(JSON.parse(mem.getItem(VIEW_KEY)!).heightLimits).toBe(true);
        r.unmount();
      }
    });

    it('Run clears the selection', async () => {
      await withRule();
      await layerRow().click();
      await expect.poll(() => lastLayer()?.props.mode).toEqual({ kind: 'rule', ruleId: 'r1' });
      await run().click();
      await editPolicy().click();
      await expect.poll(overlayIds).toContain(LIMITS_LAYER_ID);
      expect(lastLayer()!.props.mode).toEqual({ kind: 'plain' });
    });
  });

  it('toggles survive a run', async () => {
    stub.reset();
    await page.viewport(1024, 768);
    await setup();
    await toReady();
    await viewButton().click();
    await page.getByRole('checkbox', { name: 'Zoning height limits' }).click();
    await page.getByRole('checkbox', { name: 'Transit stops' }).click();
    await run().click();
    await editPolicy().click();
    await expect.element(viewButton()).toBeVisible();
    expect(stub.props.view).toEqual({ ...DEFAULT_VIEW, heightLimits: false, transitStops: true });
  });

  it('without transit the menu has only the height-limits row', async () => {
    await page.viewport(1024, 768);
    await setup({ manifest: { ...manifest, transit: undefined } });
    await toReady();
    await viewButton().click();
    expect(page.getByRole('checkbox').elements()).toHaveLength(1);
    await expect
      .element(page.getByRole('checkbox', { name: 'Zoning height limits' }))
      .toBeChecked();
  });

  it('the rows follow the manifest the map renders: a Retry after a failed load brings transit', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await page.viewport(1024, 768);
    await setup({ manifest: null, manifestError: true });
    const retry = page.getByRole('button', { name: 'Retry', exact: true });
    await expect.element(retry).toBeVisible();
    await viewButton().click();
    const rows = () =>
      page.getByRole('group', { name: 'Map layers' }).getByRole('checkbox').elements();
    expect(rows()).toHaveLength(1);
    await viewButton().click(); // close
    await retry.click();
    await toReady();
    await viewButton().click();
    await expect.element(page.getByRole('checkbox', { name: 'Transit stops' })).toBeVisible();
    expect(rows()).toHaveLength(3);
  });

  it('the prefs are read from and written to the page storage', async () => {
    stub.reset();
    await page.viewport(1024, 768);
    const mem = new MemoryStorage();
    mem.setItem(VIEW_KEY, JSON.stringify({ transitStops: true, transitAccess: true }));
    await setup({ storage: () => mem });
    await toReady();
    await expect
      .poll(() => stub.props.view)
      .toEqual({ transitStops: true, transitAccess: true, heightLimits: true });
    await viewButton().click();
    await page.getByRole('checkbox', { name: 'Zoning height limits' }).click();
    await expect
      .poll(() => JSON.parse(mem.getItem(VIEW_KEY) ?? '{}'))
      .toEqual({ transitStops: true, transitAccess: true, heightLimits: false });
  });

  it('the view (/s/:id) shows the View menu in Setup', async () => {
    stub.reset();
    await page.viewport(1024, 768);
    await setup({ mode: 'view', initialPolicy: DEFAULT_POLICY });
    await toReady();
    await expect.element(viewButton()).toBeVisible();
    await run().click();
    expect(viewButton().query()).toBeNull();
    await page.getByTestId('dock-flip').click();
    await expect.element(viewButton()).toBeVisible();
  });
});

describe('SimPage live preview (sim-ux plan 3, Task 4)', () => {
  const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
  /** `window.__sfhSim` (installed while `VITE_E2E` is '1', see `readySim`). */
  const preview = () => window.__sfhSim?.preview;
  const feedbackIds = () =>
    ((callsOf('setOverlayLayers').at(-1)?.[0] ?? []) as { id: string }[])
      .map((l) => l.id)
      .filter((id) => id.startsWith('sim-feedback-'));
  const ev = (type: string, x: number, pointerId = 1) =>
    stub.map.getCanvas().dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: 10,
        pointerId,
        pointerType: 'mouse',
        button: type === 'pointermove' ? -1 : 0,
        isPrimary: true
      })
    );
  /** Pointer down and moves to `to` across the stub map's canvas: a stroke still in progress. */
  function drag(from: number, to: number, pointerId = 1): void {
    ev('pointerdown', from, pointerId);
    for (let x = from + 10; x <= to; x += 10) ev('pointermove', x, pointerId);
  }
  /** More of the stroke in progress, from `from` to `to`. */
  function moveTo(from: number, to: number, pointerId = 1): void {
    for (let x = from; x <= to; x += 10) ev('pointermove', x, pointerId);
  }
  /** A one-part pack: a small box at the map's centre. */
  function pack(): PackedCell {
    const c = stub.map.getCenter();
    const d = 1e-4;
    const ring = [c.lng, c.lat, c.lng, c.lat + d, c.lng + d, c.lat + d, c.lng + d, c.lat];
    return {
      cellId: 'preview',
      parcelIds: ['P0'],
      parcelMeta: Uint32Array.from([4, 1, 3, 0]),
      partCount: 1,
      startIndices: Uint32Array.from([0, 5]),
      positions: Float64Array.from([...ring, c.lng, c.lat]),
      partTopM: Float32Array.from([10]),
      partSlot: Uint32Array.from([0]),
      partAppearance: Uint8Array.from([0]),
      partTypology: Uint8Array.from([0])
    };
  }
  type W = (typeof workers)[number];
  /** Answers the `n`th (1-based) resolveBrush: P0 at the centre, FAR out of view. */
  function answerLots(w: W, n: number): void {
    const c = stub.map.getCenter();
    w.emit({
      type: 'brushLots',
      reqId: w.allOf('resolveBrush')[n - 1].reqId,
      result: { ok: true, lots: ['P0', 'FAR'], points: Float64Array.from([c.lng, c.lat, 0, 0]) }
    });
  }
  /** Answers the `n`th (1-based) previewBuildings with a pack. */
  function answerBuildings(w: W, n: number): void {
    w.emit({
      type: 'previewBuildings',
      reqId: w.allOf('previewBuildings')[n - 1].reqId,
      result: { ok: true, pack: pack(), built: 1, missing: 0 }
    });
  }
  /** /sim ready in Setup with `tool` chosen on the Paint tab. */
  async function readyToPaint(tool: 'Paint' | 'Erase' = 'Paint') {
    const { w } = await readySim();
    await tab('Paint').click();
    const radio = page.getByRole('radio', { name: tool });
    await expect.element(radio).toBeEnabled();
    await radio.click();
    await expect.poll(() => callsOf('setPanEnabled').at(-1)?.[0]).toBe(false);
    return w;
  }
  /** Mid-stroke, the first preview answered: its buildings show. */
  async function liveStroke(w: W) {
    drag(10, 40);
    await expect.poll(() => w.allOf('resolveBrush').length).toBe(1);
    answerLots(w, 1);
    await expect.poll(() => w.allOf('previewBuildings').length).toBe(1);
    answerBuildings(w, 1);
    await expect.poll(preview).toBe('live');
  }

  /** The client project runs with reduced motion; the fade needs it off. */
  const motion = (value: 'reduce' | 'no-preference') =>
    cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value }]
    });

  afterEach(async () => {
    vi.restoreAllMocks();
    await motion('reduce');
  });

  it('a Paint drag asks previewBuildings mid-stroke and fades on release', async () => {
    await motion('no-preference');
    const w = await readyToPaint();
    expect(preview()).toBe('none');
    drag(10, 40);
    // The first preview goes out on the next frame, before any pointer-up.
    await expect.poll(() => w.allOf('resolveBrush').length).toBe(1);
    expect(w.lastOf('resolveBrush')!.query).toMatchObject({ kind: 'freehand' });
    answerLots(w, 1);
    await expect.poll(() => w.allOf('previewBuildings').length).toBe(1);
    // The stroke's lots in view, nearest the ring, at the brush's stories.
    expect(w.lastOf('previewBuildings')).toMatchObject({ lots: ['P0'], stories: 6 });
    answerBuildings(w, 1);
    await expect.poll(preview).toBe('live');
    expect(feedbackIds()).toEqual(['sim-feedback-1']);
    // One in flight: more of the stroke asks again once the first was answered.
    moveTo(50, 80);
    await expect.poll(() => w.allOf('resolveBrush').length).toBe(2);
    ev('pointerup', 80);
    expect(preview()).toBe('fading');
    await expect.poll(preview, { timeout: 4000 }).toBe('none');
    expect(feedbackIds()).toEqual([]);
  });

  it('release before an answer arrives: the late answer is dropped and nothing comes back after the fade', async () => {
    await motion('no-preference');
    const w = await readyToPaint();
    await liveStroke(w);
    moveTo(50, 80);
    await expect.poll(() => w.allOf('resolveBrush').length).toBe(2);
    answerLots(w, 2);
    await expect.poll(() => w.allOf('previewBuildings').length).toBe(2);
    ev('pointerup', 80);
    expect(preview()).toBe('fading');
    answerBuildings(w, 2); // the second preview's answer, after the release
    await wait(100);
    expect(preview()).not.toBe('live');
    expect(feedbackIds()).not.toContain('sim-feedback-2');
    await expect.poll(preview, { timeout: 4000 }).toBe('none');
    await wait(100);
    expect(preview()).toBe('none');
    expect(feedbackIds()).toEqual([]);
  });

  it('Escape mid-stroke clears the buildings at once; the cancelled preview is answered and the next stroke previews', async () => {
    const done = vi.spyOn(BrushController.prototype, 'previewDone');
    const w = await readyToPaint();
    await liveStroke(w);
    expect(done).toHaveBeenCalledTimes(1);
    moveTo(50, 80);
    await expect.poll(() => w.allOf('resolveBrush').length).toBe(2);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    // A cancelled stroke committed nothing: no fade, the buildings go at once.
    expect(preview()).toBe('none');
    expect(feedbackIds()).toEqual([]);
    answerLots(w, 2); // the cancelled preview's lots: dropped, but answered
    await expect.poll(() => done.mock.calls.length).toBe(2);
    await wait(50);
    expect(w.allOf('previewBuildings')).toHaveLength(1);
    expect(preview()).toBe('none');
    ev('pointerup', 80);
    // The next stroke's first preview goes out on its first frame.
    drag(10, 40, 2);
    await expect.poll(() => w.allOf('resolveBrush').length).toBe(3);
    ev('pointerup', 40, 2);
  });

  it('a new map mid-stroke clears the live buildings and drops the answers still on their way', async () => {
    const w = await readyToPaint();
    await liveStroke(w);
    moveTo(50, 80);
    await expect.poll(() => w.allOf('resolveBrush').length).toBe(2);
    // The map is replaced (a style reload): the old controller is destroyed, with a preview in
    // flight and buildings on screen.
    stub.map = new FakeMap();
    stub.fireReady();
    expect(preview()).toBe('none');
    expect(feedbackIds()).toEqual([]);
    // The in-flight preview's answers arrive late: nothing shows.
    answerLots(w, 2);
    await wait(50);
    expect(w.allOf('previewBuildings')).toHaveLength(1);
    expect(preview()).toBe('none');
  });

  it('an Erase drag shows no buildings, and each of its previews is answered', async () => {
    const done = vi.spyOn(BrushController.prototype, 'previewDone');
    const w = await readyToPaint('Erase');
    drag(10, 40);
    await expect.poll(() => done.mock.calls.length).toBe(1);
    moveTo(50, 80);
    // The controller sent a second preview, so it saw the first answered.
    await expect.poll(() => done.mock.calls.length).toBe(2);
    expect(w.allOf('resolveBrush')).toHaveLength(0);
    expect(w.allOf('previewBuildings')).toHaveLength(0);
    expect(preview()).toBe('none');
    ev('pointerup', 80);
    await wait(50);
    expect(w.allOf('previewBuildings')).toHaveLength(0);
    expect(feedbackIds()).toEqual([]);
  });

  it('Run mid-stroke clears the preview and drops the answer on its way', async () => {
    const w = await readyToPaint();
    await liveStroke(w);
    moveTo(50, 80);
    await expect.poll(() => w.allOf('resolveBrush').length).toBe(2);
    answerLots(w, 2);
    await expect.poll(() => w.allOf('previewBuildings').length).toBe(2);
    await pressRun();
    expect(preview()).toBe('none');
    expect(feedbackIds()).toEqual([]);
    answerBuildings(w, 2);
    await wait(100);
    expect(preview()).toBe('none');
    expect(feedbackIds()).toEqual([]);
  });

  it('Run during the fade clears the preview at once', async () => {
    await motion('no-preference');
    const w = await readyToPaint();
    await liveStroke(w);
    ev('pointerup', 40);
    expect(preview()).toBe('fading');
    await pressRun();
    expect(preview()).toBe('none');
    expect(feedbackIds()).toEqual([]);
  });

  /** The worker's `resolving` then `current` for `rev`. */
  function leversCurrent(rev: number): void {
    const w = workers.at(-1)!;
    const one = () => ({
      chance: chanceTable(calibration),
      typicalMonths: typicalMonths(calibration)
    });
    w.emit({ type: 'levers', rev, phase: 'resolving', done: 0, total: 0, failedCells: [] });
    w.emit({
      type: 'levers',
      rev,
      phase: 'current',
      lookups: { inFlight: one(), fresh: one() },
      capacity: { plan: 10, withoutProtections: 10, protectedLots: 0 },
      unknownLots: 0
    });
  }

  it('under reduced motion a release clears the buildings at once', async () => {
    const w = await readyToPaint();
    await liveStroke(w);
    ev('pointerup', 40);
    expect(preview()).toBe('none');
    expect(feedbackIds()).toEqual([]);
  });

  it('an edit sends a new revision and shows no preview buildings', async () => {
    stub.reset();
    vi.stubEnv('VITE_E2E', '1');
    await page.viewport(1024, 768);
    const mem = new MemoryStorage();
    const doc: SimDoc = {
      schema: 2,
      kind: 'sim',
      datasetVersion: 'fixture-0',
      policy: {
        ...DEFAULT_POLICY,
        rules: [
          { id: 'r1', kind: 'transit', stopTypes: ['metro'], bands: [{ maxM: 402, stories: 8 }] }
        ]
      }
    };
    mem.setItem(SIM_KEY, JSON.stringify({ v: 1, savedAt: 'x', plan: SIM_CODEC.serialize(doc) }));
    await setup({ storage: () => mem });
    await toReady();
    const w = workers.at(-1)!;
    await expect.poll(() => w.allOf('resolveBrush').length).toBeGreaterThan(0);
    const c = stub.map.getCenter();
    for (const q of w.allOf('resolveBrush'))
      w.emit({
        type: 'brushLots',
        reqId: q.reqId,
        result: { ok: true, lots: ['P0', 'FAR'], points: Float64Array.from([c.lng, c.lat, 0, 0]) }
      });
    await expect.poll(() => w.allOf('setLevers').length, { timeout: 2000 }).toBe(1);
    leversCurrent(w.lastOf('setLevers')!.rev);
    await expect.poll(() => fzpDebug().levers.status).toBe('current');
    // A stories edit needs no new lots: the next revision goes out with the new height.
    await page.getByRole('button', { name: /^Near Muni Metro/ }).click();
    await page
      .getByRole('group', { name: 'Band 1' })
      .getByRole('button', { name: 'More stories, band 1' })
      .click();
    await expect.poll(() => w.allOf('setLevers').length, { timeout: 2000 }).toBe(2);
    expect(w.lastOf('setLevers')!.levers.rules[0].stories).toBe(9);
    leversCurrent(w.lastOf('setLevers')!.rev);
    await expect.poll(() => fzpDebug().levers.status).toBe('current');
    await wait(100);
    expect(w.allOf('previewBuildings')).toHaveLength(0);
    expect(preview()).toBe('none');
    expect(feedbackIds()).toEqual([]);
  });
});

describe('SimPage map selection (sim-ux plan 4, Task 4)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  type W = (typeof workers)[number];
  const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
  /** A point inside the stub map's view: the lot the tests click. */
  const X: [number, number] = [-122.42, 37.76];
  const ruleId = 'r1';
  const paintId = 'b1';
  const DOC: SimDoc = {
    schema: 2,
    kind: 'sim',
    datasetVersion: 'fixture-0',
    policy: {
      ...DEFAULT_POLICY,
      rules: [
        { id: ruleId, kind: 'transit', stopTypes: ['metro'], bands: [{ maxM: 402, stories: 8 }] }
      ],
      custom: [{ id: paintId, kind: 'paint', strokes: [{ path: [X], radiusM: 20 }], stories: 9 }]
    }
  };
  const layerButton = (id: string) =>
    document.querySelector<HTMLElement>(`[data-layer-row="${id}"] > button`);
  const paintButton = (id: string) =>
    document.querySelector<HTMLElement>(`[data-paint-row="${id}"]`);
  /** The pressed Transit and Paint rows, by layer id (`fzp` for the baseline) or area id. */
  const pressed = () =>
    [...document.querySelectorAll<HTMLElement>('[data-layer-row] > button, [data-paint-row]')]
      .filter((b) => b.getAttribute('aria-pressed') === 'true')
      .map(
        (b) => b.closest('[data-layer-row]')?.getAttribute('data-layer-row') ?? b.dataset.paintRow
      );

  /** /sim ready in Setup with DOC restored (a transit layer and a painted area), its lots found. */
  async function readySimWithRule(width = 1024) {
    const mem = new MemoryStorage();
    mem.setItem(SIM_KEY, JSON.stringify({ v: 1, savedAt: 'x', plan: SIM_CODEC.serialize(DOC) }));
    const { w } = await readySim(width, { storage: () => mem });
    await expect.poll(() => w.allOf('resolveBrush').length).toBe(2);
    for (const q of w.allOf('resolveBrush'))
      w.emit({
        type: 'brushLots',
        reqId: q.reqId,
        result: { ok: true, lots: ['X'], points: Float64Array.from(X) }
      });
    return { w, map: stub.map };
  }

  function clickAt(map: FakeMap, [lng, lat]: [number, number] = X): void {
    map.fire('click', { lngLat: { lng, lat } });
  }
  type Owner = { kind: 'fzp' } | { kind: 'paint' } | { kind: 'rule'; ruleId: string } | null;
  /** Answers the `n`th (1-based; default the latest) lotAt. */
  function answer(w: W, owner: Owner, parcelId: string | null = 'X', n?: number): void {
    const all = w.allOf('lotAt');
    const req = n === undefined ? all.at(-1)! : all[n - 1];
    w.emit({ type: 'lotAt', reqId: req.reqId, result: { ok: true, parcelId, owner } });
  }

  it('a click with Move in Set Policy asks lotAt and selects the rule that owns the lot', async () => {
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView');
    const { w, map } = await readySimWithRule();
    await tab('Protect').click();
    (document.activeElement as HTMLElement | null)?.blur();
    const focused = document.activeElement;
    map.fire('click', { lngLat: { lng: X[0], lat: X[1] } });
    const req = w.lastOf('lotAt')!;
    expect(req.point).toEqual(X);
    w.emit({
      type: 'lotAt',
      reqId: req.reqId,
      result: { ok: true, parcelId: 'X', owner: { kind: 'rule', ruleId: ruleId } }
    });
    const selected = () =>
      document.querySelector(`[data-layer-row="${ruleId}"] [aria-pressed="true"]`);
    await expect.poll(selected).not.toBeNull();
    await expect.element(page.elementLocator(selected()!)).toBeVisible();
    await expect.element(tab('Transit')).toHaveAttribute('aria-selected', 'true');
    // Selected and expanded, scrolled into view; focus stays where it was (on the map).
    await expect.element(page.getByRole('group', { name: 'Stop types' })).toBeVisible();
    await expect
      .poll(() => scrolled.mock.contexts.includes(layerButton(ruleId)!.parentElement))
      .toBe(true);
    expect(scrolled).toHaveBeenCalledWith({ block: 'nearest' });
    expect(document.activeElement).toBe(focused);
    expect(dockEl()!.contains(document.activeElement)).toBe(false);
  });

  it('a painted owner opens the Paint tab on that area', async () => {
    const { w, map } = await readySimWithRule();
    // From the Results face too: the click shows the editing face.
    await scoreButton().click();
    await expect.element(results()).toBeVisible();
    clickAt(map);
    answer(w, { kind: 'paint' });
    await expect.element(tab('Paint')).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => paintButton(paintId)?.getAttribute('aria-pressed')).toBe('true');
    expect(pressed()).toEqual([paintId]);
  });

  it('an FZP owner selects the baseline row; a click on no lot clears the selection', async () => {
    const { w, map } = await readySimWithRule();
    clickAt(map);
    answer(w, { kind: 'fzp' });
    await expect.poll(() => layerButton('fzp')?.getAttribute('aria-pressed')).toBe('true');
    expect(pressed()).toEqual(['fzp']);
    clickAt(map, [-122.5, 37.7]);
    answer(w, null, null);
    await expect.poll(pressed).toEqual([]);
  });

  it('only the latest click answer counts', async () => {
    const { w, map } = await readySimWithRule();
    clickAt(map);
    clickAt(map);
    expect(w.allOf('lotAt')).toHaveLength(2);
    // The second answers first; the first, late, changes nothing.
    answer(w, { kind: 'fzp' }, 'X', 2);
    await expect.poll(pressed).toEqual(['fzp']);
    answer(w, { kind: 'rule', ruleId }, 'X', 1);
    await wait(50);
    expect(pressed()).toEqual(['fzp']);
    // An older answer arriving before the latest one is dropped too.
    clickAt(map);
    clickAt(map);
    answer(w, { kind: 'paint' }, 'X', 3);
    await wait(50);
    expect(pressed()).toEqual(['fzp']);
    answer(w, { kind: 'rule', ruleId }, 'X', 4);
    await expect.poll(pressed).toEqual([ruleId]);
  });

  it('a no-session answer changes nothing', async () => {
    const { w, map } = await readySimWithRule();
    clickAt(map);
    answer(w, { kind: 'rule', ruleId });
    await expect.poll(pressed).toEqual([ruleId]);
    await tab('Protect').click();
    clickAt(map);
    w.emit({
      type: 'lotAt',
      reqId: w.lastOf('lotAt')!.reqId,
      result: { ok: false, reason: 'no-session', message: 'x' }
    });
    await wait(50);
    await expect.element(tab('Protect')).toHaveAttribute('aria-selected', 'true');
    await tab('Transit').click();
    expect(pressed()).toEqual([ruleId]);
  });

  // Review focus 1: the worker answers from the limits it holds now, which may be a revision behind.
  it('a click while a revision resolves follows the answer; a rule since removed selects FZP', async () => {
    const { w, map } = await readySimWithRule();
    await page.getByRole('button', { name: /^Near Muni Metro/ }).click();
    await page.getByRole('button', { name: 'Remove layer' }).click();
    await expect.poll(() => layerButton(ruleId)).toBeNull();
    // The removal's revision is still on its way: the worker still names r1.
    clickAt(map);
    answer(w, { kind: 'rule', ruleId });
    await expect.poll(pressed).toEqual(['fzp']);
    // An owner from the revision before that is still in the policy is selected.
    clickAt(map);
    answer(w, { kind: 'paint' });
    await expect.poll(pressed).toEqual([paintId]);
  });

  // Review focus 4: in each state exactly one of a selection, a stroke and a card happens.
  describe('a click does exactly one thing', () => {
    /** A mouse click on the map: pointer down and up on the canvas, MapLibre's click, SimMap's pick. */
    function fullClick() {
      const canvas = stub.map.getCanvas();
      for (const type of ['pointerdown', 'pointerup'])
        canvas.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: 30,
            clientY: 10,
            pointerId: 1,
            pointerType: 'mouse',
            button: 0,
            isPrimary: true
          })
        );
      clickAt(stub.map);
      stub.props.timelinePick?.({ projectId: 'pr-1', parcelId: 'X', x: 30, y: 10, kind: 'tap' });
    }
    const counts = (w: W) => ({
      lotAt: w.allOf('lotAt').length,
      stroke: w.allOf('resolveBrush').length,
      card: w.allOf('parcelSummary').length
    });

    it('Set Policy with Move: a selection, no stroke and no card', async () => {
      const { w } = await readySim();
      // No tap card of SimMap's own either (a touch tap on a building).
      expect(stub.props.tapCards).toBe(false);
      fullClick();
      await wait(50);
      expect(counts(w)).toEqual({ lotAt: 1, stroke: 0, card: 0 });
      await expect.element(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    });

    it('Set Policy with Paint: a stroke, no selection and no card', async () => {
      const { w } = await readySim();
      await tab('Paint').click();
      await page.getByRole('radio', { name: 'Paint' }).click();
      await expect.poll(() => callsOf('setPanEnabled').at(-1)?.[0]).toBe(false);
      fullClick();
      await expect.poll(() => w.allOf('resolveBrush').length).toBe(1);
      await wait(50);
      expect(counts(w)).toEqual({ lotAt: 0, stroke: 1, card: 0 });
    });

    it('Set Policy with Erase: no selection and no card', async () => {
      const { w } = await readySim();
      await tab('Paint').click();
      await page.getByRole('radio', { name: 'Erase' }).click();
      fullClick();
      await wait(50);
      expect(counts(w)).toMatchObject({ lotAt: 0, card: 0 });
    });

    it('a run: a card, no selection and no stroke', async () => {
      const { w } = await readySim();
      await pressRun(w);
      await expect.poll(() => stub.props.tapCards).toBe(true);
      fullClick();
      await wait(50);
      expect(counts(w)).toEqual({ lotAt: 0, stroke: 0, card: 1 });
    });

    it('the view: nothing', async () => {
      vi.stubEnv('VITE_E2E', '1');
      stub.reset();
      await page.viewport(1024, 768);
      await setup({ mode: 'view', initialPolicy: DEFAULT_POLICY });
      await toReady();
      const w = workers.at(-1)!;
      expect(stub.props.tapCards).toBe(false);
      fullClick();
      await wait(50);
      expect(counts(w)).toEqual({ lotAt: 0, stroke: 0, card: 0 });
    });
  });

  it('the listener goes with a replaced map and on unmount', async () => {
    vi.stubEnv('VITE_E2E', '1');
    stub.reset();
    await page.viewport(1024, 768);
    const r = await setup();
    await toReady();
    const old = stub.map;
    await expect.poll(() => old.listenerCount('click')).toBe(1);
    stub.map = new FakeMap();
    stub.fireReady();
    expect(old.listenerCount('click')).toBe(0);
    expect(stub.map.listenerCount('click')).toBe(1);
    r.unmount();
    expect(stub.map.listenerCount('click')).toBe(0);
  });

  it('at 375 px a click opens the closed sheet at peek on the selected row', async () => {
    const { w, map } = await readySimWithRule(375);
    await expect.element(handle()).toHaveAttribute('aria-expanded', 'false');
    clickAt(map);
    answer(w, { kind: 'rule', ruleId });
    await expect.element(handle()).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(pressed).toEqual([ruleId]);
    const sheet = document.querySelector<HTMLElement>('.sfh-dock-sheet')!;
    expect(sheet.style.maxHeight).toContain('40dvh');
  });
});

describe('SimPage opening a published policy (/s)', () => {
  const brushedPolicy = (): SimDoc['policy'] => ({
    ...DEFAULT_POLICY,
    rules: [{ id: 'r', kind: 'transit', stopTypes: ['metro'], bands: [{ maxM: 402, stories: 8 }] }],
    custom: [
      { id: 'a', kind: 'paint', strokes: [{ path: [[-122.4, 37.7]], radiusM: 50 }], stories: 6 }
    ]
  });

  it('/s with brushes: the first initScenario carries awaitLevers, the full levers follow as setLevers', async () => {
    stub.reset();
    await page.viewport(1024, 768);
    await setup({ mode: 'view', initialPolicy: brushedPolicy() });
    await expect.poll(() => workers.at(-1)?.lastOf('initScenario')).toBeTruthy();
    const w = workers.at(-1)!;
    const init = w.lastOf('initScenario')!;
    expect(init.awaitLevers).toBe(true);
    // The policy without its lot lists: no rule or paint edit yet.
    expect(init.levers?.rules).toEqual([]);
    expect(init.levers?.paint).toEqual([]);
    // The brushes resolve with no timeline (the worker is waiting), and the full levers go out.
    await expect.poll(() => w.allOf('resolveBrush').length).toBe(2);
    w.allOf('resolveBrush').forEach((a, i) =>
      w.emit({
        type: 'brushLots',
        reqId: a.reqId,
        result: { ok: true, lots: [`P${i}`, `Q${i}`], points: new Float64Array(4) }
      })
    );
    await expect.poll(() => w.allOf('setLevers').length).toBe(1);
    const sent = w.lastOf('setLevers')!.levers;
    expect(sent.rules[0].lots).toHaveLength(2);
    expect(sent.paint[0].lots).toHaveLength(2);
    expect(w.allOf('initScenario')).toHaveLength(1);
  });

  it('/s without brushes: no awaitLevers', async () => {
    stub.reset();
    await page.viewport(1024, 768);
    await setup({ mode: 'view', initialPolicy: DEFAULT_POLICY });
    await expect.poll(() => workers.at(-1)?.lastOf('initScenario')).toBeTruthy();
    const init = workers.at(-1)!.lastOf('initScenario')!;
    expect(init.levers).toBeDefined();
    expect('awaitLevers' in init).toBe(false);
  });

  it('plain /sim: no awaitLevers', async () => {
    stub.reset();
    await page.viewport(1024, 768);
    await setup();
    await expect.poll(() => workers.at(-1)?.lastOf('initScenario')).toBeTruthy();
    const init = workers.at(-1)!.lastOf('initScenario')!;
    expect(init.levers).toBeDefined();
    expect('awaitLevers' in init).toBe(false);
  });
});
