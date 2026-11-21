import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import type { Plan } from '$lib/plan';
import { COPY } from './copy';
import { PLAN_CODEC } from './doc-codec';
import PublishButton from './PublishButton.svelte';

const painted = (): Plan => ({
  schema: 1,
  datasetVersion: 'fixture-0',
  ops: [{ id: 's1', kind: 'paint', stories: 6, radiusM: 20, path: [[-122.4193, 37.76013]] }]
});
const empty = (): Plan => ({ schema: 1, datasetVersion: 'fixture-0', ops: [] });

const opener = () => page.getByTestId('publish-open');
const dialog = () => page.getByRole('dialog');
const tooltip = () => page.getByRole('tooltip');

let rest: HTMLElement | undefined;

/** Renders with the pointer on a neutral element and no explanation open. */
async function renderAtRest(plan: Plan) {
  rest = document.createElement('p');
  rest.textContent = 'Rest';
  document.body.insertBefore(rest, document.body.firstChild);
  const fetchFn = vi.fn() as unknown as typeof fetch;
  const screen = await render(PublishButton, {
    codec: PLAN_CODEC,
    doc: plan,
    onpublished: vi.fn(),
    fetchFn,
    origin: 'https://example.test'
  });
  await expect.element(opener()).toHaveAttribute('data-hashed', 'true');
  await userEvent.hover(page.getByText('Rest', { exact: true }));
  await expect.element(tooltip()).not.toBeInTheDocument();
  return { screen, fetchFn };
}

describe('PublishButton', () => {
  afterEach(() => {
    rest?.remove();
    rest = undefined;
  });

  it('empty: aria-disabled, a press opens no dialog, hover shows "Paint something first."', async () => {
    await renderAtRest(empty());
    const btn = opener();
    await expect.element(btn).toHaveAttribute('aria-disabled', 'true');
    // Not `disabled`: it stays focusable, so its reason can show on focus.
    expect(btn.element().hasAttribute('disabled')).toBe(false);

    // Playwright waits for an aria-disabled element to be enabled: force sends the real click.
    await userEvent.click(btn, { force: true });
    await expect.element(btn).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(dialog().elements()).toHaveLength(0);
    expect(document.querySelector('dialog[open]')).toBeNull();

    await userEvent.hover(page.getByText('Rest', { exact: true }));
    (btn.element() as HTMLElement).blur();
    await expect.element(tooltip()).not.toBeInTheDocument();
    await userEvent.hover(btn);
    await expect.element(tooltip()).toHaveTextContent(COPY.disabledHint);
    await expect.element(tooltip()).toBeVisible();
  });

  it('empty: focus shows the reason and it describes the button', async () => {
    await renderAtRest(empty());
    await userEvent.tab();
    await expect.element(opener()).toHaveFocus();
    await expect.element(tooltip()).toHaveTextContent('Paint something first.');
    await expect.element(tooltip()).toBeVisible();
    await expect.element(opener()).toHaveAccessibleDescription(COPY.disabledHint);
  });

  it('empty: the reason describes the button at rest, and once while it shows', async () => {
    await renderAtRest(empty());
    // No focus, no hover: a browse-mode screen reader still gets the reason.
    expect(document.activeElement).not.toBe(opener().element());
    await expect.element(opener()).toHaveAccessibleDescription(COPY.disabledHint);
    await userEvent.tab();
    await expect.element(tooltip()).toBeVisible();
    // Open, it is still said once, not twice.
    await expect.element(opener()).toHaveAccessibleDescription(COPY.disabledHint);
  });

  it('empty: a press that does not focus (a tap on iOS) focuses it, so the reason shows', async () => {
    await renderAtRest(empty());
    // element.click() moves no focus, as a tap in iOS Safari does not.
    (opener().element() as HTMLElement).click();
    await expect.element(opener()).toHaveFocus();
    await expect.element(tooltip()).toHaveTextContent(COPY.disabledHint);
    expect(document.querySelector('dialog[open]')).toBeNull();
  });

  it('focus stays on the same button when it turns on or off', async () => {
    const { screen } = await renderAtRest(empty());
    const btn = opener().element() as HTMLElement;
    btn.focus();
    await expect.element(opener()).toHaveFocus();
    await screen.rerender({ doc: painted() });
    await expect.element(opener()).not.toHaveAttribute('aria-disabled');
    expect(opener().element()).toBe(btn);
    expect(document.activeElement).toBe(btn);
    expect(tooltip().elements()).toHaveLength(0);
    await screen.rerender({ doc: empty() });
    await expect.element(opener()).toHaveAttribute('aria-disabled', 'true');
    expect(opener().element()).toBe(btn);
    expect(document.activeElement).toBe(btn);
  });

  it('not empty: no aria-disabled, no reason, the press opens the dialog', async () => {
    await renderAtRest(painted());
    const btn = opener();
    expect(btn.element().hasAttribute('aria-disabled')).toBe(false);
    await userEvent.hover(btn);
    await userEvent.tab();
    await expect.element(btn).toHaveFocus();
    expect(tooltip().elements()).toHaveLength(0);
    await expect.element(btn).not.toHaveAccessibleDescription();
    await userEvent.click(btn);
    await expect.element(dialog().getByRole('heading', { name: COPY.dialogHeading })).toBeVisible();
  });
});
