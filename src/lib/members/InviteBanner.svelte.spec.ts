import { render } from 'vitest-browser-svelte';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import InviteBanner from './InviteBanner.svelte';
import { MEMBERS_COPY, inviteHeading, inviteMultiple } from './copy';

const one = [{ id: 'i1', simId: 's1', simTitle: 'Roadtrip', inviterHandle: 'ada' }];
const three = [
  ...one,
  { id: 'i2', simId: 's2', simTitle: 'Garden', inviterHandle: 'bob' },
  { id: 'i3', simId: 's3', simTitle: 'Move', inviterHandle: 'cy' }
];

describe('InviteBanner', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders nothing, and no live region, on the sims list', async () => {
    const screen = await render(InviteBanner, {
      invites: one,
      path: '/sims',
      onaccepted: vi.fn(),
      onview: vi.fn()
    });
    await expect.element(screen.getByTestId('invite-banner')).toBeEmptyDOMElement();
    expect(screen.container.querySelector('[role="status"], [role="alert"]')).toBeNull();
  });

  it('nests no live region: the wrapper holding the buttons is not one', async () => {
    const screen = await render(InviteBanner, {
      invites: one,
      path: '/sims/s9',
      onaccepted: vi.fn(),
      onview: vi.fn()
    });
    const regions = [...screen.container.querySelectorAll('[role="status"], [role="alert"]')];
    expect(regions).toHaveLength(1);
    expect(regions[0].querySelector('button')).toBeNull();
    expect(regions[0].parentElement?.closest('[role="status"], [role="alert"]')).toBeNull();
  });

  it('one invite: heading with Accept, Decline and Not now', async () => {
    const screen = await render(InviteBanner, {
      invites: one,
      path: '/sims/s9',
      onaccepted: vi.fn(),
      onview: vi.fn()
    });
    await expect.element(screen.getByText(inviteHeading('ada', 'Roadtrip'))).toBeInTheDocument();
    for (const name of [
      MEMBERS_COPY.invitationsAccept,
      MEMBERS_COPY.invitationsDecline,
      MEMBERS_COPY.inviteNotNow
    ]) {
      await expect.element(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('Accept posts JSON with no body and calls onaccepted with the sim id', async () => {
    const fetchMock = vi.fn(async () => new Response('{"simId":"s1"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const onaccepted = vi.fn();
    const screen = await render(InviteBanner, {
      invites: one,
      path: '/sims/s9',
      onaccepted,
      onview: vi.fn()
    });
    await screen.getByRole('button', { name: MEMBERS_COPY.invitationsAccept }).click();
    await vi.waitFor(() => expect(onaccepted).toHaveBeenCalledWith('s1'));
    expect(fetchMock).toHaveBeenCalledWith('/api/invites/i1/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' }
    });
  });

  it('a failed Accept shows its line above the buttons, in the mounted status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 400 }))
    );
    const onaccepted = vi.fn();
    const screen = await render(InviteBanner, {
      invites: one,
      path: '/sims/s9',
      onaccepted,
      onview: vi.fn()
    });
    const status = screen.getByTestId('invite-banner-status');
    await expect.element(status).toBeInTheDocument();
    await screen.getByRole('button', { name: MEMBERS_COPY.invitationsAccept }).click();
    await expect.element(status).toHaveTextContent(MEMBERS_COPY.invitationsAcceptFailedToast);
    for (const b of screen.container.querySelectorAll('button')) {
      expect(
        !!(status.element().compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
      ).toBe(true);
    }
    expect(onaccepted).not.toHaveBeenCalled();
  });

  it('Decline posts JSON and clears the banner', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const screen = await render(InviteBanner, {
      invites: one,
      path: '/sims/s9',
      onaccepted: vi.fn(),
      onview: vi.fn()
    });
    await screen.getByRole('button', { name: MEMBERS_COPY.invitationsDecline }).click();
    await expect
      .element(screen.getByText(inviteHeading('ada', 'Roadtrip')))
      .not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/invites/i1/decline', {
      method: 'POST',
      headers: { 'content-type': 'application/json' }
    });
  });

  it('Not now clears the banner without a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const screen = await render(InviteBanner, {
      invites: one,
      path: '/sims/s9',
      onaccepted: vi.fn(),
      onview: vi.fn()
    });
    await screen.getByRole('button', { name: MEMBERS_COPY.inviteNotNow }).click();
    await expect
      .element(screen.getByText(inviteHeading('ada', 'Roadtrip')))
      .not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('several invites: count with View and Not now; View calls onview', async () => {
    const onview = vi.fn();
    const screen = await render(InviteBanner, {
      invites: three,
      path: '/sims/s9',
      onaccepted: vi.fn(),
      onview
    });
    await expect.element(screen.getByText(inviteMultiple(3))).toBeInTheDocument();
    await screen.getByRole('button', { name: MEMBERS_COPY.inviteView }).click();
    expect(onview).toHaveBeenCalledOnce();
  });
});
