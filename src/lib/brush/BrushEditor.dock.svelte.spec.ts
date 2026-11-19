// `/`'s BrushEditor on the dock (sim-ux plan 5, Task 3): the shared Paint tab without `/sim`'s
// painted-areas list, the read-only line and summary, the stroke chip, the phone palette strip
// and one notice stack. A stub SimMap hands over a fake MapLibre map, so a real BrushController
// attaches (a separate file: vi.mock is file-wide, and BrushEditor.svelte.spec.ts relies on the
// real SimMap's fallback).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createRawSnippet, flushSync } from 'svelte';
import '../../routes/layout.css';
import type { Manifest } from '$lib/data/manifest';
import { DockState } from '$lib/dock/dock-state.svelte';
import { callsOf, stub } from '$lib/fzp/test/sim-map-stub';
import { OUTLINE_LAYER_ID } from '$lib/paint/outline-layers';
import { OPS_MAX, emptyPlan, type Plan, type PlanOp } from '$lib/plan';
import { PILL } from '$lib/shell/pill';
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
      notices: opts.notices
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

/**
 * A pointer stub for `window.matchMedia`, set before render: `primary` is what `(pointer: ...)`
 * reports, `any` the kinds `(any-pointer: ...)` does. Every other query is the browser's own
 * (the dock reads `(min-width: 768px)`).
 */
function stubPointer(
  primary: 'coarse' | 'fine',
  any: ('coarse' | 'fine')[] = [primary]
): { set(p: 'coarse' | 'fine'): void } {
  const real = window.matchMedia.bind(window);
  let now = primary;
  const listeners = new Set<(e: Event) => void>();
  vi.stubGlobal('matchMedia', (q: string) => {
    const k = q.replace(/\s/g, '');
    if (!/^\((any-)?pointer:/.test(k)) return real(q);
    return {
      get matches() {
        return k === `(pointer:${now})` || any.some((a) => k === `(any-pointer:${a})`);
      },
      media: q,
      addEventListener(_type: string, fn: (e: Event) => void) {
        listeners.add(fn);
      },
      removeEventListener(_type: string, fn: (e: Event) => void) {
        listeners.delete(fn);
      }
    } as unknown as MediaQueryList;
  });
  return {
    set(p) {
      now = p;
      for (const fn of [...listeners]) fn(new Event('change'));
    }
  };
}

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

  it('`/` has no painted-areas list: strokes at two heights leave no rows and ask no lot counts', async () => {
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
    expect(w.allOf('opLots')).toEqual([]);
    expect(overlayIds()).not.toContain(OUTLINE_LAYER_ID);
  });

  it("the status line and Retry are pills in the notice stack, together with the page's `notices` snippet in one `fzp-notices`", async () => {
    const notices = createRawSnippet(() => ({
      render: () => `<p class="${PILL}" data-testid="page-notice">Page notice</p>`
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

  it('the chip sits a row lower while a failure chip shows', async () => {
    const { w } = await setup();
    await ready(w);
    const region = announcement().element();
    const host = document.querySelector<HTMLElement>('.brush-editor')!;
    const pillsBottom = () =>
      parseFloat(getComputedStyle(host).getPropertyValue('--notice-pills-bottom') || '0');
    const offset = () => parseFloat(getComputedStyle(region).top) - pillsBottom();
    await expect.poll(offset).toBe(8);
    w.emit({ type: 'chunks', status: { '50_25': 'error' }, pending: 0, failed: ['50_25'] });
    await expect.poll(offset).toBe(56);
    w.emit({ type: 'chunks', status: { '50_25': 'ready' }, pending: 0, failed: [] });
    await expect.poll(offset).toBe(8);
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

  it('a touch laptop (fine primary, coarse any-pointer) keeps the keyboard: no buttons, shortcuts listed', async () => {
    stubPointer('fine', ['fine', 'coarse']);
    await setup();
    expect(page.getByRole('button', { name: /^(Undo|Redo)/ }).elements()).toEqual([]);
    await expect.element(page.getByRole('button', { name: 'Keyboard shortcuts' })).toBeVisible();
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
    expect(w.allOf('opLots')).toEqual([]);

    const before = w.posts.length;
    key('z');
    key('z', true);
    expect(w.posts.slice(before)).toEqual([]);
    expect(editor().plan).toBe(plan);
    await expect
      .element(tab.getByText('6 and 8 stories · 4 lots rebuilt', { exact: true }))
      .toBeVisible();
  });

  it("a read-only load starts its count at 0, never the previous plan's", async () => {
    const { w, editor } = await setup({ readOnly: true, plan: planOf(op('a', 8)) });
    await ready(w);
    const tab = page.getByRole('tabpanel');
    w.emit(scoreDiff(w.lastOf('load')!.rev, 'load', 4));
    await expect
      .element(tab.getByText('8 stories · 4 lots rebuilt', { exact: true }))
      .toBeVisible();
    editor().load(planOf(op('b', 3)), { readOnly: true });
    // Before the new plan's diff: its heights, with nothing counted yet.
    await expect
      .element(tab.getByText('3 stories · 0 lots rebuilt', { exact: true }))
      .toBeVisible();
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
    await expect
      .element(tab.getByText('6 stories · 0 lots rebuilt', { exact: true }))
      .toBeVisible();
  });
});
