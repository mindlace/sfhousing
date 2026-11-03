// `/`'s BrushEditor on the dock (sim-ux plan 5, Task 3): the shared Paint tab with rows of painted
// areas, their lot counts and outlines, Remove, the phone palette strip and one notice stack. A
// stub SimMap hands over a fake MapLibre map, so a real BrushController attaches (a separate file:
// vi.mock is file-wide, and BrushEditor.svelte.spec.ts relies on the real SimMap's fallback).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createRawSnippet } from 'svelte';
import '../../routes/layout.css';
import type { Manifest } from '$lib/data/manifest';
import { DockState } from '$lib/dock/dock-state.svelte';
import { callsOf, stub } from '$lib/fzp/test/sim-map-stub';
import { OUTLINE_LAYER_ID } from '$lib/paint/outline-layers';
import { emptyPlan, type Plan, type PlanOp } from '$lib/plan';
import { M_PER_DEG_LAT, M_PER_DEG_LNG } from '$lib/plan/geometry';
import { PILL } from '$lib/shell/pill';
import type { LotOutlines } from '$lib/sim/outlines';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import BrushEditorHost from './test/BrushEditorHost.svelte';
import type { Editor } from './editor.svelte';
import { MSG } from './messages';
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
  readOnly?: boolean;
  plan?: Plan;
  notices?: ReturnType<typeof createRawSnippet>;
}

async function setup(opts: Opts = {}) {
  const width = opts.width ?? 1024;
  await page.viewport(width, width < 768 ? 700 : 768);
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

/** Answers the latest `opLots` request for `opIds` (once it has gone out). */
async function answerLots(w: FakeEditorWorker, opIds: string[], lots: number, o?: LotOutlines) {
  await expect.poll(() => w.lastOf('opLots')?.opIds).toEqual(opIds);
  const q = w.lastOf('opLots')!;
  w.emit({ type: 'opLots', reqId: q.reqId, result: { lots, missing: 0, outline: o ?? null } });
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
const rowButtons = () => [...document.querySelectorAll<HTMLElement>('[data-paint-row]')];
const rowNames = () => rowButtons().map((b) => b.getAttribute('aria-label'));
const rowButton = (re: RegExp) => rowButtons().find((b) => re.test(b.ariaLabel ?? ''))!;
const removeButton = () => page.getByRole('button', { name: /^Remove: / });
const overlayIds = () =>
  ((callsOf('setOverlayLayers').at(-1)?.[0] ?? []) as { id: string }[]).map((l) => l.id);
const loadedIds = (w: FakeEditorWorker) => w.lastOf('load')!.plan.ops.map((o) => o.id);
const key = (k: string, shift = false) =>
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, ctrlKey: true, shiftKey: shift, bubbles: true })
  );

/** A 30 m square at the stub map's centre, as one lot's outline. */
function outline(): LotOutlines {
  const c = stub.map.getCenter();
  const dx = 30 / M_PER_DEG_LNG;
  const dy = 30 / M_PER_DEG_LAT;
  const ring = [
    [c.lng, c.lat],
    [c.lng + dx, c.lat],
    [c.lng + dx, c.lat + dy],
    [c.lng, c.lat + dy],
    [c.lng, c.lat]
  ];
  return {
    lots: ['P0'],
    ringLot: Uint32Array.from([0]),
    starts: Uint32Array.from([0, ring.length]),
    positions: Float64Array.from(ring.flat())
  };
}

beforeEach(() => {
  stub.reset();
  stub.map.zoom = 18;
  localStorage.clear();
});

