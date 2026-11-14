import { render } from 'vitest-browser-svelte';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import InvitationsList from './InvitationsList.svelte';
import {
  MEMBERS_COPY,
  invitationsAcceptNamed,
  invitationsDeclineNamed,
  invitationsRow
} from './copy';

const invite = {
  id: 'inv1',
  simId: 's1',
  simTitle: 'Build a deck',
  inviterHandle: 'mara'
};

/** True when `a` comes before `b` in document order. */
const before = (a: Element, b: Element) =>
  !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('InvitationsList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders the invitation row with named accept/decline actions', async () => {
    const screen = await render(InvitationsList, { invitations: [invite], onaccepted: vi.fn() });
    expect(screen.container.textContent).toContain(invitationsRow('mara', 'Build a deck'));
    await expect
      .element(screen.getByRole('button', { name: invitationsAcceptNamed('Build a deck') }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole('button', { name: invitationsDeclineNamed('Build a deck') }))
      .toBeInTheDocument();
  });

  it('renders nothing for an empty list', async () => {
    const screen = await render(InvitationsList, { invitations: [], onaccepted: vi.fn() });
    expect(screen.container.textContent).not.toContain(MEMBERS_COPY.invitationsHeading);
    expect(screen.container.querySelector('section')).toBeNull();
  });

  it('mounts its status line, empty, before anything happens', async () => {
    const screen = await render(InvitationsList, { invitations: [invite], onaccepted: vi.fn() });
    const status = screen.getByTestId('invitations-status').element();
    expect(status.getAttribute('role')).toBe('status');
    expect(status.textContent?.trim()).toBe('');
  });

  it('accept posts JSON with no body and calls onaccepted with the sim id', async () => {
    expect.hasAssertions();
    const fetchMock = vi.fn(async () => new Response('{"simId":"s1"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const onaccepted = vi.fn();
    const screen = await render(InvitationsList, { invitations: [invite], onaccepted });
    await screen.getByRole('button', { name: invitationsAcceptNamed('Build a deck') }).click();
    await vi.waitFor(() => expect(onaccepted).toHaveBeenCalledWith('s1'));
    expect(fetchMock).toHaveBeenCalledWith('/api/invites/inv1/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' }
    });
  });

  it('a failed accept says so and does not call onaccepted', async () => {
    expect.hasAssertions();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 400 }))
    );
    const onaccepted = vi.fn();
    const screen = await render(InvitationsList, { invitations: [invite], onaccepted });
    await screen.getByRole('button', { name: invitationsAcceptNamed('Build a deck') }).click();
    const status = screen.getByTestId('invitations-status');
    await expect.element(status).toHaveTextContent(MEMBERS_COPY.invitationsAcceptFailedToast);
    // Under the heading, before every button.
    const heading = screen.getByRole('heading', { name: MEMBERS_COPY.invitationsHeading });
    expect(before(heading.element(), status.element())).toBe(true);
    for (const b of screen.container.querySelectorAll('button')) {
      expect(before(status.element(), b)).toBe(true);
    }
    expect(onaccepted).not.toHaveBeenCalled();
  });

  it('a successful decline posts JSON, says so and removes the row locally', async () => {
    expect.hasAssertions();
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const screen = await render(InvitationsList, { invitations: [invite], onaccepted: vi.fn() });
    await screen.getByRole('button', { name: invitationsDeclineNamed('Build a deck') }).click();
    await expect
      .element(screen.getByTestId('invitations-status'))
      .toHaveTextContent(MEMBERS_COPY.invitationsDeclinedToast);
    await expect.poll(() => screen.container.textContent).not.toContain(invite.simTitle);
    expect(fetchMock).toHaveBeenCalledWith('/api/invites/inv1/decline', {
      method: 'POST',
      headers: { 'content-type': 'application/json' }
    });
  });

  it('a failed decline keeps the row', async () => {
    expect.hasAssertions();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 500 }))
    );
    const screen = await render(InvitationsList, { invitations: [invite], onaccepted: vi.fn() });
    await screen.getByRole('button', { name: invitationsDeclineNamed('Build a deck') }).click();
    await expect
      .element(screen.getByTestId('invitations-status'))
      .toHaveTextContent(MEMBERS_COPY.invitationsActionFailedToast);
    expect(screen.container.textContent).toContain(invite.simTitle);
  });
});
