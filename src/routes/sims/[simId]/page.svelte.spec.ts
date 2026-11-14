import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import {
  MEMBERS_COPY,
  membersRemoveNamed,
  membersResendNamed,
  membersRevokeNamed,
  membersSummaryCount
} from '$lib/members/copy';
import Page from './+page.svelte';

const members = [
  { userId: 'u1', handle: 'mia', role: 'manager' },
  { userId: 'u2', handle: 'eddie', role: 'editor' }
];

function data(over: Record<string, unknown> = {}) {
  return {
    simId: 's1',
    title: 'Garden',
    role: 'manager',
    currentUserId: 'u1',
    members,
    pendingInvites: [{ id: 'i1', display: 'guest@x.test', invitedByEmail: true }],
    ...over
  };
}

/** Render the page with the Members disclosure open (its content is hidden while closed). */
async function show(d: Record<string, unknown>) {
  const screen = await render(Page, { data: d } as never);
  screen.container.querySelector('details')!.open = true;
  return screen;
}

const JSON_ONLY = { 'content-type': 'application/json' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('/sims/[simId] page', () => {
  it('shows the title and a Members summary with the count', async () => {
    const screen = await show(data());
    await expect.element(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Garden');
    await expect.element(screen.getByText(membersSummaryCount(2))).toBeInTheDocument();
  });

  it('a manager gets the invite field and pending actions', async () => {
    const screen = await show(data());
    expect(screen.container.querySelector('[data-testid="invite-input"]')).not.toBeNull();
    expect(
      screen.container.querySelector(`[aria-label="${membersRevokeNamed('guest@x.test')}"]`)
    ).not.toBeNull();
    expect(
      screen.container.querySelector(`[aria-label="${membersRemoveNamed('eddie')}"]`)
    ).not.toBeNull();
  });

  it('a viewer sees neither the invite field, nor roles, nor remove buttons', async () => {
    const screen = await show(data({ role: 'viewer', currentUserId: 'u2', pendingInvites: [] }));
    expect(screen.container.querySelector('[data-testid="invite-input"]')).toBeNull();
    expect(screen.container.textContent).not.toContain('· manager');
    expect(screen.container.querySelector(`[aria-label^="Remove"]`)).toBeNull();
  });

  it('invite posts JSON with the target and lists the new pending row', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: 'i2', display: '@nora', invitedByEmail: false }), {
          status: 201
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const screen = await show(data());
    await screen.getByPlaceholder(MEMBERS_COPY.membersInvitePlaceholder).fill('@nora');
    await screen.getByRole('button', { name: MEMBERS_COPY.membersInvite }).click();
    await expect.element(screen.getByText('@nora')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/sims/s1/invites', {
      method: 'POST',
      headers: JSON_ONLY,
      body: JSON.stringify({ target: '@nora' })
    });
  });

  it('a refused invite shows the server message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'already invited' }), { status: 400 }))
    );
    const screen = await show(data());
    await screen.getByPlaceholder(MEMBERS_COPY.membersInvitePlaceholder).fill('guest@x.test');
    await screen.getByRole('button', { name: MEMBERS_COPY.membersInvite }).click();
    await expect.element(screen.getByRole('alert')).toHaveTextContent('already invited');
  });

  it('remove sends a body-less JSON DELETE and drops the row', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const screen = await show(data());
    await screen.getByRole('button', { name: membersRemoveNamed('eddie') }).click();
    await expect.poll(() => screen.container.textContent).not.toContain('@eddie');
    expect(fetchMock).toHaveBeenCalledWith('/api/sims/s1/members/u2', {
      method: 'DELETE',
      headers: JSON_ONLY
    });
  });

  it('revoke sends a body-less JSON DELETE and drops the pending row', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const screen = await show(data());
    await screen.getByRole('button', { name: membersRevokeNamed('guest@x.test') }).click();
    await expect.poll(() => screen.container.textContent).not.toContain('guest@x.test');
    expect(fetchMock).toHaveBeenCalledWith('/api/sims/s1/invites/i1', {
      method: 'DELETE',
      headers: JSON_ONLY
    });
  });

  it('resend sends a body-less JSON POST and says it was sent', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const screen = await show(data());
    await screen.getByRole('button', { name: membersResendNamed('guest@x.test') }).click();
    await expect.element(screen.getByRole('status')).toHaveTextContent(MEMBERS_COPY.membersResent);
    expect(fetchMock).toHaveBeenCalledWith('/api/sims/s1/invites/i1/resend', {
      method: 'POST',
      headers: JSON_ONLY
    });
  });

  it('a failed remove keeps the row and shows an alert', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 500 }))
    );
    const screen = await show(data());
    await screen.getByRole('button', { name: membersRemoveNamed('eddie') }).click();
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent(MEMBERS_COPY.membersActionFailed);
    expect(screen.container.textContent).toContain('@eddie');
  });
});
