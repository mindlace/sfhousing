import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import NoticeStack from './NoticeStack.svelte';

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
    expect(document.querySelector('.notice-stack ul, .notice-stack li')).toBeNull();
  });

  it('the status region is mounted before any notice arrives, and keeps the node', async () => {
    const { rerender } = await render(NoticeStack, { notices: [], ondismiss: () => {} });
    const status = page.getByRole('status');
    await expect.element(status).toBeInTheDocument();
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
});
