import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushSync } from 'svelte';
import { render } from 'vitest-browser-svelte';
import DeleteAccountPane from './DeleteAccountPane.svelte';
import { ACCOUNT_COPY } from '$lib/account/account-copy';

const onDeleted = vi.fn(async () => {});

beforeEach(() => {
  vi.restoreAllMocks();
  onDeleted.mockClear();
});

// The ported first case also asserted that clearCheckpointCache ran before the navigation;
// the checkpoint cache is cut, so the case keeps the disabled-until-match and navigates
// through the callback prop.
describe('DeleteAccountPane', () => {
  it('keeps confirm disabled until the handle matches, then deletes and calls onDeleted', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const screen = await render(DeleteAccountPane, { user: { handle: 'ada' }, onDeleted });
    await screen.getByRole('button', { name: ACCOUNT_COPY.deleteButton }).click();
    const confirm = screen.getByRole('button', { name: ACCOUNT_COPY.deletePermanently });
    await expect.element(confirm).toBeDisabled();
    await screen.getByLabelText(ACCOUNT_COPY.deleteConfirmLabel).fill('ada');
    await expect.element(confirm).not.toBeDisabled();
    await confirm.click();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/account',
      expect.objectContaining({
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmHandle: 'ada' })
      })
    );
    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
  });

  it('a failed delete shows the server error associated to the confirm field and does not navigate', async () => {
    expect.hasAssertions();
    const serverError = ACCOUNT_COPY.handleMismatch;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ deleteError: serverError }), { status: 400 })
    );
    const screen = await render(DeleteAccountPane, { user: { handle: 'ada' }, onDeleted });
    await screen.getByRole('button', { name: ACCOUNT_COPY.deleteButton }).click();
    const input = screen.getByLabelText(ACCOUNT_COPY.deleteConfirmLabel);
    await input.fill('ada');
    const { container } = screen;
    const inputEl = container.querySelector('#confirmHandle') as HTMLInputElement;
    const submitBtn = container.querySelector('button[type="submit"]') as HTMLElement;
    await submitBtn.click();
    await expect.element(screen.getByText(serverError)).toBeVisible();
    expect(onDeleted).not.toHaveBeenCalled();
    await expect.poll(() => inputEl.getAttribute('aria-invalid')).toBe('true');
    expect(inputEl.getAttribute('aria-describedby')).toBe('confirmHandle-error');
  });

  it('revealing the confirm UI focuses the confirm-handle field (autocomplete off)', async () => {
    expect.hasAssertions();
    const { container } = await render(DeleteAccountPane, { user: { handle: 'ada' }, onDeleted });
    (container.querySelector('button[type="button"]') as HTMLElement).click();
    flushSync();
    const input = container.querySelector('#confirmHandle')!;
    expect(input.getAttribute('autocomplete')).toBe('off');
    await expect.poll(() => document.activeElement).toBe(input);
  });

  it('cancel returns focus to the delete trigger', async () => {
    expect.hasAssertions();
    const { container } = await render(DeleteAccountPane, { user: { handle: 'ada' }, onDeleted });
    (container.querySelector('button[type="button"]') as HTMLElement).click();
    flushSync();
    (container.querySelector('button[type="button"]') as HTMLElement).click();
    flushSync();
    await expect
      .poll(() => (document.activeElement as HTMLElement)?.textContent?.trim())
      .toBe(ACCOUNT_COPY.deleteButton);
  });

  it('shows the permanent-deletion line with the handle once revealed', async () => {
    const screen = await render(DeleteAccountPane, { user: { handle: 'ada' }, onDeleted });
    await screen.getByRole('button', { name: ACCOUNT_COPY.deleteButton }).click();
    await expect.element(screen.getByText(/@ada/).first()).toBeVisible();
  });

  async function startDelete() {
    const screen = await render(DeleteAccountPane, { user: { handle: 'ada' }, onDeleted });
    await screen.getByRole('button', { name: ACCOUNT_COPY.deleteButton }).click();
    await screen.getByLabelText(ACCOUNT_COPY.deleteConfirmLabel).fill('ada');
    await screen.getByRole('button', { name: ACCOUNT_COPY.deletePermanently }).click();
    return screen;
  }

  it('sends one request; a 200 calls onDeleted', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await startDelete();
    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('any 2xx ends the deletion after one request', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ more: true }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await startDelete();
    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('a 400 shows the mismatch text', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 400 }));
    const screen = await startDelete();
    await expect.element(screen.getByText(ACCOUNT_COPY.handleMismatch)).toBeVisible();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('a 500 shows the network text', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 500 }));
    const screen = await startDelete();
    await expect.element(screen.getByText(ACCOUNT_COPY.networkError)).toBeVisible();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(onDeleted).not.toHaveBeenCalled();
    await expect
      .element(screen.getByRole('button', { name: ACCOUNT_COPY.deletePermanently }))
      .not.toHaveAttribute('aria-busy');
  });

  it('a 401 shows the network text and does not report deleted', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 401 }));
    const screen = await startDelete();
    await expect.element(screen.getByText(ACCOUNT_COPY.networkError)).toBeVisible();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('a thrown fetch shows the network text', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('offline'));
    const screen = await startDelete();
    await expect.element(screen.getByText(ACCOUNT_COPY.networkError)).toBeVisible();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('describes what deletion removes', async () => {
    expect(ACCOUNT_COPY.deleteDescription).toBe(
      'Deletes your account and the games saved to it. Published plans and policies stay. This cannot be undone.'
    );
    const screen = await render(DeleteAccountPane, { user: { handle: 'ada' }, onDeleted });
    await expect.element(screen.getByText(ACCOUNT_COPY.deleteDescription)).toBeVisible();
  });
});
