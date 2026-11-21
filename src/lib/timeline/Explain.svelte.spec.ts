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

  it('an open explanation takes Escape before a container does; a closed one lets it through', async () => {
    await render(ExplainHost, { props: { text: TEXT } });
    let outer = 0;
    const box = target().element().closest('div')!;
    const onkey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') outer++;
    };
    box.addEventListener('keydown', onkey);
    focusTarget(target().element() as HTMLElement);
    await expect.element(page.getByText(TEXT)).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByText(TEXT)).not.toBeInTheDocument();
    expect(outer).toBe(0);
    await userEvent.keyboard('{Escape}');
    expect(outer).toBe(1);
    await expect.element(target()).toHaveFocus();
    box.removeEventListener('keydown', onkey);
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

  it('Escape on a hovered explanation marks the key handled before any window listener sees it', async () => {
    const seen: [string, boolean][] = [];
    await render(ExplainHost, {
      props: { text: TEXT, onwindowkey: (k: string, p: boolean) => seen.push([k, p]) }
    });
    await target().hover();
    await expect.element(page.getByText(TEXT)).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByText(TEXT)).not.toBeInTheDocument();
    expect(seen).toEqual([['Escape', true]]);
  });

  it('Escape with no explanation open leaves the key unhandled', async () => {
    const seen: [string, boolean][] = [];
    await render(ExplainHost, {
      props: { text: TEXT, onwindowkey: (k: string, p: boolean) => seen.push([k, p]) }
    });
    (page.getByRole('button', { name: 'After' }).element() as HTMLElement).focus();
    await userEvent.keyboard('{Escape}');
    expect(seen).toEqual([['Escape', false]]);
  });

  it('closes on Escape when opened by hover with focus elsewhere', async () => {
    await render(ExplainHost, { props: { text: TEXT } });
    await target().hover();
    await expect.element(page.getByText(TEXT)).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByText(TEXT)).not.toBeInTheDocument();
  });

  it('stays dismissed after Escape when a layout change puts it under a resting pointer', async () => {
    await render(ExplainHost, { props: { text: TEXT } });
    focusTarget(target().element() as HTMLElement);
    await expect.element(page.getByText(TEXT)).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByText(TEXT)).not.toBeInTheDocument();
    // The browser's boundary events for a pointer that did not move (WCAG 1.4.13: dismissed until
    // the pointer moves).
    const box = target().element().parentElement!;
    box.dispatchEvent(new PointerEvent('pointerover', { pointerType: 'mouse', bubbles: true }));
    box.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    expect(document.querySelector('[data-explain-open]')).toBeNull();
    // A real move over it opens it again.
    box.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', bubbles: true }));
    await expect.element(page.getByText(TEXT)).toBeVisible();
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

  it('takes out only its own id on close: ids there before and ids set while open stay', async () => {
    await render(ExplainHost, { props: { text: TEXT, as: 'wrap', own: 'Its own' } });
    const el = () => page.getByRole('link', { name: 'Target' }).element() as HTMLElement;
    const ids = () => el().getAttribute('aria-describedby')!.split(' ');
    focusTarget(el());
    const tip = page.getByRole('tooltip');
    await expect.element(tip).toBeVisible();
    expect(ids()).toEqual(['own-d', tip.element().id]);
    // An id added while open (another owner writing the attribute) survives the close.
    el().setAttribute('aria-describedby', `${el().getAttribute('aria-describedby')} late-d`);
    await userEvent.keyboard('{Escape}');
    await expect.element(tip).not.toBeInTheDocument();
    expect(ids()).toEqual(['own-d', 'late-d']);
    // A value replaced outright while open (as a framework sets it) is kept as it is.
    el().blur();
    focusTarget(el());
    await expect.element(page.getByRole('tooltip')).toBeVisible();
    el().setAttribute('aria-describedby', 'late-d');
    await userEvent.tab();
    await expect.element(page.getByRole('tooltip')).not.toBeInTheDocument();
    expect(el().getAttribute('aria-describedby')).toBe('late-d');
  });
});
