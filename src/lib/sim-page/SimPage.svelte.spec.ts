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
import { stub, callsOf } from '$lib/fzp/test/sim-map-stub';
import { timelineMsg } from '$lib/fzp/test/fake-worker';
import SimPageHost from './test/SimPageHost.svelte';
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

/** The scenario answers `ready` and its first timeline: the brush tools come on. */
async function toReady() {
  await expect.poll(() => workers.at(-1)?.lastOf('initScenario')).toBeTruthy();
  const w = workers.at(-1)!;
  const rev = w.lastOf('initScenario')!.rev;
  w.emit({ type: 'ready', rev, datasetVersion: 'fixture-0', chunkCount: 4 });
  w.emit(timelineMsg(rev, 7));
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

  it('at 375 px Paint closes the sheet for the tool bar; Done goes back to Move and the Paint tab', async () => {
    await readySim(375);
    await handle().click();
    await tab('Paint').click();
    await page.getByRole('radio', { name: 'Paint' }).click();
    await expect.element(handle()).toHaveAttribute('aria-expanded', 'false');
    const bar = page.getByRole('group', { name: 'Brush' });
    await expect.element(bar).toBeVisible();
    await expect.element(bar.getByRole('button').first()).toHaveFocus();
    // The bar sits above the sheet's handle.
    const hb = handle().element().getBoundingClientRect();
    expect(bar.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(hb.top);
    await bar.getByRole('button', { name: 'Done' }).click();
    await expect.element(handle()).toHaveAttribute('aria-expanded', 'true');
    await expect.element(tab('Paint')).toHaveAttribute('aria-selected', 'true');
    await expect.element(page.getByRole('radio', { name: 'Move' })).toBeChecked();
    await expect.element(bar).not.toBeInTheDocument();
  });

  it('a rule form opens inline in the Transit tab at 375 px too', async () => {
    const { w } = await readySim(375);
    await handle().click();
    await expect.poll(() => w.lastOf('brushCatalog')).toBeTruthy();
    w.emit({
      type: 'brushCatalog',
      reqId: w.lastOf('brushCatalog')!.reqId,
      catalog: testCatalog()
    });
    await page.getByRole('button', { name: 'Add transit layer' }).click();
    const form = page.getByRole('tabpanel', { name: 'Transit' }).getByRole('form', {
      name: 'Add a transit rule'
    });
    await expect.element(form).toBeVisible();
    await expect.element(tab('Transit')).toBeVisible(); // the tabs stay: no sub-view
    expect(page.getByRole('button', { name: 'Back', exact: true }).query()).toBeNull();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect.element(page.getByRole('button', { name: 'Add transit layer' })).toHaveFocus();
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
    await expect.element(page.getByText('Finding lots…')).toBeVisible();
    await undo.click();
    await expect
      .element(page.getByRole('status').filter({ hasText: 'Undid: Allowed 6 stories' }))
      .toBeInTheDocument();
    await expect.element(page.getByText('Finding lots…')).not.toBeInTheDocument();
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

  it('an open form keeps its edits across a tab change and a run', async () => {
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
    const form = () => page.getByRole('form', { name: 'Add a transit rule' });
    await expect.element(form()).toBeVisible();
    const metro = () => page.getByRole('checkbox', { name: /^Muni Metro/ });
    const distance = () => page.getByRole('spinbutton', { name: 'Band 1 distance (m)' });
    await metro().click();
    await distance().fill('777');
    await tab('Permits').click();
    await expect.element(form()).not.toBeInTheDocument();
    await tab('Transit').click();
    await expect.element(form()).toBeVisible();
    await expect.element(metro()).toBeChecked();
    await expect.element(distance()).toHaveValue(777);
    // A remount does not take focus from the tab the user pressed.
    await expect.element(tab('Transit')).toHaveFocus();

    await pressRun(w);
    expect(form().query()).toBeNull();
    await editPolicy().click();
    await expect.element(form()).toBeVisible();
    await expect.element(metro()).toBeChecked();
    await expect.element(distance()).toHaveValue(777);
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
      .poll(
        () =>
          page.getByRole('list', { name: 'New zoning rules' }).getByRole('listitem').elements()
            .length
      )
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
      // The rule's card in the Transit tab, the custom brush's in Paint.
      for (const t of ['Transit', 'Paint']) {
        await tab(t).click();
        await expect.element(page.getByText(/· 2 lots$/)).toBeVisible();
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

  it('at 375 px the phone tool bar goes when Run starts', async () => {
    stub.reset();
    await page.viewport(375, 700);
    await setup();
    await toReady();
    await page.getByRole('button', { name: 'Menu' }).click();
    await policyButton().click();
    await tab('Paint').click();
    await page.getByRole('radio', { name: 'Paint' }).click();
    const bar = page.getByRole('group', { name: 'Brush' });
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
    await expect.element(page.getByText('No new zoning rules')).toBeVisible();
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

  describe('rule selection (Task 13)', () => {
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
    const showToggle = () => page.getByRole('button', { name: /^Show on map/ });
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

    it('a selected rule sets the layer mode to its id; pressing again clears it', async () => {
      await withRule();
      await showToggle().click();
      await expect.poll(() => lastLayer()?.props.mode).toEqual({ kind: 'rule', ruleId: 'r1' });
      await showToggle().click();
      await expect.poll(() => lastLayer()?.props.mode).toEqual({ kind: 'plain' });
    });

    it('rule mode wins over the paint tool', async () => {
      await withRule();
      await tab('Paint').click();
      await page.getByRole('radio', { name: 'Paint' }).click();
      await expect.poll(() => lastLayer()?.props.mode).toEqual({ kind: 'paint' });
      await tab('Transit').click();
      await showToggle().click();
      await expect.poll(() => lastLayer()?.props.mode).toEqual({ kind: 'rule', ruleId: 'r1' });
    });

    it('removing the selected rule clears the selection, and undo does not bring it back', async () => {
      await withRule();
      await showToggle().click();
      await expect.poll(() => lastLayer()?.props.mode).toEqual({ kind: 'rule', ruleId: 'r1' });
      await page.getByRole('button', { name: /^Remove:/ }).click();
      await expect.poll(() => lastLayer()?.props.mode).toEqual({ kind: 'plain' });
      await page.getByRole('button', { name: /^Undo/ }).click();
      await expect.element(showToggle()).toHaveAttribute('aria-pressed', 'false');
      expect(lastLayer()!.props.mode).toEqual({ kind: 'plain' });
    });

    it('the selected rule leaving through Undo of its add clears the selection', async () => {
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
      await page.getByRole('checkbox', { name: /^Muni Metro/ }).click();
      await page.getByRole('button', { name: 'Save rule' }).click();
      await showToggle().click();
      await expect.poll(() => lastLayer()?.props.mode).toMatchObject({ kind: 'rule' });
      await page.getByRole('button', { name: /^Undo/ }).click();
      await expect.poll(() => lastLayer()?.props.mode).toEqual({ kind: 'plain' });
      await page.getByRole('button', { name: /^Redo/ }).click();
      await expect.element(showToggle()).toHaveAttribute('aria-pressed', 'false');
      expect(lastLayer()!.props.mode).toEqual({ kind: 'plain' });
    });

    it('with Zoning height limits off, pressing Show on map turns them on', async () => {
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
      await setup({ storage: () => mem });
      await toReady();
      emitHeights(workers.at(-1)!);
      await new Promise((res) => setTimeout(res, 50));
      expect(overlayIds()).not.toContain(LIMITS_LAYER_ID);
      await showToggle().click();
      await expect.poll(overlayIds).toContain(LIMITS_LAYER_ID);
      expect(lastLayer()!.props.mode).toEqual({ kind: 'rule', ruleId: 'r1' });
      expect(JSON.parse(mem.getItem(VIEW_KEY)!).heightLimits).toBe(true);
    });

    it('Run clears the selection', async () => {
      await withRule();
      await showToggle().click();
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

describe('SimPage paint feedback (plan 2, Task 6)', () => {
  const run = () => page.getByRole('button', { name: 'Run', exact: true });
  const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
  const feedbackIds = () =>
    ((callsOf('setOverlayLayers').at(-1)?.[0] ?? []) as { id: string }[])
      .map((l) => l.id)
      .filter((id) => id.startsWith('sim-feedback-'));
  /** One stroke across the stub map's canvas with the current tool. */
  function stroke(): void {
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
  /** Paints one stroke and answers its lots: P0 at the centre, FAR out of view. */
  async function paintAndAnswer() {
    const w = workers.at(-1)!;
    await tab('Paint').click();
    await page.getByRole('radio', { name: 'Paint' }).click();
    stroke();
    await expect.poll(() => w.allOf('resolveBrush').length).toBe(1);
    const c = stub.map.getCenter();
    w.emit({
      type: 'brushLots',
      reqId: w.lastOf('resolveBrush')!.reqId,
      result: { ok: true, lots: ['P0', 'FAR'], points: Float64Array.from([c.lng, c.lat, 0, 0]) }
    });
    await expect.poll(() => w.allOf('previewBuildings').length).toBe(1);
    return w;
  }

  it('a Paint stroke asks for its lots in view at its stories and shows the answer', async () => {
    stub.reset();
    await page.viewport(1024, 768);
    await setup();
    await toReady();
    const w = await paintAndAnswer();
    // the stroke's own query is the new brush's: no second resolveBrush
    expect(w.allOf('resolveBrush')).toHaveLength(1);
    const req = w.lastOf('previewBuildings')!;
    expect(req).toMatchObject({ lots: ['P0'], stories: expect.any(Number) });
    w.emit({
      type: 'previewBuildings',
      reqId: req.reqId,
      result: { ok: true, pack: pack(), built: 1, missing: 0 }
    });
    await expect.poll(() => feedbackIds()).toEqual(['sim-feedback-1']);
    await expect.poll(() => feedbackIds(), { timeout: 4000 }).toEqual([]);
  });

  it('a run drops an answer still on its way', async () => {
    stub.reset();
    await page.viewport(1024, 768);
    await setup();
    await toReady();
    const w = await paintAndAnswer();
    await run().click();
    w.emit({
      type: 'previewBuildings',
      reqId: w.lastOf('previewBuildings')!.reqId,
      result: { ok: true, pack: pack(), built: 1, missing: 0 }
    });
    await wait(100);
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

  /** Saves a new transit rule through its form and answers its lots: P0 in view, FAR not. */
  async function saveRule() {
    const w = workers.at(-1)!;
    await expect.poll(() => w.lastOf('brushCatalog')).toBeTruthy();
    w.emit({
      type: 'brushCatalog',
      reqId: w.lastOf('brushCatalog')!.reqId,
      catalog: testCatalog()
    });
    await page.getByRole('button', { name: 'Add transit layer' }).click();
    await page.getByRole('checkbox', { name: /^Regional rail/ }).click();
    await page.getByRole('button', { name: 'Save rule' }).click();
    await expect.poll(() => w.allOf('resolveBrush').length).toBeGreaterThan(0);
    const c = stub.map.getCenter();
    for (const q of w.allOf('resolveBrush'))
      w.emit({
        type: 'brushLots',
        reqId: q.reqId,
        result: { ok: true, lots: ['P0', 'FAR'], points: Float64Array.from([c.lng, c.lat, 0, 0]) }
      });
    await expect.poll(() => w.allOf('setLevers').length, { timeout: 2000 }).toBe(1);
    return w;
  }

  it('a saved rule shows its lots in view once its revision is current, at the levers', async () => {
    stub.reset();
    await page.viewport(1024, 768);
    await setup();
    await toReady();
    const w = await saveRule();
    const rev = w.lastOf('setLevers')!.rev;
    await wait(50);
    expect(w.allOf('previewBuildings')).toHaveLength(0); // not before its current
    leversCurrent(rev);
    await expect.poll(() => w.allOf('previewBuildings').length).toBe(1);
    const req = w.lastOf('previewBuildings')!;
    expect(req.lots).toEqual(['P0']);
    expect(req).not.toHaveProperty('stories');
    leversCurrent(rev + 1); // fires once
    await wait(50);
    expect(w.allOf('previewBuildings')).toHaveLength(1);
  });

  it('an edit that changes nothing arms nothing', async () => {
    stub.reset();
    await page.viewport(1024, 768);
    await setup();
    await toReady();
    const w = await saveRule();
    leversCurrent(w.lastOf('setLevers')!.rev);
    await expect.poll(() => w.allOf('previewBuildings').length).toBe(1);
    await page.getByRole('button', { name: /^Edit:/ }).click();
    await page.getByRole('button', { name: 'Save rule' }).click();
    await expect.element(page.getByRole('button', { name: 'Save rule' })).not.toBeInTheDocument();
    await wait(400); // past the debounce: nothing changed, nothing is sent
    expect(w.allOf('setLevers')).toHaveLength(1);
    leversCurrent(w.lastOf('setLevers')!.rev + 1); // a later revision for another reason
    await wait(50);
    expect(w.allOf('previewBuildings')).toHaveLength(1);
  });
});
