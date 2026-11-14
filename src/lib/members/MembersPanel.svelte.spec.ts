import { render } from 'vitest-browser-svelte';
import { describe, it, expect, vi } from 'vitest';
import '../../routes/layout.css';
import MembersPanel from './MembersPanel.svelte';
import {
  MEMBERS_COPY,
  membersRemoveConfirm,
  membersRemoveNamed,
  membersResendNamed,
  membersRevokeConfirm,
  membersRevokeNamed
} from './copy';
import { userEvent } from 'vitest/browser';

const MANAGER_ROLE_DISPLAY = '· manager';

const members = [
  { userId: 'owner1', handle: 'owner', role: 'manager' },
  { userId: 'm2', handle: 'mara', role: 'editor' }
];

const maraHandleDisplay = `@${members[1].handle}`;
const ownerHandleDisplay = `@${members[0].handle}`;

const enhance = () => ({ destroy() {} });

describe('MembersPanel', () => {
  it('manager sees invite input, roles, and pending with disabled resend', async () => {
    const screen = await render(MembersPanel, {
      members: [{ userId: 'o', handle: 'owner', role: 'manager' }],
      isManager: true,
      pending: [{ id: 'i1', display: '@noemail', invitedByEmail: false }]
    });
    await expect
      .element(screen.getByPlaceholder(MEMBERS_COPY.membersInvitePlaceholder))
      .toBeInTheDocument();
    await expect.element(screen.getByText(MANAGER_ROLE_DISPLAY)).toBeInTheDocument();
    await expect
      .element(screen.getByRole('button', { name: membersResendNamed('@noemail') }))
      .toBeDisabled();
  });

  it('non-manager sees handles only, no input or roles', async () => {
    const screen = await render(MembersPanel, {
      members: [{ userId: 'o', handle: 'owner', role: 'manager' }],
      isManager: false
    });
    expect(screen.container.querySelector('input')).toBeNull();
    expect(screen.container.textContent).not.toContain(MANAGER_ROLE_DISPLAY);
    await expect.element(screen.getByText(ownerHandleDisplay)).toBeInTheDocument();
  });

  it('non-manager sees no pending invitations even when given some', async () => {
    const screen = await render(MembersPanel, {
      members,
      isManager: false,
      pending: [{ id: 'i1', display: 'secret@x.com', invitedByEmail: true }]
    });
    expect(screen.container.textContent).not.toContain('secret@x.com');
    expect(screen.container.textContent).not.toContain(MEMBERS_COPY.membersPending);
  });

  it('lists members by @handle', async () => {
    const screen = await render(MembersPanel, { members, isManager: true });
    await expect.element(screen.getByText(maraHandleDisplay)).toBeInTheDocument();
  });

  it('fires onInvite with the trimmed target and clears the field', async () => {
    const onInvite = vi.fn();
    const screen = await render(MembersPanel, { members, isManager: true, onInvite });
    const input = screen.getByPlaceholder(MEMBERS_COPY.membersInvitePlaceholder);
    await input.fill('  @newbie  ');
    await screen.getByRole('button', { name: MEMBERS_COPY.membersInvite }).click();
    expect(onInvite).toHaveBeenCalledWith('@newbie');
    await expect.element(input).toHaveValue('');
  });

  it('does not fire onInvite for an empty target', async () => {
    const onInvite = vi.fn();
    const screen = await render(MembersPanel, { members, isManager: true, onInvite });
    await screen.getByRole('button', { name: MEMBERS_COPY.membersInvite }).click();
    expect(onInvite).not.toHaveBeenCalled();
  });

  it('offers Remove for a non-manager member only, and removes only after the confirm', async () => {
    const onRemove = vi.fn();
    const screen = await render(MembersPanel, { members, isManager: true, onRemove });
    expect(
      screen.container.querySelector(`[aria-label="${membersRemoveNamed('owner')}"]`)
    ).toBeNull();
    await screen.getByRole('button', { name: membersRemoveNamed('mara') }).click();
    expect(onRemove).not.toHaveBeenCalled();
    await expect.element(screen.getByText(membersRemoveConfirm('mara'))).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: MEMBERS_COPY.membersRemove, exact: true });
    await expect.element(confirm).toHaveFocus();
    await confirm.click();
    expect(onRemove).toHaveBeenCalledWith('m2');
  });

  it('Cancel on the remove confirm restores the control and returns focus to it', async () => {
    const onRemove = vi.fn();
    const screen = await render(MembersPanel, { members, isManager: true, onRemove });
    await screen.getByRole('button', { name: membersRemoveNamed('mara') }).click();
    await screen.getByRole('button', { name: MEMBERS_COPY.membersConfirmCancel }).click();
    const trigger = screen.getByRole('button', { name: membersRemoveNamed('mara') });
    await expect.element(trigger).toHaveFocus();
    expect(screen.container.textContent).not.toContain(membersRemoveConfirm('mara'));
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('Escape on the remove confirm restores the control and returns focus to it', async () => {
    const onRemove = vi.fn();
    const screen = await render(MembersPanel, { members, isManager: true, onRemove });
    await screen.getByRole('button', { name: membersRemoveNamed('mara') }).click();
    await expect.element(screen.getByTestId('members-confirm')).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await expect
      .element(screen.getByRole('button', { name: membersRemoveNamed('mara') }))
      .toHaveFocus();
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('the remove control is at least 24px square', async () => {
    const screen = await render(MembersPanel, { members, isManager: true });
    const r = screen
      .getByRole('button', { name: membersRemoveNamed('mara') })
      .element()
      .getBoundingClientRect();
    expect(r.width).toBeGreaterThanOrEqual(24);
    expect(r.height).toBeGreaterThanOrEqual(24);
  });

  it('a manager with no confirmed email is offered handle invites only', async () => {
    const screen = await render(MembersPanel, {
      members,
      isManager: true,
      canInviteByEmail: false
    });
    const input = screen.getByTestId('invite-input');
    await expect
      .element(input)
      .toHaveAttribute('placeholder', MEMBERS_COPY.membersInviteHandlePlaceholder);
    await expect
      .element(input)
      .toHaveAttribute('aria-label', MEMBERS_COPY.membersInviteHandleLabel);
  });

  it('manager: resend enabled when invitedByEmail; revoke fires', async () => {
    const onResend = vi.fn();
    const onRevoke = vi.fn();
    const screen = await render(MembersPanel, {
      members,
      isManager: true,
      pending: [{ id: 'i9', display: 'a@x.com', invitedByEmail: true }],
      onResend,
      onRevoke
    });
    await screen.getByRole('button', { name: membersResendNamed('a@x.com') }).click();
    expect(onResend).toHaveBeenCalledWith('i9');
    await screen.getByRole('button', { name: membersRevokeNamed('a@x.com') }).click();
    expect(onRevoke).not.toHaveBeenCalled();
    await expect.element(screen.getByText(membersRevokeConfirm('a@x.com'))).toBeInTheDocument();
    const confirm = screen.getByTestId('members-confirm');
    await expect.element(confirm).toHaveFocus();
    await confirm.click();
    expect(onRevoke).toHaveBeenCalledWith('i9');
  });

  it('Escape on the revoke confirm restores the control and returns focus to it', async () => {
    const onRevoke = vi.fn();
    const screen = await render(MembersPanel, {
      members,
      isManager: true,
      pending: [{ id: 'i9', display: 'a@x.com', invitedByEmail: true }],
      onRevoke
    });
    await screen.getByRole('button', { name: membersRevokeNamed('a@x.com') }).click();
    await expect.element(screen.getByTestId('members-confirm')).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await expect
      .element(screen.getByRole('button', { name: membersRevokeNamed('a@x.com') }))
      .toHaveFocus();
    expect(onRevoke).not.toHaveBeenCalled();
  });

  it('invite input has a programmatic label', async () => {
    const screen = await render(MembersPanel, { members, isManager: true });
    const input = screen.container.querySelector('[data-testid="invite-input"]')!;
    expect(input.getAttribute('aria-label')).toBe(MEMBERS_COPY.membersInviteLabel);
  });

  it('row actions name their target', async () => {
    const screen = await render(MembersPanel, {
      members: [{ userId: 'u2', handle: 'bo', role: 'editor' }],
      pending: [{ id: 'i1', display: 'x@y.z', invitedByEmail: true }],
      isManager: true
    });
    expect(
      screen.container.querySelector(`[aria-label="${membersRemoveNamed('bo')}"]`)
    ).not.toBeNull();
    expect(
      screen.container.querySelector(`[aria-label="${membersResendNamed('x@y.z')}"]`)
    ).not.toBeNull();
    expect(
      screen.container.querySelector(`[aria-label="${membersRevokeNamed('x@y.z')}"]`)
    ).not.toBeNull();
  });
});

describe('MembersPanel leave control', () => {
  const twoMembers = [
    { userId: 'u1', handle: 'me', role: 'viewer' },
    { userId: 'u2', handle: 'owner', role: 'manager' }
  ];

  it('shows a Leave control when currentUserId is set and members > 1', async () => {
    const screen = await render(MembersPanel, {
      members: twoMembers,
      isManager: false,
      currentUserId: 'u1',
      simId: 's1',
      simTitle: 'My Sim',
      enhance
    });
    await expect
      .element(screen.getByRole('button', { name: MEMBERS_COPY.leaveButton }))
      .toBeInTheDocument();
  });

  it('shows a Leave control when the viewer is the only member (leaving deletes the sim)', async () => {
    const screen = await render(MembersPanel, {
      members: [{ userId: 'u1', handle: 'me', role: 'manager' }],
      isManager: true,
      currentUserId: 'u1',
      simId: 's1',
      simTitle: 'My Sim',
      enhance
    });
    await expect
      .element(screen.getByRole('button', { name: MEMBERS_COPY.leaveButton }))
      .toBeInTheDocument();
  });

  it('posts the leave form to the sim page leaveSim action', async () => {
    const screen = await render(MembersPanel, {
      members: twoMembers,
      isManager: false,
      currentUserId: 'u1',
      simId: 's1',
      simTitle: 'My Sim',
      enhance
    });
    await screen.getByRole('button', { name: MEMBERS_COPY.leaveButton }).click();
    expect(screen.container.querySelector('form')!.getAttribute('action')).toBe(
      '/sims/s1?/leaveSim'
    );
  });

  it('shows no Leave control when currentUserId is absent', async () => {
    const screen = await render(MembersPanel, { members: twoMembers, isManager: false });
    await expect.element(screen.getByText(MEMBERS_COPY.leaveButton)).not.toBeInTheDocument();
  });
});
