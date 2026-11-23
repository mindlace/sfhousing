// `/`'s BrushEditor on the dock (sim-ux plan 5, Task 3): the shared Paint tab without `/sim`'s
// painted-areas list, the read-only line and summary, the stroke chip, the phone palette strip
// and one notice stack. A stub SimMap hands over a fake MapLibre map, so a real BrushController
// attaches (a separate file: vi.mock is file-wide, and BrushEditor.svelte.spec.ts relies on the
// real SimMap's fallback).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import { createRawSnippet, flushSync } from 'svelte';
import '../../routes/layout.css';
import type { Manifest } from '$lib/data/manifest';
import { DockState } from '$lib/dock/dock-state.svelte';
import { callsOf, stub } from '$lib/fzp/test/sim-map-stub';
import { OUTLINE_LAYER_ID } from '$lib/paint/outline-layers';
import { stubPointer, stubTouchLaptop } from '$lib/paint/test/pointer-stub';
import { OPS_MAX, emptyPlan, type Plan, type PlanOp } from '$lib/plan';
import { CHIP } from '$lib/shell/ui';
import type { GeneratedUpdate } from '$lib/map/types';
import type { Score } from '$lib/scoreboard';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import BrushEditorHost from './test/BrushEditorHost.svelte';
import type { Editor } from './editor.svelte';
import { ANNOUNCE_MS, MSG, TOO_LARGE_MS } from './messages';
import { FakeEditorWorker } from './test/fake-editor-worker';

vi.mock('$lib/map/SimMap.svelte', () => import('$lib/fzp/test/FzpSimMapStub.svelte'));

const manifest = manifestJson as unknown as Manifest;
const DOCK_ID = 'paint-dock';

const op = (id: string, stories: number | null): PlanOp =>
  stories === null
    ? { id, kind: 'erase', radiusM: 20, path: [[-122.42, 37.76]] }
    : { id, kind: 'paint', stories, radiusM: 20, path: [[-122.42, 37.76]] };
const planOf = (...ops: PlanOp[]): Plan => ({ ...emptyPlan('fixture-0'), ops });

interface Opts {
  width?: number;
  height?: number;
  readOnly?: boolean;
  plan?: Plan;
  notices?: ReturnType<typeof createRawSnippet>;
  /** The page's layer rows (the Layers panel's content). */
  layers?: ReturnType<typeof createRawSnippet>;
}

async function setup(opts: Opts = {}) {
  const width = opts.width ?? 1024;
  await page.viewport(width, opts.height ?? (width < 768 ? 700 : 768));
  const workers: FakeEditorWorker[] = [];
  const editors: Editor[] = [];
  const dock = new DockState({ tab: 'paint' });
  const screen = render(BrushEditorHost, {
    props: {
      manifest,
      manifestError: false,
      plan: opts.plan ?? emptyPlan('fixture-0'),
      currentVersion: 'fixture-0',
      readOnly: opts.readOnly,
      reloadManifest: async () => manifest,
      oneditor: (e: Editor) => void editors.push(e),
      createWorker: () => {
        const w = new FakeEditorWorker();
        workers.push(w);
        return w;
      },
      dock,
      dockId: DOCK_ID,
      notices: opts.notices,
      layers: opts.layers
    }
  });
  await expect.poll(() => workers.length).toBe(1);
  return { w: workers[0], workers, editor: () => editors[0], dock, screen };
}

/** The worker is ready and the controller listens on the map. */
async function ready(w: FakeEditorWorker) {
  w.ready();
  await expect.poll(() => stub.map.listenerCount('moveend')).toBeGreaterThan(0);
}

const ev = (type: string, x: number) =>
  stub.map.getCanvas().dispatchEvent(
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
/** Pointer down and moves to `to`: a stroke still in progress. */
function drag(from: number, to: number): void {
  ev('pointerdown', from);
  for (let x = from + 10; x <= to; x += 10) ev('pointermove', x);
}
function stroke(): void {
  drag(10, 60);
  ev('pointerup', 60);
}

/** DOM click: the stub map sits under nothing, but the dock's buttons may be off screen. */
const click = (el: Element | null) => (el as HTMLElement).click();
/** The polite status over the map that carries the brush's announcements, and its chip. */
const announcement = () => page.getByTestId('brush-announcement');
const chip = () => page.getByTestId('stroke-chip');
/** The map box: the stub map's parent, the region the chip overlays. */
const mapBox = () =>
  document.querySelector<HTMLElement>('[data-testid="fzp-sim-map-stub"]')!.parentElement!;

/** Paints one stroke and answers its commit with stats: 6 stories on 3 lots. */
async function commitStroke(w: FakeEditorWorker, editor: () => Editor): Promise<void> {
  const n = w.allOf('commit').length;
  stroke();
  await expect.poll(() => w.allOf('commit').length).toBe(n + 1);
  const c = w.lastOf('commit')!;
  w.emit({
    type: 'diff',
    rev: c.rev,
    phase: 'commit',
    render: { revision: 1 } as GeneratedUpdate,
    complete: true,
    score: { total: 1 } as unknown as Score,
    stats: {
      opId: editor().plan.ops.at(-1)!.id,
      kind: 'paint',
      stories: 6,
      covered: 3,
      ineligible: 0,
      underwater: 0,
      built: 3,
      notBigger: 0,
      removed: 0,
      partial: false
    }
  });
}
/** A worker diff carrying only a score's `parcelsChanged` (the lots the plan rebuilds). */
const scoreDiff = (rev: number, phase: 'load' | 'chunk' | 'commit', parcelsChanged: number) =>
  ({
    type: 'diff',
    rev,
    phase,
    render: { revision: rev } as GeneratedUpdate,
    complete: true,
    score: { parcelsChanged } as unknown as Score
  }) as const;
const overlayIds = () =>
  ((callsOf('setOverlayLayers').at(-1)?.[0] ?? []) as { id: string }[]).map((l) => l.id);
const key = (k: string, shift = false) =>
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, ctrlKey: true, shiftKey: shift, bubbles: true })
  );

