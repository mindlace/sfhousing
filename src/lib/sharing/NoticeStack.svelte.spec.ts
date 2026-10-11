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

  it('renders each notice text as a status', async () => {
    const notices: Notice[] = [
      { id: 'n1', text: 'First notice' },
      { id: 'n3', text: 'Second notice' }
    ];
    render(NoticeStack, { notices, ondismiss: () => {} });
    await expect.element(page.getByText('First notice')).toBeVisible();
    await expect.element(page.getByText('Second notice')).toBeVisible();
    expect(page.getByRole('status').elements()).toHaveLength(2);
  });

  it('renders nothing visible with no notices', async () => {
    render(NoticeStack, { notices: [], ondismiss: () => {} });
    expect(page.getByRole('button', { name: 'Dismiss' }).elements()).toHaveLength(0);
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
