import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import MessageHost from './test/MessageHost.svelte';

const msg = () => page.getByTestId('msg');
const box = (el: Element) => el.getBoundingClientRect();

describe('Message', () => {
  it('a short sentence renders as a chip with its actions on the line', async () => {
    render(MessageHost, { text: "Some map data didn't load." });
    await expect.element(msg()).toBeVisible();
    const el = msg().element();
    expect(el.getAttribute('data-shape')).toBe('chip');
    expect(el.classList.contains('rounded-full')).toBe(true);
    expect(el.getAttribute('role')).toBeNull();
    const text = box(page.getByText("Some map data didn't load.").element());
    const retry = box(page.getByRole('button', { name: 'Retry' }).element());
    // One line: Retry sits beside the text, not under it.
    expect(retry.left).toBeGreaterThanOrEqual(text.right);
    expect(retry.top).toBeLessThan(text.bottom);
    expect(getComputedStyle(el).pointerEvents).toBe('auto');
  });

  it('two sentences render as a card; its actions sit under the text', async () => {
    render(MessageHost, { text: 'Goal missed by 1,234 homes. Add a policy and play again.' });
    await expect.element(msg()).toBeVisible();
    const el = msg().element();
    expect(el.getAttribute('data-shape')).toBe('card');
    expect(el.classList.contains('rounded-lg')).toBe(true);
    const text = box(page.getByText(/^Goal missed/).element());
    const retry = box(page.getByRole('button', { name: 'Retry' }).element());
    expect(retry.top).toBeGreaterThanOrEqual(text.bottom);
  });

  it('details make a card, shown under the text', async () => {
    render(MessageHost, { text: 'Short.', withDetails: true });
    await expect.element(page.getByText('One detail')).toBeVisible();
    expect(msg().element().getAttribute('data-shape')).toBe('card');
  });

  it('still: the chip takes no presses', async () => {
    render(MessageHost, { text: '6 stories on 3 lots', still: true, withActions: false });
    await expect.element(msg()).toBeVisible();
    const el = msg().element();
    expect(el.getAttribute('data-shape')).toBe('chip');
    expect(getComputedStyle(el).pointerEvents).toBe('none');
    // No action: even padding either side.
    const s = getComputedStyle(el);
    expect(s.paddingRight).toBe(s.paddingLeft);
  });

  it("a card's dismiss sits top right, on the text's first line, and adds no row", async () => {
    const ondismiss = vi.fn();
    render(MessageHost, {
      text: 'Goal missed by 1,234 homes. Add a policy and play again.',
      withActions: false,
      ondismiss
    });
    await expect.element(msg()).toBeVisible();
    const el = msg().element();
    expect(el.getAttribute('data-shape')).toBe('card');
    const textEl = page.getByText(/^Goal missed/).element();
    const text = box(textEl);
    const lineH = parseFloat(getComputedStyle(textEl).lineHeight);
    const x = page.getByRole('button', { name: 'Dismiss' });
    const d = box(x.element());
    // On the first line, right of the words.
    expect(d.top).toBeLessThan(text.top + lineH);
    expect(d.bottom).toBeGreaterThan(text.top);
    expect(d.left).toBeGreaterThanOrEqual(text.right);
    // A 24 px target, the shared look: no underline, the drawn ×.
    expect(d.width).toBeGreaterThanOrEqual(24);
    expect(d.height).toBeGreaterThanOrEqual(24);
    expect(getComputedStyle(x.element()).textDecorationLine).toBe('none');
    expect(x.element().querySelector('svg')).not.toBeNull();
    // No second row: the card ends its padding under the words.
    const s = getComputedStyle(el);
    const below = box(el).bottom - text.bottom;
    expect(below).toBeCloseTo(parseFloat(s.paddingBottom) + parseFloat(s.borderBottomWidth), 0);
    await x.click();
    expect(ondismiss).toHaveBeenCalledTimes(1);
  });

  it("a card's other actions stay in the row under the text, the dismiss stays top right", async () => {
    render(MessageHost, {
      text: 'Goal missed by 1,234 homes. Add a policy and play again.',
      ondismiss: () => {}
    });
    await expect.element(msg()).toBeVisible();
    const textEl = page.getByText(/^Goal missed/).element();
    const text = box(textEl);
    const lineH = parseFloat(getComputedStyle(textEl).lineHeight);
    const retry = box(page.getByRole('button', { name: 'Retry' }).element());
    const d = box(page.getByRole('button', { name: 'Dismiss' }).element());
    expect(retry.top).toBeGreaterThanOrEqual(text.bottom);
    expect(d.top).toBeLessThan(text.top + lineH);
    expect(d.left).toBeGreaterThanOrEqual(text.right);
    expect(d.left).toBeGreaterThan(retry.right);
  });

  it("a chip's dismiss is last on its line", async () => {
    render(MessageHost, { text: "Some map data didn't load.", ondismiss: () => {} });
    await expect.element(msg()).toBeVisible();
    expect(msg().element().getAttribute('data-shape')).toBe('chip');
    const text = box(page.getByText("Some map data didn't load.").element());
    const retry = box(page.getByRole('button', { name: 'Retry' }).element());
    const d = box(page.getByRole('button', { name: 'Dismiss' }).element());
    expect(d.left).toBeGreaterThanOrEqual(retry.right);
    expect(d.top).toBeLessThan(text.bottom);
  });

  it('an explicit shape wins over the words', async () => {
    render(MessageHost, {
      text: 'Plan too large to save. Undo some strokes.',
      shape: 'chip',
      still: true,
      withActions: false
    });
    await expect.element(msg()).toBeVisible();
    expect(msg().element().getAttribute('data-shape')).toBe('chip');
  });
});
