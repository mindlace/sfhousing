import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import type { Manifest } from '$lib/data/manifest';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import NoticeStack from './NoticeStack.svelte';
import NoticeStackHost from './test/NoticeStackHost.svelte';

// The host's BrushEditor gets a stub map (no WebGL); NoticeStack alone never renders one.
vi.mock('$lib/map/SimMap.svelte', async () => import('$lib/brush/test/SimMapStub.svelte'));

type Notice = { id: string; text: string; tone?: 'info' | 'toast' };

describe('NoticeStack', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders each notice text inside one status region, with no list semantics', async () => {
    const notices: Notice[] = [
      { id: 'n1', text: 'First notice' },
      { id: 'n3', text: 'Second notice' }
    ];
    render(NoticeStack, { notices, ondismiss: () => {} });
    await expect.element(page.getByText('First notice')).toBeVisible();
    await expect.element(page.getByText('Second notice')).toBeVisible();
    const status = page.getByRole('status');
    expect(status.elements()).toHaveLength(1);
    await expect.element(status).toHaveTextContent('First notice');
    await expect.element(status).toHaveTextContent('Second notice');
    expect(status.element().querySelector('ul, li')).toBeNull();
  });

  it('the status region is mounted before any notice arrives, and keeps the node', async () => {
    const { rerender } = await render(NoticeStack, { notices: [], ondismiss: () => {} });
    // Empty, the `display: contents` region has no box, so a role query does not see it yet.
    const status = page.getByTestId('notice-stack');
    await expect.element(status).toBeInTheDocument();
    await expect.element(status).toHaveAttribute('role', 'status');
    await expect.element(status).toHaveAttribute('aria-live', 'polite');
    await expect.element(status).toHaveTextContent('');
    expect(page.getByRole('button', { name: 'Dismiss' }).elements()).toHaveLength(0);
    const node = status.element();

    await rerender({ notices: [{ id: 'n3', text: 'Arrived later' }], ondismiss: () => {} });
    await expect.element(status).toHaveTextContent('Arrived later');
    expect(status.element()).toBe(node);
  });

  it('each Dismiss button has an accessible name and calls ondismiss(id)', async () => {
    const ondismiss = vi.fn();
    render(NoticeStack, {
      notices: [
        { id: 'a', text: 'Alpha' },
        { id: 'b', text: 'Beta' }
      ],
      ondismiss
    });
    const buttons = page.getByRole('button', { name: 'Dismiss' });
    await expect.element(buttons.nth(1)).toBeVisible();
    expect(buttons.elements()).toHaveLength(2);
    await userEvent.click(buttons.nth(1));
    expect(ondismiss).toHaveBeenCalledWith('b');
    expect(ondismiss).toHaveBeenCalledTimes(1);
  });

  it('a toast auto-dismisses after 8 s; an info notice does not', async () => {
    vi.useFakeTimers();
    const ondismiss = vi.fn();
    render(NoticeStack, {
      notices: [
        { id: 'info', text: 'Stays' },
        { id: 'remix', text: 'Remixed', tone: 'toast' }
      ],
      ondismiss
    });
    await vi.advanceTimersByTimeAsync(7_900);
    expect(ondismiss).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(ondismiss).toHaveBeenCalledTimes(1);
    expect(ondismiss).toHaveBeenCalledWith('remix');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(ondismiss).toHaveBeenCalledTimes(1);
  });

  it("through BrushEditor's `notices` snippet: pills in the one `fzp-notices`, toasts still go after 8 s", async () => {
    await page.viewport(1024, 768);
    // Fake timers before the render: a toast's timer starts when it first appears. No
    // expect.element below: its retries wait on timers.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const ondismiss = vi.fn();
    const text = (t: string) =>
      [...document.querySelectorAll('[data-testid="notice"]')].some((n) =>
        n.textContent?.includes(t)
      );
    render(NoticeStackHost, {
      manifest: manifestJson as unknown as Manifest,
      initial: [
        { id: 'n3', text: 'Rebased notice' },
        { id: 'remix', text: 'Remixed toast', tone: 'toast' }
      ],
      ondismiss
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(text('Rebased notice')).toBe(true);
    // Exactly one notice stack on the page, and both notices are pills inside it, after the brush
    // status; no stack of NoticeStack's own and no toolbar placement.
    const stacks = document.querySelectorAll('[data-testid="fzp-notices"]');
    expect(stacks).toHaveLength(1);
    const notices = [...document.querySelectorAll('[data-testid="notice"]')];
    expect(notices).toHaveLength(2);
    for (const n of notices) expect(stacks[0].contains(n)).toBe(true);
    const status = stacks[0].querySelector('[data-testid="brush-status"]')!;
    expect(
      status.compareDocumentPosition(notices[0]) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(notices[0].className).toContain('rounded-full');
    expect(document.querySelector('.notice-stack')).toBeNull();
    expect(document.documentElement.style.getPropertyValue('--notice-stack-h')).toBe('');

    await vi.advanceTimersByTimeAsync(8_100);
    expect(ondismiss).toHaveBeenCalledWith('remix');
    expect(ondismiss).toHaveBeenCalledTimes(1);
    expect(text('Remixed toast')).toBe(false);
    expect(text('Rebased notice')).toBe(true);
    expect(document.querySelectorAll('[data-testid="fzp-notices"]')).toHaveLength(1);
  });
});
