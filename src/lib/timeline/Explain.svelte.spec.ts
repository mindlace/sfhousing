/// <reference types="@vitest/browser-playwright" />
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import ExplainHost from './test/ExplainHost.svelte';
import { FORECAST_NOTE } from './copy';

const TEXT = FORECAST_NOTE;
const target = () => page.getByRole('button', { name: 'Target' });
const focusTarget = (el: HTMLElement) => el.focus();

describe('Explain', () => {
  it('shows nothing at rest, the text on hover, focus and tap', async () => {
    await render(ExplainHost, { props: { text: TEXT } });
    await expect.element(page.getByText(TEXT)).not.toBeInTheDocument();
    await target().hover();
    await expect.element(page.getByText(TEXT)).toBeVisible();
    await page.getByRole('button', { name: 'After' }).hover();
    await expect.element(page.getByText(TEXT)).not.toBeInTheDocument();
    focusTarget(target().element() as HTMLElement);
    await expect.element(target()).toHaveFocus();
    await expect.element(page.getByText(TEXT)).toBeVisible();
    await userEvent.tab();
    await expect.element(page.getByText(TEXT)).not.toBeInTheDocument();
    await target().click();
    await expect.element(page.getByText(TEXT)).toBeVisible();
    await expect.element(target()).toHaveAttribute('aria-expanded', 'true');
  });

  it('stays while the pointer moves onto the explanation', async () => {
    await render(ExplainHost, { props: { text: TEXT } });
    await target().hover();
    await page.getByText(TEXT).hover();
    await expect.element(page.getByText(TEXT)).toBeVisible();
    await page.getByRole('button', { name: 'After' }).hover();
    await expect.element(page.getByText(TEXT)).not.toBeInTheDocument();
  });

  it('closes on Escape and returns nothing to the tab order', async () => {
    await render(ExplainHost, { props: { text: TEXT } });
    focusTarget(target().element() as HTMLElement);
    await expect.element(page.getByText(TEXT)).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByText(TEXT)).not.toBeInTheDocument();
    await expect.element(target()).toHaveFocus();
    await expect.element(target()).toHaveAttribute('aria-expanded', 'false');
    await userEvent.tab();
    await expect.element(page.getByRole('button', { name: 'After' })).toHaveFocus();
  });

  it('describes its target while open', async () => {
    await render(ExplainHost, { props: { text: TEXT } });
    await expect.element(target()).not.toHaveAttribute('aria-describedby');
    await target().hover();
    const id = target().element().getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)?.textContent).toBe(TEXT);
  });

  it('wraps a focusable child without adding a button', async () => {
    await render(ExplainHost, { props: { text: TEXT, as: 'wrap' } });
    focusTarget(page.getByRole('link', { name: 'Target' }).element() as HTMLElement);
    await expect.element(page.getByRole('link', { name: 'Target' })).toHaveFocus();
    await expect.element(page.getByText(TEXT)).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Target' })).not.toBeInTheDocument();
    const id = page.getByRole('link').element().getAttribute('aria-describedby');
    expect(document.getElementById(id!)?.textContent).toBe(TEXT);
  });

  it('names a button by label when given', async () => {
    await render(ExplainHost, { props: { text: TEXT, label: 'About the forecast' } });
    await expect
      .element(page.getByRole('button', { name: 'About the forecast' }))
      .toBeInTheDocument();
  });

  it('closes on Escape when opened by hover with focus elsewhere', async () => {
    await render(ExplainHost, { props: { text: TEXT } });
    await target().hover();
    await expect.element(page.getByText(TEXT)).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByText(TEXT)).not.toBeInTheDocument();
  });

  it('opens on a touch tap and closes on the second', async () => {
    await render(ExplainHost, { props: { text: TEXT } });
    const el = target().element() as HTMLElement;
    const tap = () => {
      el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
      el.focus();
      el.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true }));
    };
    tap();
    await expect.element(page.getByText(TEXT)).toBeVisible();
    tap();
    await expect.element(page.getByText(TEXT)).not.toBeInTheDocument();
  });

  it("marks the open text, and adds to the child's own description instead of replacing it", async () => {
    await render(ExplainHost, { props: { text: TEXT, as: 'wrap', own: 'Its own' } });
    const link = page.getByRole('link', { name: 'Target' });
    const el = () => link.element() as HTMLElement;
    expect(document.querySelector('[data-explain-open]')).toBeNull();
    expect(el().getAttribute('aria-describedby')).toBe('own-d');
    focusTarget(el());
    await expect.element(page.getByText(TEXT)).toBeVisible();
    expect(document.querySelector('[data-explain-open]')!.textContent).toContain(TEXT);
    await expect.element(link).toHaveAccessibleDescription(`Its own ${TEXT}`);
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByText(TEXT)).not.toBeInTheDocument();
    expect(document.querySelector('[data-explain-open]')).toBeNull();
    expect(el().getAttribute('aria-describedby')).toBe('own-d');
  });
});
