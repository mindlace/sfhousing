import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import type { OpStats } from '$lib/sim/protocol';
import BrushToolbar from './BrushToolbar.svelte';
import { MSG, strokeMessage } from './messages';
import { SETTINGS_KEY } from './settings';
import { BrushState } from './state.svelte';

type Editorish = { canUndo: boolean; canRedo: boolean; readOnly: boolean };

function setup(
  opts: { phase?: BrushState['phase']; editor?: Partial<Editorish>; fine?: boolean } = {}
) {
  const state = new BrushState({ fine: opts.fine ?? true, storage: localStorage });
  state.phase = opts.phase ?? 'ready';
  const editor: Editorish = { canUndo: false, canRedo: false, readOnly: false, ...opts.editor };
  const onUndo = vi.fn();
  const onRedo = vi.fn();
  const onRetry = vi.fn();
  const onToolChange = vi.fn();
  render(BrushToolbar, { props: { state, editor, onUndo, onRedo, onRetry, onToolChange } });
  return { state, onUndo, onRedo, onRetry, onToolChange };
}

const radio = (name: string) => page.getByRole('radio', { name });
const stories = () => page.getByRole('spinbutton', { name: 'Stories' });
const status = () => page.getByRole('status');

function setRange(el: HTMLInputElement, v: number) {
  el.value = String(v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

const stats = (s: Partial<OpStats>): OpStats => ({
  opId: 'x',
  kind: 'paint',
  stories: 6,
  covered: 143,
  ineligible: 0,
  built: 97,
  notBigger: 46,
  removed: 0,
  partial: false,
  ...s
});

describe('BrushToolbar (desktop)', () => {
  beforeEach(async () => {
    localStorage.clear();
    await page.viewport(1024, 768);
  });

  it('roves the tool radiogroup with arrow keys, wrapping', async () => {
    const { state, onToolChange } = setup();
    await expect.element(page.getByRole('radiogroup', { name: 'Brush tool' })).toBeVisible();
    await expect.element(radio('Paint')).toHaveAttribute('aria-checked', 'true');
    await expect.element(radio('Paint')).toHaveAttribute('tabindex', '0');
    await expect.element(radio('Move')).toHaveAttribute('tabindex', '-1');
    (radio('Paint').element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect.element(radio('Erase')).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(radio('Erase').element());
    expect(state.tool).toBe('erase');
    expect(onToolChange).toHaveBeenLastCalledWith('erase');
    await userEvent.keyboard('{ArrowRight}');
    await expect.element(radio('Move')).toHaveAttribute('aria-checked', 'true');
    await userEvent.keyboard('{ArrowLeft}');
    await expect.element(radio('Erase')).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(radio('Erase').element());
    await userEvent.keyboard('{ArrowUp}');
    await expect.element(radio('Paint')).toHaveAttribute('aria-checked', 'true');
    await userEvent.keyboard('{ArrowDown}');
    await expect.element(radio('Erase')).toHaveAttribute('aria-checked', 'true');
  });

  it('clamps the stepper and the number input, and presses the active chip', async () => {
    const { state } = setup();
    state.setStories(80);
    await page.getByRole('button', { name: 'More stories' }).click();
    expect(state.stories).toBe(80);
    await expect.element(stories()).toHaveValue(80);

    // Already 80: the input must still snap back from 85.
    await stories().fill('85');
    await userEvent.keyboard('{Enter}');
    await expect.element(stories()).toHaveValue(80);

    await stories().fill('0');
    (stories().element() as HTMLInputElement).blur();
    await expect.element(stories()).toHaveValue(1);
    expect(state.stories).toBe(1);

    await stories().fill('85');
    await userEvent.keyboard('{Enter}');
    await expect.element(stories()).toHaveValue(80);

    await stories().fill('6.6');
    await userEvent.keyboard('{Enter}');
    await expect.element(stories()).toHaveValue(7);
    expect(state.stories).toBe(7);

    await page.getByRole('button', { name: 'Fewer stories' }).click();
    expect(state.stories).toBe(6);

    await page.getByRole('button', { name: '12 stories', exact: true }).click();
    expect(state.stories).toBe(12);
    await expect
      .element(page.getByRole('button', { name: '12 stories', exact: true }))
      .toHaveAttribute('aria-pressed', 'true');
    await expect
      .element(page.getByRole('button', { name: '6 stories', exact: true }))
      .toHaveAttribute('aria-pressed', 'false');
    await expect.element(page.getByText('≈ 37 m')).toBeVisible();
  });

  it('maps the log slider ends to 5 m and 500 m with a value text', async () => {
    const { state } = setup();
    const slider = page.getByRole('slider', { name: /^Brush \d+ m$/ });
    await expect.element(slider).toHaveAttribute('aria-valuetext', 'Brush radius 30 metres');
    await expect.element(page.getByText('Brush 30 m')).toBeVisible();
    // WCAG 2.5.3: the visible label is the accessible name (spec §4.2 "labelled Brush 30 m").
    const label = (slider.element() as HTMLInputElement).labels![0];
    await expect.element(slider).toHaveAccessibleName(label.textContent!.trim());
    await expect.element(slider).toHaveAccessibleName('Brush 30 m');
    expect(slider.element().hasAttribute('aria-label')).toBe(false);
    setRange(slider.element() as HTMLInputElement, 0);
    await expect.element(page.getByText('Brush 5 m')).toBeVisible();
    expect(state.radiusM).toBe(5);
    setRange(slider.element() as HTMLInputElement, 99);
    await expect.element(page.getByText('Brush 500 m')).toBeVisible();
    await expect.element(slider).toHaveAccessibleName('Brush 500 m');
    await expect.element(slider).toHaveAttribute('aria-valuetext', 'Brush radius 500 metres');
    expect(state.radiusM).toBe(500);
  });

  it('disables the stepper for Erase and shows the hint', async () => {
    setup();
    await radio('Erase').click();
    await expect.element(stories()).toBeDisabled();
    await expect.element(page.getByRole('button', { name: 'More stories' })).toBeDisabled();
    await expect.element(page.getByText(MSG.eraseHint)).toBeVisible();
    await expect.element(stories()).toHaveAccessibleDescription(MSG.eraseHint);
    await expect
      .element(page.getByRole('group', { name: 'Stories' }))
      .toHaveAccessibleDescription(MSG.eraseHint);
    await radio('Paint').click();
    await expect.element(stories()).not.toHaveAttribute('aria-describedby');
    await expect.element(stories()).toBeEnabled();
  });

  it('disables Paint and Erase before ready, and wires Retry on failure', async () => {
    const { state, onRetry } = setup({ phase: 'loading' });
    await expect.element(radio('Paint')).toBeDisabled();
    await expect.element(radio('Erase')).toBeDisabled();
    await expect.element(radio('Move')).toBeEnabled();
    await expect.element(radio('Move')).toHaveAttribute('tabindex', '0');
    await expect.element(status()).toHaveTextContent(MSG.loadingCity);
    state.phase = 'failed';
    await expect.element(status()).toHaveTextContent(MSG.cityFailed);
    await page.getByRole('button', { name: 'Retry' }).click();
    expect(onRetry).toHaveBeenCalledOnce();
    state.phase = 'ready';
    await expect.element(radio('Paint')).toBeEnabled();
    await expect.element(page.getByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('shows each stroke announcement template in the live region', async () => {
    const { state } = setup();
    await expect.element(status()).toHaveAttribute('aria-live', 'polite');
    const cases = [
      stats({}),
      stats({ kind: 'erase', stories: undefined, removed: 97 }),
      stats({ ineligible: 12 }),
      stats({ partial: true }),
      stats({ covered: 0, built: 0, notBigger: 0 })
    ];
    const expected = [
      'Painted 6 stories on 143 parcels · 97 new buildings · 46 already as big or bigger',
      'Erased 143 parcels · 97 generated buildings removed',
      ' · 12 not eligible (open space or unmapped lots)',
      ' · some areas still loading',
      'No parcels under that stroke'
    ];
    for (let i = 0; i < cases.length; i++) {
      state.announce(strokeMessage(cases[i]), 4000);
      await expect.element(status()).toHaveTextContent(expected[i].trim());
    }
  });

  it('calls undo and redo, disabled per the editor', async () => {
    const { onUndo } = setup({ editor: { canUndo: true, canRedo: false } });
    await page.getByRole('button', { name: 'Undo (⌘Z / Ctrl+Z)' }).click();
    expect(onUndo).toHaveBeenCalledOnce();
    await expect
      .element(page.getByRole('button', { name: 'Redo (⇧⌘Z / Ctrl+Shift+Z / Ctrl+Y)' }))
      .toBeDisabled();
  });

  it('toggles the keyboard shortcuts table', async () => {
    setup();
    const btn = page.getByRole('button', { name: 'Keyboard shortcuts' });
    await expect.element(btn).toHaveAttribute('aria-expanded', 'false');
    await btn.click();
    await expect.element(btn).toHaveAttribute('aria-expanded', 'true');
    await expect.element(page.getByRole('table')).toBeVisible();
    await expect
      .element(page.getByRole('cell', { name: 'Keyboard stamp at the map centre' }))
      .toBeVisible();
  });

  it('exposes --brushbar-h: 0px on the toolbar root at ≥ md', async () => {
    setup();
    await expect.element(radio('Paint')).toBeVisible();
    const root = document.querySelector<HTMLElement>('.brush-toolbar')!;
    expect(getComputedStyle(root).getPropertyValue('--brushbar-h').trim()).toBe('0px');
  });

  it('persists stories to localStorage', async () => {
    const { state } = setup();
    state.setStories(8);
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!)).toMatchObject({ stories: 8 });
  });
});

describe('BrushToolbar (375 px)', () => {
  beforeEach(async () => {
    localStorage.clear();
    await page.viewport(375, 812);
  });

  it('shows only Move and the read-only note', async () => {
    setup({ editor: { readOnly: true } });
    await expect.element(radio('Move')).toHaveAttribute('aria-checked', 'true');
    await expect.element(page.getByText(MSG.readOnly)).toBeVisible();
    expect(page.getByRole('radio').elements()).toHaveLength(1);
    await expect.element(page.getByRole('button', { name: /Undo/ })).not.toBeInTheDocument();
    await expect.element(stories()).not.toBeInTheDocument();
  });

  it('opens the stories popover from "6 st" and closes it on Escape, refocusing the opener', async () => {
    setup();
    const opener = page.getByRole('button', { name: '6 stories per stroke' });
    await expect.element(opener).toHaveTextContent('6 st');
    await expect.element(opener).toHaveAttribute('aria-expanded', 'false');
    await opener.click();
    await expect.element(opener).toHaveAttribute('aria-expanded', 'true');
    await expect.element(stories()).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'More stories' })).toBeVisible();
    (stories().element() as HTMLElement).focus();
    await userEvent.keyboard('{Escape}');
    await expect.element(stories()).not.toBeInTheDocument();
    expect(document.activeElement).toBe(opener.element());
  });

  it('closes a popover on an outside click', async () => {
    setup();
    await page.getByRole('button', { name: 'Brush 30 m' }).click();
    await expect
      .element(page.getByRole('slider', { name: 'Brush 30 m', exact: true }))
      .toBeVisible();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await expect
      .element(page.getByRole('slider', { name: 'Brush 30 m', exact: true }))
      .not.toBeInTheDocument();
  });

  it('keeps every control at least 44 px and has no horizontal scroll', async () => {
    setup();
    await expect.element(radio('Paint')).toBeVisible();
    const bar = document.querySelector<HTMLElement>('[data-testid="brush-bar"]')!;
    for (const el of bar.querySelectorAll<HTMLElement>('button')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      expect(r.width).toBeGreaterThanOrEqual(44);
      expect(r.height).toBeGreaterThanOrEqual(44);
    }
    expect(bar.getBoundingClientRect().height).toBe(56);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
    const root = document.querySelector<HTMLElement>('.brush-toolbar')!;
    expect(getComputedStyle(root).getPropertyValue('--brushbar-h').trim()).toBe('56px');
  });
});
