import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import {
  MEMBER_ERROR_COPY,
  MEMBERS_COPY,
  SIMS_COPY,
  SIM_TITLE_MAX,
  membersRemoveNamed,
  membersResendNamed,
  membersRevokeNamed,
  membersSummaryCount
} from '$lib/members/copy';
import { enhanced } from '../../../test-stubs/app/forms';
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
    canInviteByEmail: true,
    ...over
  };
}

/** Render the page with the Members disclosure open (its content is hidden while closed). */
async function show(d: Record<string, unknown>) {
  const screen = await render(Page, { data: d } as never);
  screen.container.querySelector<HTMLDetailsElement>('[data-testid="members"]')!.open = true;
  return screen;
}

const JSON_ONLY = { 'content-type': 'application/json' };

/** True when `a` comes before `b` in document order. */
const before = (a: Element, b: Element) =>
  !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

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

  it('a refused invite shows the line for its code under the title, before the buttons', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ code: 'already_invited' }), { status: 400 }))
    );
    const screen = await show(data());
    await screen.getByPlaceholder(MEMBERS_COPY.membersInvitePlaceholder).fill('guest@x.test');
    await screen.getByRole('button', { name: MEMBERS_COPY.membersInvite }).click();
    const status = screen.getByTestId('members-status');
    await expect.element(status).toHaveTextContent(MEMBER_ERROR_COPY.already_invited);
    await expect.element(status).toHaveAttribute('data-tone', 'error');
    const heading = screen.getByRole('heading', { level: 1 }).element();
    expect(before(heading, status.element())).toBe(true);
    for (const b of screen.container.querySelectorAll('button')) {
      expect(before(status.element(), b)).toBe(true);
    }
  });

  it('never shows text the server sent, only the line for a known code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: 'D1_ERROR', error: 'D1_ERROR: locked' }), {
            status: 400
          })
      )
    );
    const screen = await show(data());
    await screen.getByPlaceholder(MEMBERS_COPY.membersInvitePlaceholder).fill('@nora');
    await screen.getByRole('button', { name: MEMBERS_COPY.membersInvite }).click();
    await expect
      .element(screen.getByTestId('members-status'))
      .toHaveTextContent(MEMBER_ERROR_COPY.failed);
    expect(screen.container.textContent).not.toContain('D1');
  });

  it('a 429 shows the rate-limit line', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: 'Slow down' }), { status: 429 }))
    );
    const screen = await show(data());
    await screen.getByPlaceholder(MEMBERS_COPY.membersInvitePlaceholder).fill('@nora');
    await screen.getByRole('button', { name: MEMBERS_COPY.membersInvite }).click();
    await expect
      .element(screen.getByTestId('members-status'))
      .toHaveTextContent(MEMBER_ERROR_COPY.rate_limited);
  });

  it('the status line is mounted, empty, before anything happens', async () => {
    const screen = await show(data());
    const status = screen.getByTestId('members-status').element();
    expect(status.getAttribute('role')).toBe('status');
    expect(status.textContent?.trim()).toBe('');
  });

  it('a manager with no confirmed email gets the handle-only invite field', async () => {
    const screen = await show(data({ canInviteByEmail: false }));
    await expect
      .element(screen.getByTestId('invite-input'))
      .toHaveAttribute('placeholder', MEMBERS_COPY.membersInviteHandlePlaceholder);
  });

  it('remove sends a body-less JSON DELETE and drops the row', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const screen = await show(data());
    await screen.getByRole('button', { name: membersRemoveNamed('eddie') }).click();
    expect(fetchMock).not.toHaveBeenCalled();
    await screen.getByTestId('members-confirm').click();
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
    expect(fetchMock).not.toHaveBeenCalled();
    await screen.getByTestId('members-confirm').click();
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
    await expect
      .element(screen.getByTestId('members-status'))
      .toHaveTextContent(MEMBERS_COPY.membersResent);
    expect(fetchMock).toHaveBeenCalledWith('/api/sims/s1/invites/i1/resend', {
      method: 'POST',
      headers: JSON_ONLY
    });
  });

  it.each(['manager', 'editor'])('a %s gets the Rename disclosure, closed', async (role) => {
    const screen = await render(Page, { data: data({ role }) } as never);
    const rename = screen.getByTestId('rename');
    await expect.element(rename).toBeInTheDocument();
    expect((rename.element() as HTMLDetailsElement).open).toBe(false);
    await expect
      .element(rename.getByText(SIMS_COPY.renameSummary, { exact: true }))
      .toBeInTheDocument();
    await rename.getByText(SIMS_COPY.renameSummary, { exact: true }).click();
    const input = screen.getByLabelText(SIMS_COPY.renameLabel, { exact: true });
    await expect.element(input).toHaveAttribute('id', 'sim-name');
    await expect.element(input).toHaveAttribute('name', 'name');
    await expect.element(input).toHaveAttribute('maxlength', String(SIM_TITLE_MAX));
    await expect.element(input).toHaveValue('Garden');
    await expect
      .element(screen.getByRole('button', { name: SIMS_COPY.renameSave }))
      .toBeInTheDocument();
  });

  it('a viewer gets no Rename disclosure', async () => {
    const screen = await render(Page, {
      data: data({ role: 'viewer', currentUserId: 'u2', pendingInvites: [] })
    } as never);
    expect(screen.container.querySelector('[data-testid="rename"]')).toBeNull();
    expect(screen.container.querySelector('#sim-name')).toBeNull();
  });

  it('a rename error opens the disclosure and shows the line by the field', async () => {
    const screen = await render(Page, {
      data: data(),
      form: { renameError: SIMS_COPY.renameBusy }
    } as never);
    expect((screen.getByTestId('rename').element() as HTMLDetailsElement).open).toBe(true);
    await expect
      .element(screen.getByTestId('sim-name-error'))
      .toHaveTextContent(SIMS_COPY.renameBusy);
    await expect
      .element(screen.getByLabelText(SIMS_COPY.renameLabel, { exact: true }))
      .toHaveAttribute('aria-describedby', 'sim-name-error');
  });

  it('a refused rename keeps the submitted name in the field, and Save stays in line with it', async () => {
    const screen = await render(Page, {
      data: data(),
      form: { renameError: SIMS_COPY.nameRequired, name: 'Garden plots' }
    } as never);
    const input = screen.getByLabelText(SIMS_COPY.renameLabel, { exact: true });
    await expect.element(input).toHaveValue('Garden plots');
    await expect.element(screen.getByTestId('sim-name-error')).toBeInTheDocument();
    const field = input.element().getBoundingClientRect();
    const save = screen.getByRole('button', { name: SIMS_COPY.renameSave }).element();
    const button = save.getBoundingClientRect();
    expect(Math.abs(button.top + button.height / 2 - (field.top + field.height / 2))).toBeLessThan(
      1
    );
  });

  it('an accepted rename closes the disclosure; a refused one leaves it open', async () => {
    const screen = await render(Page, { data: data() } as never);
    const box = screen.getByTestId('rename').element() as HTMLDetailsElement;
    const form = box.querySelector('form')!;
    const submit = enhanced.get(form) as () => (opts: {
      result: { type: string };
      update: () => Promise<void>;
    }) => Promise<void>;
    const update = vi.fn(async () => {});
    box.open = true;
    await submit()({ result: { type: 'failure' }, update });
    expect(box.open).toBe(true);
    await submit()({ result: { type: 'redirect' }, update });
    expect(box.open).toBe(false);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('a failed remove keeps the row and shows the generic line', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 500 }))
    );
    const screen = await show(data());
    await screen.getByRole('button', { name: membersRemoveNamed('eddie') }).click();
    await screen.getByTestId('members-confirm').click();
    await expect
      .element(screen.getByTestId('members-status'))
      .toHaveTextContent(MEMBER_ERROR_COPY.failed);
    expect(screen.container.textContent).toContain('@eddie');
  });
});
