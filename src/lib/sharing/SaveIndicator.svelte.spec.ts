import { describe, expect, it, onTestFinished } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { cdp, page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { COPY } from './copy';
import SaveIndicator from './SaveIndicator.svelte';
import ExplainHost from '$lib/timeline/test/ExplainHost.svelte';

const live = () => page.getByTestId('save-live');

describe('SaveIndicator', () => {
  it('shows nothing when saved, and keeps its width', async () => {
    const { rerender } = await render(SaveIndicator, { status: 'saved' });
    const state = () => page.getByTestId('save-state');
    await expect.element(state()).toHaveAttribute('data-save-status', 'saved');
    expect(page.getByText('Saved').elements()).toHaveLength(0);
    expect(page.getByTestId('save-text').elements()).toHaveLength(0);
    const width = state().element().getBoundingClientRect().width;
    expect(width).toBeGreaterThan(0);

    await rerender({ status: 'saving' });
    await expect.element(state()).toHaveAttribute('data-save-status', 'saving');
    await expect.element(page.getByTestId('save-text')).toBeVisible();
    expect(state().element().getBoundingClientRect().width).toBe(width);

    await rerender({ status: 'saved' });
    await expect.element(state()).toHaveAttribute('data-save-status', 'saved');
    expect(page.getByTestId('save-text').elements()).toHaveLength(0);
    expect(state().element().getBoundingClientRect().width).toBe(width);
  });

  describe('with icons (a game below sm)', () => {
    const state = () => page.getByTestId('save-state');
    const width = () => state().element().getBoundingClientRect().width;
    const off = () => page.getByRole('button', { name: COPY.autosaveOff, exact: true });

    /** A CSS colour as sRGB 0..255, read back from a canvas pixel (oklch included). */
    const rgbOf = (css: string): number[] => {
      const c = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
      c.fillStyle = css;
      c.fillRect(0, 0, 1, 1);
      return [...c.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    };
    const lum = (css: string) => {
      const [r, g, b] = rgbOf(css).map((v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };

    it('below sm: nothing drawn while saved or saving; off is a 24 px icon named Autosave off', async () => {
      onTestFinished(() => page.viewport(1280, 900));
      await page.viewport(375, 700);
      const { rerender } = await render(SaveIndicator, { status: 'saved', icons: true });
      await expect.element(state()).toHaveAttribute('data-save-status', 'saved');
      expect(width()).toBe(0);
      await rerender({ status: 'saving', icons: true });
      await expect.element(state()).toHaveAttribute('data-save-status', 'saving');
      expect(width()).toBe(0);

      await rerender({ status: 'off', icons: true });
      await expect.element(off()).toBeVisible();
      const b = off().element().getBoundingClientRect();
      expect(b.width).toBeGreaterThanOrEqual(24);
      expect(b.height).toBeGreaterThanOrEqual(24);
      expect(b.width).toBeLessThanOrEqual(28);
      const icon = off().element().querySelector('svg')!;
      expect(icon.getBoundingClientRect().width).toBeGreaterThan(0);
      // The word is kept for assistive technology only.
      const word = off().element().querySelector('span')!;
      expect(word.textContent).toBe(COPY.autosaveOff);
      expect(getComputedStyle(word).position).toBe('absolute');
      expect(word.getBoundingClientRect().width).toBeLessThanOrEqual(1);
      expect(width()).toBeLessThanOrEqual(28);

      await page.viewport(1280, 900);
      await expect.poll(() => off().element().getBoundingClientRect().width).toBeGreaterThan(40);
      expect(icon.getBoundingClientRect().width).toBe(0);
    });

    for (const scheme of ['light', 'dark'] as const)
      it(`the icon keeps 3:1 on its button, and the button 3:1 against the bar (${scheme})`, async () => {
        onTestFinished(() => page.viewport(1280, 900));
        await page.viewport(375, 700);
        await cdp().send('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-color-scheme', value: scheme }]
        });
        onTestFinished(async () => {
          await cdp().send('Emulation.setEmulatedMedia', {
            features: [{ name: 'prefers-color-scheme', value: 'light' }]
          });
        });
        await render(SaveIndicator, { status: 'off', icons: true });
        await expect.element(off()).toBeVisible();
        const st = getComputedStyle(off().element());
        const icon = getComputedStyle(off().element().querySelector('svg')!);
        const bar = getComputedStyle(document.documentElement).getPropertyValue(
          scheme === 'light' ? '--color-surface' : '--color-chrome-dark'
        );
        expect(ratio(icon.color, st.backgroundColor)).toBeGreaterThanOrEqual(3);
        expect(ratio(st.borderTopColor, bar)).toBeGreaterThanOrEqual(3);
      });
  });
  it('shows "Saving…" for saving', async () => {
    render(SaveIndicator, { status: 'saving' });
    const text = page.getByTestId('save-text');
    await expect.element(text).toBeVisible();
    await expect.element(text).toHaveTextContent('Saving…');
  });

  it('shows an "Autosave off" button for off', async () => {
    render(SaveIndicator, { status: 'off' });
    await expect.element(page.getByRole('button', { name: 'Autosave off' })).toBeVisible();
  });

  it('live region announces only off↔on transitions, nothing on first render', async () => {
    const { rerender } = await render(SaveIndicator, { status: 'saved' });
    await expect.element(live()).toHaveAttribute('role', 'status');
    await expect.element(live()).toHaveAttribute('aria-live', 'polite');
    await expect.element(live()).toHaveTextContent('');

    await rerender({ status: 'saving' });
    await expect.element(live()).toHaveTextContent('');

    await rerender({ status: 'off' });
    await expect.element(live()).toHaveTextContent('Autosave off');

    // Recovery is only known once a write succeeds.
    await rerender({ status: 'saving' });
    await expect.element(live()).toHaveTextContent('Autosave off');

    await rerender({ status: 'saved' });
    await expect.element(live()).toHaveTextContent('Autosave on');
  });

  it('starting off announces nothing until a transition', async () => {
    const { rerender } = await render(SaveIndicator, { status: 'off' });
    await expect.element(live()).toHaveTextContent('');
    await rerender({ status: 'saved' });
    await expect.element(live()).toHaveTextContent('Autosave on');
  });

  it('toggles the N4 popover from the Autosave off button', async () => {
    render(SaveIndicator, { status: 'off' });
    const btn = page.getByRole('button', { name: 'Autosave off' });
    await expect.element(btn).toHaveAttribute('aria-expanded', 'false');
    await expect.element(page.getByText(COPY.n4)).not.toBeVisible();

    await userEvent.click(btn);
    await expect.element(btn).toHaveAttribute('aria-expanded', 'true');
    const pop = page.getByText(COPY.n4);
    await expect.element(pop).toBeVisible();
    const id = btn.element().getAttribute('aria-controls');
    expect(id).toBeTruthy();
    expect(pop.element().id).toBe(id);

    await userEvent.click(btn);
    await expect.element(btn).toHaveAttribute('aria-expanded', 'false');
    await expect.element(page.getByText(COPY.n4)).not.toBeVisible();
  });

  it('the Autosave off popover draws on the surface tokens with dark partners', async () => {
    render(SaveIndicator, { status: 'off' });
    await userEvent.click(page.getByRole('button', { name: 'Autosave off' }));
    const pop = page.getByText(COPY.n4);
    await expect.element(pop).toBeVisible();
    const cls = [...pop.element().classList];
    for (const c of [
      'bg-surface',
      'dark:bg-surface-dark',
      'text-ink',
      'dark:text-ink-dark',
      'border-line',
      'dark:border-line-dark'
    ])
      expect(cls, c).toContain(c);
    expect(cls).not.toContain('bg-white');
    // The light surface token, as drawn.
    expect(getComputedStyle(pop.element()).backgroundColor).toBe('rgb(255, 255, 255)');
  });

  it('an Escape an open explanation took leaves the N4 popover open; the next closes it', async () => {
    render(SaveIndicator, { status: 'off' });
    // Below the popover, clear of it.
    const below = document.createElement('div');
    below.style.marginTop = '300px';
    document.body.appendChild(below);
    onTestFinished(() => {
      below.remove();
    });
    render(ExplainHost, { props: { text: 'An explanation.' }, target: below });
    await userEvent.click(page.getByRole('button', { name: 'Autosave off' }));
    await expect.element(page.getByText(COPY.n4)).toBeVisible();
    // The pointer at rest on the button: no explanation yet.
    await expect.element(page.getByText('An explanation.')).not.toBeInTheDocument();
    await page.getByTestId('target').hover();
    await expect.element(page.getByText('An explanation.')).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByText('An explanation.')).not.toBeInTheDocument();
    await expect.element(page.getByText(COPY.n4)).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByText(COPY.n4)).not.toBeVisible();
  });

  it('Escape closes the N4 popover', async () => {
    render(SaveIndicator, { status: 'off' });
    const btn = page.getByRole('button', { name: 'Autosave off' });
    await userEvent.click(btn);
    await expect.element(page.getByText(COPY.n4)).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByText(COPY.n4)).not.toBeVisible();
  });
});
