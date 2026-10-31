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
import type { ComponentProps } from 'svelte';
import { copyFor } from '$lib/sharing/copy';
import { MemoryStorage } from '$lib/sharing/fixtures/memory-storage';
import { replaceStateCalls } from '../../test-stubs/app/navigation';
import type SimPage from './SimPage.svelte';
import { DEFAULT_POLICY, SIM_CODEC, SIM_KEY, type SimDoc } from './sim-doc';
import { resolvePreset } from './timing';

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

describe('SimPage protections (Task 10)', () => {
  it('at 375 px, "Protect lots with the brush" closes the sheet for the tool bar on Protect', async () => {
    stub.reset();
    await page.viewport(375, 700);
    await setup();
    await toReady();
    await page.getByRole('button', { name: 'Menu' }).click();
    await policyButton().click();
    const dialog = page.getByRole('dialog', { name: 'Policy' });
    await expect.element(dialog).toBeVisible();
    await page.getByRole('button', { name: 'Protections' }).click();
    const protect = page.getByRole('button', { name: 'Protect lots with the brush' });
    await expect.element(protect).toBeEnabled();
    await protect.click();
    await expect.element(dialog).not.toBeInTheDocument();
    const bar = page.getByRole('group', { name: 'Brush' });
    await expect.element(bar).toBeVisible();
    await expect.element(bar.getByRole('button').first()).toHaveFocus();
  });

  it('a category checkbox is a change that Undo names', async () => {
    stub.reset();
    await page.viewport(1024, 768);
    await setup();
    await toReady();
    await page.getByRole('button', { name: 'Protections' }).click();
    await page.getByRole('checkbox', { name: 'Historic buildings (status A or A*)' }).click();
    await yourZoning().click();
    await expect
      .element(page.getByRole('button', { name: 'Undo: Protected historic buildings' }))
      .toBeEnabled();
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

describe('SimPage autosave, restore and publish (plan 5, Task 5)', () => {
  const SD = "Permits at San Diego's pace";
  const sim = copyFor('sim');
  const timingToggle = () => page.getByRole('button', { name: /^Permitting timelines/ });
  const presetPicker = () => page.getByRole('combobox', { name: 'Preset' });
  const timingLabel = () => page.getByTestId('timing-label');
  const notices = () => page.getByTestId('fzp-notices');
  const publish = () => page.getByTestId('publish-open');

  const docWith = (current = resolvePreset('benchmarkPermits', calibration)): SimDoc => ({
    schema: 1,
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
    await expect
      .element(timingToggle())
      .toHaveAccessibleName(`Permitting timelines, Custom (from ${SD})`);
    await timingToggle().click();
    await expect.element(timingLabel()).toHaveTextContent(`Custom (from ${SD})`);
    await expect.element(page.getByRole('button', { name: 'Revert to saved' })).toBeVisible();
  });

  it('a reload shows no timing notice', async () => {
    await page.viewport(1024, 768);
    await setup({ storage: () => seeded() });
    await toReady();
    await expect.element(notices()).toBeInTheDocument();
    await expect.element(timingToggle()).toHaveAccessibleName(`Permitting timelines, ${SD}`);
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
    await expect
      .element(timingToggle())
      .toHaveAccessibleName('Permitting timelines, SF as observed');
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

  for (const [kind, raw] of [
    ['a corrupt', '{nope'],
    [
      'a future-schema',
      JSON.stringify({
        v: 1,
        savedAt: 'x',
        plan: JSON.stringify({ schema: 2, kind: 'sim', datasetVersion: 'fixture-0', policy: {} })
      })
    ]
  ] as const) {
    it(`deferred start keeps ${kind} record under the corrupt key on the first change`, async () => {
      await page.viewport(1024, 768);
      const mem = new MemoryStorage();
      mem.setItem(SIM_KEY, raw);
      await setup({ storage: () => mem, start: 'fzp', persist: 'deferred' });
      await timingToggle().click();
      await presetPicker().selectOptions('No discretionary review');
      await expect
        .poll(() => mem.getItem(SIM_KEY) !== raw && storedDoc(mem).policy.timing.current.preset, {
          timeout: 2000
        })
        .toBe('noDiscretionary');
      const kept = mem.keys().filter((k) => k.startsWith('sfhousing:sim:corrupt:'));
      expect(kept.map((k) => mem.getItem(k))).toEqual([raw]);
    });
  }

  it('deferred start keeps the saved policy', async () => {
    await page.viewport(1024, 768);
    const mem = seeded();
    const before = mem.getItem(SIM_KEY);
    await setup({ storage: () => mem, start: 'fzp', persist: 'deferred' });
    await toReady();
    await expect
      .element(
        notices().getByText(
          'Showing the Family Zoning Plan comparison. Your saved policy is kept until you change something here.'
        )
      )
      .toBeVisible();
    await expect
      .element(notices().getByRole('link', { name: 'Open your policy' }))
      .toHaveAttribute('href', '/sim');
    // Nothing is restored or written on mount.
    await expect
      .element(timingToggle())
      .toHaveAccessibleName('Permitting timelines, SF as observed');
    await new Promise((r) => setTimeout(r, 700));
    expect(mem.getItem(SIM_KEY)).toBe(before);
    // The first change starts autosaving, over the saved policy.
    await timingToggle().click();
    await presetPicker().selectOptions('No discretionary review');
    await expect
      .poll(() => storedDoc(mem).policy.timing.current.preset, { timeout: 2000 })
      .toBe('noDiscretionary');
    await expect
      .element(notices().getByRole('link', { name: 'Open your policy' }))
      .not.toBeInTheDocument();
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
    await expect.element(timingToggle()).toHaveAccessibleName(`Permitting timelines, ${SD}`);
    await yourZoning().click();
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
    await expect.element(timingToggle()).toHaveAccessibleName(`Permitting timelines, ${SD}`);
    expect(replaceStateCalls).toEqual([{ url: '', state: {} }]);
    expect(storedDoc(mem).title).toBe('SD permits');
  });

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
