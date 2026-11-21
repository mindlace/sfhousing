import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { COPY } from './copy';
import SaveIndicator from './SaveIndicator.svelte';

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

  it('Escape closes the N4 popover', async () => {
    render(SaveIndicator, { status: 'off' });
    const btn = page.getByRole('button', { name: 'Autosave off' });
    await userEvent.click(btn);
    await expect.element(page.getByText(COPY.n4)).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByText(COPY.n4)).not.toBeVisible();
  });
});