beforeEach(() => {
  stub.reset();
  stub.map.zoom = 18;
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('BrushEditor on the dock', () => {
  it('renders the dock with the Paint tab: tools, height, size and no rows on an empty plan', async () => {
    await setup();
    const dock = page.getByRole('region', { name: 'Paint', exact: true });
    await expect.element(dock).toBeInTheDocument();
    expect(dock.element().id).toBe(DOCK_ID);
    expect(document.querySelector('.brush-editor')!.classList.contains('sfh-dock-host')).toBe(true);
    await expect
      .element(page.getByRole('tablist', { name: 'Paint' }).getByRole('tab', { name: 'Paint' }))
      .toHaveAttribute('aria-selected', 'true');
    const tools = page.getByRole('radiogroup', { name: 'Tool' });
    expect(
      tools
        .getByRole('radio')
        .elements()
        .map((r) => r.textContent?.trim())
    ).toEqual(['Move', 'Paint', 'Erase']);
    await expect.element(page.getByRole('group', { name: 'Height' })).toBeVisible();
    await expect.element(page.getByRole('slider', { name: 'Brush size' })).toBeVisible();
    expect(page.getByRole('button', { name: /^(Undo|Redo)/ }).elements()).toEqual([]);
    expect(page.getByRole('list', { name: 'Painted areas' }).elements()).toEqual([]);
    expect(
      getComputedStyle(document.querySelector('.brush-editor')!).getPropertyValue('--dock-w')
    ).toBe('320px');
  });

  it('`/` has no painted-areas list: strokes at two heights leave no rows and draw no outline', async () => {
    const { w, editor } = await setup();
    await ready(w);
    click(page.getByRole('radio', { name: 'Paint' }).element());
    stroke();
    click(page.getByRole('button', { name: '8 stories', exact: true }).element());
    stroke();
    await expect.poll(() => w.allOf('commit').length).toBe(2);
    expect(editor().plan.ops.map((o) => o.kind === 'paint' && o.stories)).toEqual([6, 8]);
    expect(page.getByRole('list', { name: 'Painted areas' }).elements()).toEqual([]);
    expect(document.querySelector('[data-paint-row]')).toBeNull();
    expect(page.getByRole('button', { name: /^Remove/ }).elements()).toEqual([]);
    expect(w.allOf('heightLots').every((r) => r.outlineOf === null)).toBe(true);
    expect(overlayIds()).not.toContain(OUTLINE_LAYER_ID);
  });

  it("the status line and Retry are pills in the notice stack, together with the page's `notices` snippet in one `fzp-notices`", async () => {
    const notices = createRawSnippet(() => ({
      render: () => `<p class="${CHIP}" data-testid="page-notice">Page notice</p>`
    }));
    const { w } = await setup({ notices });
    const stacks = () => document.querySelectorAll('[data-testid="fzp-notices"]');
    await expect.poll(() => stacks().length).toBe(1);
    const stack = stacks()[0];
    const status = page.getByTestId('brush-status');
    await expect.element(status).toHaveTextContent(MSG.loadingCity);
    expect(status.element().getAttribute('role')).toBe('status');
    expect(stack.contains(status.element())).toBe(true);
    const pill = page
      .getByText(MSG.loadingCity, { exact: true })
      .element()
      .closest('.rounded-full');
    expect(pill).not.toBeNull();
    expect(stack.contains(page.getByTestId('page-notice').element())).toBe(true);

    vi.spyOn(console, 'error').mockImplementation(() => {});
    w.emit({ type: 'error', rev: 1, code: 'manifest-invalid', message: 'bad' });
    await expect.element(status).toHaveTextContent(MSG.cityFailed);
    const retry = page.getByRole('button', { name: 'Retry', exact: true });
    await expect.element(retry).toBeVisible();
    expect(stack.contains(retry.element())).toBe(true);
    expect(stacks()).toHaveLength(1);
  });

  for (const [width, height] of [
    [375, 812],
    [1280, 800]
  ]) {
    it(`at ${width}px a stroke's result shows as a chip over the map, and the map box keeps its height`, async () => {
      const { w, editor } = await setup({ width, height });
      await ready(w);
      // Nothing visible in the stack once the worker is ready.
      await expect.element(page.getByTestId('brush-status')).toHaveTextContent('');
      const region = announcement().element();
      // The polite region is there, empty and boxless, before any text comes.
      expect(region.getAttribute('role')).toBe('status');
      expect(region.getAttribute('aria-live')).toBe('polite');
      expect(region.textContent?.trim()).toBe('');
      expect(region.getBoundingClientRect().height).toBe(0);
      const before = mapBox().getBoundingClientRect().height;
      expect(before).toBeGreaterThan(0);

      await commitStroke(w, editor);
      await expect.element(chip()).toBeVisible();
      await expect.element(chip()).toHaveTextContent('6 stories on 3 lots');
      expect(region.contains(chip().element())).toBe(true);
      expect(mapBox().contains(region)).toBe(true);
      // A frame for layout, then the map box has not moved or resized.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      expect(mapBox().getBoundingClientRect().height).toBe(before);
      const box = mapBox().getBoundingClientRect();
      const c = chip().element().getBoundingClientRect();
      expect(c.top).toBeGreaterThanOrEqual(box.top);
      expect(c.bottom).toBeLessThanOrEqual(box.bottom);
      expect(c.left).toBeGreaterThanOrEqual(box.left);
      expect(c.right).toBeLessThanOrEqual(box.right);
      expect(getComputedStyle(chip().element()).pointerEvents).toBe('none');
      expect(getComputedStyle(region).pointerEvents).toBe('none');
      // A press at the chip's centre reaches what is under it: a stroke can start there.
      const hit = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
      expect(region.contains(hit)).toBe(false);
      expect(mapBox().contains(hit)).toBe(true);
      // The chip is marked a notice, and the visible status line stays empty.
      expect(region.hasAttribute('data-notice')).toBe(true);
      await expect.element(page.getByTestId('brush-status')).toHaveTextContent('');
    });
  }

  it('the chip clears after 4 s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { w, editor } = await setup();
      await ready(w);
      await commitStroke(w, editor);
      await expect.element(chip()).toHaveTextContent('6 stories on 3 lots');
      vi.advanceTimersByTime(ANNOUNCE_MS - 1);
      flushSync();
      expect(chip().query()).not.toBeNull();
      vi.advanceTimersByTime(1);
      flushSync();
      expect(chip().query()).toBeNull();
      // The region stays mounted (empty), ready for the next message.
      expect(announcement().query()).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the chip sits below map-view's failure column (--map-chips-bottom) and the notices", async () => {
    const { w } = await setup();
    await ready(w);
    const region = announcement().element();
    const host = document.querySelector<HTMLElement>('.brush-editor')!;
    const top = () => parseFloat(getComputedStyle(region).top);
    const root = document.documentElement.style;
    try {
      host.style.setProperty('--notice-pills-bottom', '30px');
      await expect.poll(top).toBe(38);
      // SimMap publishes the failure column's bottom: the chip goes 8 px under it.
      root.setProperty('--map-chips-bottom', '120px');
      await expect.poll(top).toBe(128);
      // Whichever is lower wins.
      host.style.setProperty('--notice-pills-bottom', '200px');
      await expect.poll(top).toBe(208);
      root.setProperty('--map-chips-bottom', '0px');
      host.style.setProperty('--notice-pills-bottom', '0px');
      await expect.poll(top).toBe(8);
    } finally {
      root.removeProperty('--map-chips-bottom');
    }
  });

  it('a refused stroke shows the refusal in the chip, for 6 s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const ops = Array.from({ length: OPS_MAX }, (_, i) => op(`o${i}`, null));
      const { w, editor } = await setup({ plan: planOf(...ops) });
      await ready(w);
      click(page.getByRole('radio', { name: 'Paint' }).element());
      stroke();
      await expect.element(chip()).toHaveTextContent(MSG.tooLarge);
      expect(editor().plan.ops).toHaveLength(OPS_MAX);
      expect(w.allOf('commit')).toEqual([]);
      vi.advanceTimersByTime(TOO_LARGE_MS - 1);
      flushSync();
      expect(chip().query()).not.toBeNull();
      vi.advanceTimersByTime(1);
      flushSync();
      expect(chip().query()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Ctrl+Z shows what it undid', async () => {
    const { w, editor } = await setup();
    await ready(w);
    await commitStroke(w, editor);
    await expect.element(chip()).toHaveTextContent('6 stories on 3 lots');
    key('z');
    await expect.element(chip()).toHaveTextContent('Undid paint, 6 stories');
    expect(editor().plan.ops).toHaveLength(0);
    key('z', true);
    await expect.element(chip()).toHaveTextContent('Redid paint, 6 stories');
    expect(editor().plan.ops).toHaveLength(1);
  });

  it('an empty plan shows the starting sentence until the first stroke, and again after Ctrl+Z', async () => {
    const { w, editor } = await setup();
    await ready(w);
    const start = page.getByText(MSG.start, { exact: true });
    await expect.element(start).toBeVisible();
    await commitStroke(w, editor);
    await expect.element(start).not.toBeInTheDocument();
    key('z');
    await expect.element(start).toBeVisible();
  });

  it('a loaded plan with strokes shows no starting sentence', async () => {
    const { w } = await setup({ plan: planOf(op('a', 8)) });
    await ready(w);
    await expect.element(page.getByRole('radiogroup', { name: 'Tool' })).toBeVisible();
    expect(page.getByText(MSG.start, { exact: true }).elements()).toEqual([]);
  });

  it('on a fine pointer the dock has no Undo or Redo; Ctrl+Z undoes and the chip says so', async () => {
    const { w, editor } = await setup();
    await ready(w);
    expect(page.getByRole('button', { name: /^(Undo|Redo)/ }).elements()).toEqual([]);
    await commitStroke(w, editor);
    key('z');
    await expect.element(chip()).toHaveTextContent('Undid paint, 6 stories');
    expect(editor().plan.ops).toHaveLength(0);
    key('z', true);
    await expect.element(chip()).toHaveTextContent('Redid paint, 6 stories');
  });

  for (const width of [375, 1024]) {
    it(`on a coarse pointer at ${width}px Undo and Redo sit above the Paint tab, and no Shortcuts`, async () => {
      stubPointer('coarse');
      const { w, editor, dock } = await setup({ width });
      await ready(w);
      if (width < 768) dock.sheet = 'full';
      const undo = page.getByRole('button', { name: 'Undo', exact: true });
      const redo = page.getByRole('button', { name: 'Redo', exact: true });
      await expect.element(undo).toBeDisabled();
      await expect.element(redo).toBeDisabled();
      const panel = page.getByRole('tabpanel').element();
      expect(undo.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(
        panel.getBoundingClientRect().top + 1
      );
      expect(page.getByRole('button', { name: 'Keyboard shortcuts' }).elements()).toEqual([]);
      // A coarse pointer starts on Move; on a phone choosing Paint folds the sheet.
      await page.getByRole('radio', { name: 'Paint' }).click();
      dock.sheet = 'full';
      await commitStroke(w, editor);
      await expect.element(undo).toBeEnabled();
      await undo.click();
      await expect.element(chip()).toHaveTextContent('Undid paint, 6 stories');
      await expect.element(redo).toBeEnabled();
      await redo.click();
      await expect.element(chip()).toHaveTextContent('Redid paint, 6 stories');
    });
  }

  it('a touch laptop gets Undo and Redo above the tab and keeps Shortcuts; a change event swaps them in and out', async () => {
    const pointer = stubTouchLaptop();
    await setup();
    const undo = page.getByRole('button', { name: 'Undo', exact: true });
    const redo = page.getByRole('button', { name: 'Redo', exact: true });
    const shortcuts = page.getByRole('button', { name: 'Keyboard shortcuts' });
    await expect.element(undo).toBeVisible();
    await expect.element(redo).toBeVisible();
    await expect.element(shortcuts).toBeVisible();
    const panel = page.getByRole('tabpanel').element();
    expect(undo.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(
      panel.getBoundingClientRect().top + 1
    );
    // The touch screen goes (a keyboard docked without one): the buttons go, Shortcuts stays.
    pointer.setAny(['fine']);
    await expect.element(undo).not.toBeInTheDocument();
    await expect.element(redo).not.toBeInTheDocument();
    await expect.element(shortcuts).toBeVisible();
    pointer.setAny(['fine', 'coarse']);
    await expect.element(undo).toBeVisible();
    await expect.element(shortcuts).toBeVisible();
  });

  it('the Undo row and the Shortcuts button swap when the primary pointer changes', async () => {
    const pointer = stubPointer('fine');
    await setup();
    const undo = page.getByRole('button', { name: 'Undo', exact: true });
    const shortcuts = page.getByRole('button', { name: 'Keyboard shortcuts' });
    await expect.element(shortcuts).toBeVisible();
    expect(undo.elements()).toEqual([]);
    pointer.set('coarse');
    await expect.element(undo).toBeVisible();
    await expect.element(shortcuts).not.toBeInTheDocument();
    pointer.set('fine');
    await expect.element(shortcuts).toBeVisible();
    await expect.element(undo).not.toBeInTheDocument();
  });

  describe('Ctrl+Z from where focus is', () => {
    const keyOn = (el: EventTarget) =>
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    const painted = () => setup({ plan: planOf(op('a', 8)) });

    it('undoes with focus in the dock', async () => {
      const { w, editor } = await painted();
      await ready(w);
      const radio = page.getByRole('radio', { name: 'Paint' }).element() as HTMLElement;
      radio.focus();
      keyOn(radio);
      await expect.element(chip()).toHaveTextContent('Undid paint, 8 stories');
      expect(editor().plan.ops).toHaveLength(0);
    });

    it('does nothing with focus in a text field', async () => {
      const { w, editor } = await painted();
      await ready(w);
      const input = document.body.appendChild(document.createElement('input'));
      try {
        input.focus();
        keyOn(input);
        expect(editor().plan.ops).toHaveLength(1);
        expect(chip().query()).toBeNull();
      } finally {
        input.remove();
      }
    });

    it('does nothing while a modal dialog is open', async () => {
      const { w, editor } = await painted();
      await ready(w);
      const dlg = document.body.appendChild(document.createElement('dialog'));
      const btn = dlg.appendChild(document.createElement('button'));
      dlg.showModal();
      try {
        btn.focus();
        keyOn(btn);
        expect(editor().plan.ops).toHaveLength(1);
        dlg.close();
        keyOn(document.body);
        await expect.element(chip()).toHaveTextContent('Undid paint, 8 stories');
      } finally {
        dlg.remove();
      }
    });
  });

  it('below md the strip carries Undo, which undoes the last stroke', async () => {
    const { w, editor } = await setup({ width: 375 });
    await ready(w);
    const strip = page.getByTestId('palette-strip');
    await expect.element(strip).toBeVisible();
    const undo = strip.getByRole('button', { name: 'Undo', exact: true });
    await expect.element(undo).toBeDisabled();
    await commitStroke(w, editor);
    await expect.element(undo).toBeEnabled();
    await undo.click();
    expect(editor().plan.ops).toHaveLength(0);
    await expect.element(chip()).toHaveTextContent('Undid paint, 6 stories');
    await expect.element(undo).toBeDisabled();
  });

  it('on a fine pointer Keyboard shortcuts is the last control in the Paint tab; read-only, none', async () => {
    await setup();
    const tab = page.getByRole('tabpanel').element();
    const controls = [...tab.querySelectorAll<HTMLElement>('button, [role=radio], [role=slider]')];
    expect(controls.at(-1)?.textContent).toContain('Keyboard shortcuts');
    expect(page.getByRole('button', { name: 'Keyboard shortcuts' }).elements()).toHaveLength(1);
  });

  it('read-only has no Keyboard shortcuts', async () => {
    await setup({ readOnly: true, plan: planOf(op('a', 8)) });
    expect(page.getByRole('button', { name: 'Keyboard shortcuts' }).elements()).toEqual([]);
  });

  it('below md a stroke tool shows the palette strip; Done reopens the sheet on Paint', async () => {
    const { w, dock } = await setup({ width: 375 });
    await ready(w);
    const handle = page.getByTestId('dock-handle');
    await expect.element(handle).toHaveAttribute('aria-expanded', 'false');
    // The tool starts as the pointer's default; Move first, so Erase is a change.
    await handle.click();
    await expect.element(handle).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('radio', { name: 'Move' }).click();
    await expect.element(handle).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('radio', { name: 'Erase' }).click();
    await expect.element(handle).toHaveAttribute('aria-expanded', 'false');
    const strip = page.getByTestId('palette-strip');
    await expect.element(strip).toBeVisible();
    await expect.element(strip.getByRole('button', { name: 'Tool: Erase' })).toBeVisible();

    await strip.getByRole('button', { name: 'Done' }).click();
    await expect.element(handle).toHaveAttribute('aria-expanded', 'true');
    expect(dock.sheet).toBe('full');
    await expect
      .element(page.getByRole('tab', { name: 'Paint' }))
      .toHaveAttribute('aria-selected', 'true');
    await expect
      .element(page.getByRole('radio', { name: 'Move' }))
      .toHaveAttribute('aria-checked', 'true');
    await expect.element(strip).not.toBeInTheDocument();
    await expect.poll(() => document.activeElement?.getAttribute('role')).toBe('tab');
  });

  it('showing the palette strip calls collapseCredit', async () => {
    const { w } = await setup({ width: 375 });
    await ready(w);
    const strip = page.getByTestId('palette-strip');
    // Showing when the map hands over its handle: collapsed then.
    await expect.element(strip).toBeVisible();
    await expect.poll(() => callsOf('collapseCredit').length).toBeGreaterThan(0);
    // Hidden (Done reopens the sheet): no call. Shown again: once more.
    await strip.getByRole('button', { name: 'Done' }).click();
    await expect.element(strip).not.toBeInTheDocument();
    const n = callsOf('collapseCredit').length;
    const handle = page.getByTestId('dock-handle');
    await page.getByRole('radio', { name: 'Erase' }).click();
    await expect.element(handle).toHaveAttribute('aria-expanded', 'false');
    await expect.element(strip).toBeVisible();
    await expect.poll(() => callsOf('collapseCredit').length).toBe(n + 1);
  });

  it('read-only: the read-only line and the summary, no tools; the count follows the score', async () => {
    const plan = planOf(op('a', 8), op('b', null), op('c', 6));
    const { w, editor } = await setup({ readOnly: true, plan });
    await ready(w);
    const tab = page.getByRole('tabpanel');
    await expect.element(tab.getByText(MSG.readOnly, { exact: true })).toBeVisible();
    const scored = (rev: number, phase: 'load' | 'chunk', n: number) =>
      w.emit(scoreDiff(rev, phase, n));
    scored(w.lastOf('load')!.rev, 'load', 2);
    await expect
      .element(tab.getByText('6 and 8 stories · 2 lots rebuilt', { exact: true }))
      .toBeVisible();
    scored(w.lastOf('load')!.rev, 'chunk', 4);
    await expect
      .element(tab.getByText('6 and 8 stories · 4 lots rebuilt', { exact: true }))
      .toBeVisible();
    expect(page.getByRole('radiogroup', { name: 'Tool' }).elements()).toEqual([]);
    expect(page.getByRole('button', { name: /^Undo/ }).elements()).toEqual([]);
    expect(document.querySelector('[data-paint-row]')).toBeNull();
    expect(w.allOf('heightLots').every((r) => r.outlineOf === null)).toBe(true);

    const before = w.posts.length;
    key('z');
    key('z', true);
    expect(w.posts.slice(before)).toEqual([]);
    expect(editor().plan).toBe(plan);
    await expect
      .element(tab.getByText('6 and 8 stories · 4 lots rebuilt', { exact: true }))
      .toBeVisible();
  });

  it("a read-only load has no count until its diff, never 0 or the previous plan's", async () => {
    const { w, editor } = await setup({ readOnly: true, plan: planOf(op('a', 8)) });
    await ready(w);
    const tab = page.getByRole('tabpanel');
    w.emit(scoreDiff(w.lastOf('load')!.rev, 'load', 4));
    await expect
      .element(tab.getByText('8 stories · 4 lots rebuilt', { exact: true }))
      .toBeVisible();
    editor().load(planOf(op('b', 3)), { readOnly: true });
    // Before the new plan's diff: its heights alone, with no count.
    await expect.element(tab.getByText('3 stories', { exact: true })).toBeVisible();
    w.emit(scoreDiff(w.lastOf('load')!.rev, 'load', 1));
    await expect.element(tab.getByText('3 stories · 1 lot rebuilt', { exact: true })).toBeVisible();
  });

  it("an editable session's scores never reach the read-only line", async () => {
    const { w, editor } = await setup();
    await ready(w);
    await commitStroke(w, editor);
    w.emit(scoreDiff(w.lastOf('commit')!.rev, 'commit', 9));
    // Read-only only through a load: the line counts from that load's diffs alone.
    editor().load(planOf(op('a', 6)), { readOnly: true });
    const tab = page.getByRole('tabpanel');
    await expect.element(tab.getByText('6 stories', { exact: true })).toBeVisible();
  });
});

/** One square lot ring, about 10 m a side, for an outline answer. */
const LOT_OUTLINE = {
  lots: ['l1'],
  ringLot: new Uint32Array([0]),
  starts: new Uint32Array([0, 5]),
  positions: new Float64Array([
    -122.42, 37.76, -122.4199, 37.76, -122.4199, 37.7601, -122.42, 37.7601, -122.42, 37.76
  ])
};
const keyToggle = () => page.getByRole('button', { name: 'Map key' });
const heightRows = () =>
  [
    ...document.querySelectorAll<HTMLButtonElement>('[data-testid="map-key-panel"] [data-height]')
  ].map((b) => b.textContent!.trim());

describe("BrushEditor's map key", () => {
  it("the map key's Painted rows follow the plan: two heights, then Ctrl+Z, then one", async () => {
    const { w, editor } = await setup();
    await ready(w);
    await expect.element(keyToggle()).toHaveAttribute('aria-expanded', 'false');
    click(keyToggle().element());
    const panel = page.getByRole('group', { name: 'Map key' });
    await expect.element(panel.getByRole('list', { name: 'New buildings' })).toBeVisible();
    expect(panel.getByRole('list', { name: 'Painted' }).elements()).toEqual([]);
    click(page.getByRole('radio', { name: 'Paint' }).element());
    stroke();
    click(page.getByRole('button', { name: '8 stories', exact: true }).element());
    stroke();
    await expect.poll(() => w.allOf('commit').length).toBe(2);
    await expect.poll(heightRows).toEqual(['6 stories · …', '8 stories · …']);
    await expect.poll(() => w.allOf('heightLots').length).toBe(2);
    w.heightLots({
      heights: [
        { stories: 6, lots: 4, rebuilt: 3 },
        { stories: 8, lots: 2, rebuilt: 2 }
      ],
      missing: 0,
      outline: null
    });
    await expect
      .poll(heightRows)
      .toEqual(['6 stories · 4 lots · 3 rebuilt', '8 stories · 2 lots · 2 rebuilt']);
    key('z');
    expect(editor().plan.ops).toHaveLength(1);
    await expect.poll(heightRows).toEqual(['6 stories · 4 lots · 3 rebuilt']);
    // The undo asks again; its answer replaces the counts.
    await expect.poll(() => w.allOf('heightLots').length).toBe(3);
    w.heightLots({ heights: [{ stories: 6, lots: 5, rebuilt: 3 }], missing: 0, outline: null });
    await expect.poll(heightRows).toEqual(['6 stories · 5 lots · 3 rebuilt']);
  });

  it('focusing a height puts its outline in the outline slot; Ctrl+Z removing that height clears it', async () => {
    const { w, editor } = await setup({ plan: planOf(op('a', 6)) });
    await ready(w);
    await expect.poll(() => w.allOf('heightLots').length).toBe(1);
    click(page.getByRole('radio', { name: 'Paint' }).element());
    click(page.getByRole('button', { name: '8 stories', exact: true }).element());
    stroke();
    await expect.poll(() => editor().plan.ops).toHaveLength(2);
    click(keyToggle().element());
    await expect.poll(heightRows).toHaveLength(2);
    // The toolbar comes before the panel: from the toggle, Tab reaches the panel, then its rows,
    // the 8-story row last.
    (keyToggle().element() as HTMLElement).focus();
    await userEvent.keyboard('{Tab}{Tab}{Tab}');
    expect((document.activeElement as HTMLElement).dataset.height).toBe('8');
    await expect.poll(() => w.lastOf('heightLots')!.outlineOf).toBe(8);
    w.heightLots({
      heights: [
        { stories: 6, lots: 1, rebuilt: 1 },
        { stories: 8, lots: 1, rebuilt: 1 }
      ],
      missing: 0,
      outline: LOT_OUTLINE
    });
    await expect.poll(overlayIds).toContain(OUTLINE_LAYER_ID);
    // The outline sits under the brush ring.
    const ids = overlayIds();
    expect(ids.indexOf(OUTLINE_LAYER_ID)).toBe(0);
    key('z');
    await expect.poll(overlayIds).not.toContain(OUTLINE_LAYER_ID);
    expect(heightRows()).toHaveLength(1);
  });

  it('a restored plan asks heightLots once, and again on a chunk while cells are missing', async () => {
    const { w } = await setup({ plan: planOf(op('a', 6), op('b', 9)) });
    expect(w.allOf('heightLots')).toEqual([]); // not before the worker is ready
    await ready(w);
    await expect.poll(() => w.allOf('heightLots').length).toBe(1);
    expect(w.types().indexOf('load')).toBeLessThan(w.types().indexOf('heightLots'));
    w.emit(scoreDiff(w.lastOf('load')!.rev, 'load', 1));
    expect(w.allOf('heightLots')).toHaveLength(1);
    w.heightLots({ heights: [{ stories: 6, lots: 3, rebuilt: 3 }], missing: 2, outline: null });
    click(keyToggle().element());
    await expect.poll(heightRows).toEqual(['6 stories · 3+ lots · 3+ rebuilt', '9 stories · …']);
    w.emit({ type: 'chunks', status: { '0_0': 'ready' }, pending: 1, failed: [] });
    expect(w.allOf('heightLots')).toHaveLength(2);
    w.heightLots({
      heights: [
        { stories: 6, lots: 5, rebuilt: 4 },
        { stories: 9, lots: 1, rebuilt: 1 }
      ],
      missing: 0,
      outline: null
    });
    await expect
      .poll(heightRows)
      .toEqual(['6 stories · 5 lots · 4 rebuilt', '9 stories · 1 lot · 1 rebuilt']);
    w.emit({ type: 'chunks', status: { '0_1': 'ready' }, pending: 0, failed: [] });
    expect(w.allOf('heightLots')).toHaveLength(2);
  });

  it('read-only (/p/:id): the key lists the heights and outlines them; no tools', async () => {
    const { w } = await setup({
      readOnly: true,
      plan: planOf(op('a', 8), op('b', null), op('c', 6))
    });
    await ready(w);
    await expect.poll(() => w.allOf('heightLots').length).toBe(1);
    expect(page.getByRole('radiogroup', { name: 'Tool' }).elements()).toEqual([]);
    click(keyToggle().element());
    await expect.poll(heightRows).toEqual(['6 stories · …', '8 stories · …']);
    const eight = page.getByRole('button', { name: /^8 stories/ });
    click(eight.element());
    await expect.element(eight).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => w.lastOf('heightLots')!.outlineOf).toBe(8);
    w.heightLots({
      heights: [
        { stories: 6, lots: 2, rebuilt: 2 },
        { stories: 8, lots: 1, rebuilt: 0 }
      ],
      missing: 0,
      outline: LOT_OUTLINE
    });
    await expect.poll(overlayIds).toContain(OUTLINE_LAYER_ID);
    await expect
      .poll(heightRows)
      .toEqual(['6 stories · 2 lots · 2 rebuilt', '8 stories · 1 lot · 0 rebuilt']);
    click(eight.element());
    await expect.poll(overlayIds).not.toContain(OUTLINE_LAYER_ID);
  });

  it.each(['the toggle', 'Escape', 'the sheet opening', 'Layers opening'] as const)(
    'a pressed height loses its outline when the key closes by %s, with no new request; reopened, nothing is pressed',
    async (how) => {
      const phone = how === 'the sheet opening';
      const layers = createRawSnippet(() => ({
        render: () => '<label><input type="checkbox" /> Transit stops</label>'
      }));
      const { w, dock } = await setup({
        width: phone ? 375 : 1024,
        plan: planOf(op('a', 6), op('b', 8)),
        layers: how === 'Layers opening' ? layers : undefined
      });
      await ready(w);
      await expect.poll(() => w.allOf('heightLots').length).toBe(1);
      click(keyToggle().element());
      await expect.poll(heightRows).toHaveLength(2);
      const eight = () =>
        document.querySelector<HTMLButtonElement>(
          '[data-testid="map-key-panel"] [data-height="8"]'
        )!;
      click(eight());
      await expect.poll(() => eight().getAttribute('aria-pressed')).toBe('true');
      await expect.poll(() => w.lastOf('heightLots')!.outlineOf).toBe(8);
      w.heightLots({
        heights: [
          { stories: 6, lots: 1, rebuilt: 1 },
          { stories: 8, lots: 1, rebuilt: 1 }
        ],
        missing: 0,
        outline: LOT_OUTLINE
      });
      await expect.poll(overlayIds).toContain(OUTLINE_LAYER_ID);
      const asked = w.allOf('heightLots').length;

      if (how === 'the toggle') click(keyToggle().element());
      else if (how === 'Layers opening') {
        click(page.getByRole('button', { name: 'Map layers' }).element());
        await expect.element(page.getByRole('group', { name: 'Map layers' })).toBeVisible();
      } else if (how === 'Escape')
        eight().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      else dock.sheet = 'full';
      await expect.poll(overlayIds).not.toContain(OUTLINE_LAYER_ID);
      expect(w.allOf('heightLots')).toHaveLength(asked);

      if (phone) dock.sheet = 'closed';
      else click(keyToggle().element());
      await expect.element(page.getByRole('group', { name: 'Map key' })).toBeVisible();
      expect(eight().getAttribute('aria-pressed')).toBe('false');
      expect(overlayIds()).not.toContain(OUTLINE_LAYER_ID);
      expect(w.allOf('heightLots')).toHaveLength(asked);
    }
  );

  describe('at 375 px the map toolbar sits above the sheet handle in every map state', () => {
    const BL = '--map-controls-br-block-size';
    /** The inset handed to SimMap (its component's `setBottomInset`), latest last. */
    const insetCalls = () => stub.calls.filter((c) => c.method === 'setBottomInset');
    afterEach(() => {
      stub.autoReady = true;
      document.documentElement.style.removeProperty(BL);
    });

    it.each([
      // The map never becomes ready: nothing published, the control's own fallback applies.
      ['never ready', null],
      // The map failed or is unsupported, publishing the worst block it could (no controls).
      ['failed, publishing a 0 px block', '0px']
    ] as const)('%s', async (_, published) => {
      stub.autoReady = false;
      if (published !== null) document.documentElement.style.setProperty(BL, published);
      const layers = createRawSnippet(() => ({
        render: () => '<label><input type="checkbox" /> Transit stops</label>'
      }));
      await setup({ width: 375, layers });
      const handle = page.getByTestId('dock-handle');
      await expect.element(handle).toBeVisible();
      const top = handle.element().getBoundingClientRect().top;
      // SimMap has the sheet's height before its map is ready (onready has not fired), so its
      // controls and Reset view sit above the handle from their first frame (issue #111).
      const sheetH = document.querySelector('.sfh-dock-sheet')!.getBoundingClientRect().height;
      expect(callsOf('onResyncNeeded')).toEqual([]);
      await expect.poll(() => insetCalls().at(-1)?.args[0]).toBe(sheetH);
      for (const id of ['map-layers-toggle', 'map-key-toggle']) {
        const t = page.getByTestId(id);
        await expect.element(t).toBeVisible();
        await expect
          .poll(() => t.element().getBoundingClientRect().bottom)
          .toBeLessThanOrEqual(top);
      }
    });
  });
});