afterEach(() => {
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
    const tools = page.getByRole('radiogroup', { name: 'Brush tool' });
    expect(
      tools
        .getByRole('radio')
        .elements()
        .map((r) => r.textContent?.trim())
    ).toEqual(['Move', 'Paint', 'Erase']);
    await expect.element(page.getByRole('group', { name: 'Height' })).toBeVisible();
    await expect.element(page.getByRole('slider', { name: /^Brush \d+ m$/ })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    await expect.element(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
    expect(page.getByRole('list', { name: 'Painted areas' }).elements()).toEqual([]);
    expect(
      getComputedStyle(document.querySelector('.brush-editor')!).getPropertyValue('--dock-w')
    ).toBe('320px');
  });

  it('two strokes at one height make one row; a new height starts another', async () => {
    const { w, editor } = await setup();
    await ready(w);
    click(page.getByRole('radio', { name: 'Paint' }).element());
    stroke();
    stroke();
    await expect.poll(rowNames).toEqual(['6 stories · 2 strokes · Finding lots…']);
    click(page.getByRole('button', { name: '8 stories', exact: true }).element());
    stroke();
    await expect
      .poll(rowNames)
      .toEqual(['6 stories · 2 strokes · Finding lots…', '8 stories · 1 stroke · Finding lots…']);
    expect(editor().plan.ops).toHaveLength(3);
    expect(w.allOf('commit')).toHaveLength(3);
  });

  it('a row shows its lot count once the worker answers opLots', async () => {
    const { w, editor } = await setup();
    await ready(w);
    click(page.getByRole('radio', { name: 'Paint' }).element());
    stroke();
    const id = editor().plan.ops[0].id;
    await expect.poll(() => w.lastOf('opLots')?.opIds).toEqual([id]);
    // Asked after the op reached the worker (the host skips ids it does not hold).
    expect(w.types().indexOf('opLots')).toBeGreaterThan(w.types().indexOf('commit'));
    const q = w.lastOf('opLots')!;
    expect(q.outlines).toBe(false);
    w.emit({ type: 'opLots', reqId: q.reqId, result: { lots: 12, missing: 0, outline: null } });
    await expect.poll(rowNames).toEqual(['6 stories · 1 stroke · 12 lots']);
    await expect
      .element(page.getByRole('status').filter({ hasText: '12 lots' }))
      .toBeInTheDocument();
  });

  it('selecting a row asks for its outline and draws it in the outline slot', async () => {
    const { w } = await setup({ plan: planOf(op('a', 6)) });
    await ready(w);
    await expect.poll(() => w.lastOf('opLots')?.opIds).toEqual(['a']);
    const first = w.lastOf('opLots')!;
    w.emit({ type: 'opLots', reqId: first.reqId, result: { lots: 3, missing: 0, outline: null } });
    await expect.poll(rowNames).toEqual(['6 stories · 1 stroke · 3 lots']);
    expect(overlayIds()).not.toContain(OUTLINE_LAYER_ID);

    click(rowButton(/^6 stories/));
    await expect.poll(() => rowButton(/^6 stories/).getAttribute('aria-pressed')).toBe('true');
    await expect.poll(() => w.lastOf('opLots')?.outlines).toBe(true);
    const q = w.lastOf('opLots')!;
    expect(q.opIds).toEqual(['a']);
    w.emit({ type: 'opLots', reqId: q.reqId, result: { lots: 3, missing: 0, outline: outline() } });
    await expect.poll(overlayIds).toContain(OUTLINE_LAYER_ID);

    click(rowButton(/^6 stories/));
    await expect.poll(overlayIds).not.toContain(OUTLINE_LAYER_ID);
  });

  it('Remove on the selected row loads the new plan and Undo loads it back', async () => {
    const { w, editor } = await setup({
      plan: planOf(op('a', 6), op('b', 6), op('c', 8), op('d', 6))
    });
    await ready(w);
    expect(loadedIds(w)).toEqual(['a', 'b', 'c', 'd']);
    await expect.poll(rowNames).toHaveLength(3);

    click(rowButton(/^8 stories/));
    await expect.element(removeButton()).toBeVisible();
    click(removeButton().element());
    // The worker gets the new op list; its equal neighbours now make one row.
    expect(loadedIds(w)).toEqual(['a', 'b', 'd']);
    expect(editor().plan.ops.map((o) => o.id)).toEqual(['a', 'b', 'd']);
    await expect.poll(rowNames).toEqual(['6 stories · 3 strokes · Finding lots…']);
    expect(rowButtons().map((b) => b.getAttribute('aria-pressed'))).toEqual(['false']);
    await expect.element(page.getByTestId('brush-status')).toHaveTextContent('Removed 8 stories');

    key('z');
    expect(loadedIds(w)).toEqual(['a', 'b', 'c', 'd']);
    await expect.poll(() => rowNames().length).toBe(3);
    await expect
      .element(page.getByTestId('brush-status'))
      .toHaveTextContent('Undid: Removed 8 stories');

    key('z', true);
    expect(loadedIds(w)).toEqual(['a', 'b', 'd']);
    expect(w.allOf('undo')).toEqual([]);
    expect(w.allOf('commit')).toEqual([]);
  });

  it('Remove during a stroke cancels the stroke first', async () => {
    const { w, editor } = await setup({ plan: planOf(op('a', 6), op('c', 8)) });
    await ready(w);
    click(page.getByRole('radio', { name: 'Paint' }).element());
    click(rowButton(/^8 stories/));
    await expect.element(removeButton()).toBeVisible();

    drag(10, 60);
    await expect.poll(() => w.allOf('preview').length).toBeGreaterThan(0);
    const before = w.posts.length;
    click(removeButton().element());
    // The stroke is cancelled before the removal reaches the worker; nothing half-commits.
    expect(w.posts.slice(before).map((p) => p.type)).toEqual(['cancelPreview', 'load']);
    expect(loadedIds(w)).toEqual(['a']);
    ev('pointerup', 60);
    expect(w.allOf('commit')).toEqual([]);
    expect(editor().plan.ops.map((o) => o.id)).toEqual(['a']);
    // The next undo restores the row, not a stroke.
    key('z');
    expect(loadedIds(w)).toEqual(['a', 'c']);
    expect(w.allOf('undo')).toEqual([]);
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

  it('read-only (/p/:id): rows only; no tools, no Remove; Ctrl+Z does nothing', async () => {
    const plan = planOf(op('a', 6), op('b', null));
    const { w, editor } = await setup({ readOnly: true, plan });
    await ready(w);
    await answerLots(w, ['a'], 4);
    await answerLots(w, ['b'], 2);
    await expect
      .poll(rowNames)
      .toEqual(['6 stories · 1 stroke · 4 lots', 'Erased · 1 stroke · 2 lots']);
    expect(page.getByRole('radiogroup', { name: 'Brush tool' }).elements()).toEqual([]);
    expect(page.getByRole('button', { name: /^Undo/ }).elements()).toEqual([]);
    await expect.element(page.getByText(MSG.readOnly, { exact: true })).toBeVisible();

    click(rowButton(/^6 stories/));
    await expect.poll(() => rowButton(/^6 stories/).getAttribute('aria-pressed')).toBe('true');
    await expect.poll(() => w.lastOf('opLots')?.outlines).toBe(true);
    await answerLots(w, ['a'], 4, outline());
    await expect.poll(overlayIds).toContain(OUTLINE_LAYER_ID);
    expect(removeButton().elements()).toEqual([]);

    const before = w.posts.length;
    key('z');
    key('z', true);
    expect(w.posts.slice(before).filter((p) => p.type !== 'opLots')).toEqual([]);
    expect(editor().plan).toBe(plan);
  });
});
