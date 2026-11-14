import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ProfilePane from './ProfilePane.svelte';
import { currentUser } from './current-user.svelte';
import { ACCOUNT_COPY } from '$lib/account/account-copy';

const { invalidateAll } = vi.hoisted(() => ({ invalidateAll: vi.fn(async () => {}) }));
vi.mock('$app/navigation', () => ({ invalidateAll }));

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('ProfilePane', () => {
  it('prefills handle and name from user', async () => {
    const screen = await render(ProfilePane, { user: { id: 'u1', handle: 'ada', name: 'Ada L' } });
    await expect.element(screen.getByLabelText(ACCOUNT_COPY.handleLabel)).toHaveValue('ada');
    await expect.element(screen.getByLabelText(ACCOUNT_COPY.displayNameLabel)).toHaveValue('Ada L');
  });

  it('inputs carry identity autocomplete tokens', async () => {
    expect.hasAssertions();
    const { container } = await render(ProfilePane, {
      user: { id: 'u1', handle: 'ada', name: '' }
    });
    expect(container.querySelector('#handle')!.getAttribute('autocomplete')).toBe('username');
    expect(container.querySelector('#name')!.getAttribute('autocomplete')).toBe('name');
  });

  it('a failed save shows the server error associated to the handle field and focuses it', async () => {
    expect.hasAssertions();
    const serverError = 'already taken';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: serverError }), { status: 400 })
    );
    const screen = await render(ProfilePane, {
      user: { id: 'u1', handle: 'ada', name: '' }
    });
    const { container } = screen;
    await (container.querySelector('button[type="submit"]') as HTMLElement).click();
    await expect.element(screen.getByText(serverError)).toBeInTheDocument();
    const input = container.querySelector('#handle') as HTMLInputElement;
    await expect.poll(() => input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('handle-error');
    expect(container.querySelector('#handle-error')).not.toBeNull();
    await expect.poll(() => document.activeElement).toBe(input);
  });

  it('saved confirmation announces via the persistent status node', async () => {
    expect.hasAssertions();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    const { container } = await render(ProfilePane, {
      user: { id: 'u1', handle: 'ada', name: '' }
    });
    await (container.querySelector('button[type="submit"]') as HTMLElement).click();
    const status = container.querySelector('[data-testid="form-status"]') as HTMLElement;
    expect(status.getAttribute('role')).toBe('status');
    await expect.poll(() => status.textContent).toContain(ACCOUNT_COPY.saved);
  });

  it('records the saved handle/name in the current-user overlay, with no page reload', async () => {
    expect.hasAssertions();
    currentUser.handle = null;
    currentUser.name = null;
    invalidateAll.mockClear();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          handleChanged: true,
          oldHandleFreesAt: null,
          handle: 'ada-l',
          name: 'Ada Lovelace'
        }),
        { status: 200 }
      )
    );
    const screen = await render(ProfilePane, { user: { id: 'u1', handle: 'ada', name: 'Ada L' } });
    await screen.getByRole('button', { name: ACCOUNT_COPY.save }).click();
    await expect.element(screen.getByText(ACCOUNT_COPY.saved)).toBeInTheDocument();
    expect(currentUser.handle).toBe('ada-l');
    expect(currentUser.name).toBe('Ada Lovelace');
    // Keyed to the identity it was saved for — never the next account on this document.
    expect(currentUser.handleFor('u1')).toBe('ada-l');
    expect(currentUser.handleFor('u2')).toBeNull();
    expect(invalidateAll).not.toHaveBeenCalled();
  });
});
