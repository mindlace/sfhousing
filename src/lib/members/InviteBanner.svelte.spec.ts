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

  it('is a status region that is empty when there is nothing to show', async () => {
    const screen = await render(InviteBanner, {
      invites: one,
      path: '/sims',
      onaccepted: vi.fn(),
      onview: vi.fn()
    });
    const region = screen.getByRole('status');
    await expect.element(region).toBeInTheDocument();
    await expect.element(region).toBeEmptyDOMElement();
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

  it('a failed Accept shows an alert', async () => {
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
    await screen.getByRole('button', { name: MEMBERS_COPY.invitationsAccept }).click();
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent(MEMBERS_COPY.invitationsAcceptFailedToast);
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
