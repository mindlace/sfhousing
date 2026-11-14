import { render } from 'vitest-browser-svelte';
import { describe, it, expect, vi } from 'vitest';
import { flushSync } from 'svelte';
import LeaveSimConfirm from './LeaveSimConfirm.svelte';
import { MEMBER_ERROR_COPY, MEMBERS_COPY } from './copy';

// The route passes SvelteKit's `enhance`; here a stand-in stops the real submit and drives
// the submit callback with a chosen result.
const update = vi.fn(async () => {});
function enhanceWith(result: { type: string; data?: unknown }) {
  return (
    form: HTMLFormElement,
    submitFn: (input: unknown) => (arg: { result: unknown; update: () => Promise<void> }) => unknown
  ) => {
    const handler = (e: Event) => {
      e.preventDefault();
      void submitFn({})({ result, update });
    };
    form.addEventListener('submit', handler);
    return { destroy: () => form.removeEventListener('submit', handler) };
  };
}
const enhance = enhanceWith({ type: 'redirect' });

const base = {
  simId: 's1',
  simTitle: 'My Sim',
  action: '/sims/s1?/leaveSim',
  enhance: enhance as never
};

describe('LeaveSimConfirm', () => {
  it('the sole member can leave and is told it deletes the sim and its pending invitations', async () => {
    expect.hasAssertions();
    const screen = await render(LeaveSimConfirm, {
      ...base,
      currentUserId: 'u1',
      members: [{ userId: 'u1', handle: 'me', role: 'manager' }]
    });
    await expect
      .element(screen.getByLabelText(MEMBERS_COPY.leaveConfirmTitleLabel))
      .not.toBeInTheDocument();

    await screen.getByRole('button', { name: MEMBERS_COPY.leaveButton }).click();
    await expect.element(screen.getByText(MEMBERS_COPY.leaveSoleMemberWarning)).toBeInTheDocument();
    expect(MEMBERS_COPY.leaveSoleMemberWarning).toMatch(/deletes this sim and its pending invit/);

    const form = screen.container.querySelector('form');
    expect(form!.getAttribute('action')).toBe('/sims/s1?/leaveSim');
    expect(form!.getAttribute('method')?.toLowerCase()).toBe('post');
    await expect
      .element(screen.getByRole('button', { name: MEMBERS_COPY.leaveDeleteButton }))
      .toBeInTheDocument();
  });

  it('revealing the sole-member confirm focuses its first control; cancel returns to the trigger', async () => {
    expect.hasAssertions();
    const { container } = await render(LeaveSimConfirm, {
      ...base,
      currentUserId: 'u1',
      members: [{ userId: 'u1', handle: 'me', role: 'manager' }]
    });
    (container.querySelector('button') as HTMLElement).click();
    flushSync();
    await expect
      .poll(() => (document.activeElement as HTMLElement)?.textContent?.trim())
      .toBe(MEMBERS_COPY.leaveDeleteButton);
    const cancel = [...container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === MEMBERS_COPY.leaveCancel
    ) as HTMLElement;
    cancel.click();
    flushSync();
    await expect
      .poll(() => (document.activeElement as HTMLElement)?.textContent?.trim())
      .toBe(MEMBERS_COPY.leaveButton);
  });

  it('a viewer sees a plain Leave button, no title input, no picker', async () => {
    const screen = await render(LeaveSimConfirm, {
      ...base,
      currentUserId: 'u1',
      members: [
        { userId: 'u1', handle: 'me', role: 'viewer' },
        { userId: 'u2', handle: 'owner', role: 'manager' }
      ]
    });
    await expect
      .element(screen.getByRole('button', { name: MEMBERS_COPY.leaveButton }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByLabelText(MEMBERS_COPY.leaveConfirmTitleLabel))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByLabelText(MEMBERS_COPY.leaveSuccessorLabel))
      .not.toBeInTheDocument();
  });

  it('clicking Leave reveals an inline confirm, Cancel returns to the button', async () => {
    const screen = await render(LeaveSimConfirm, {
      ...base,
      currentUserId: 'u1',
      members: [
        { userId: 'u1', handle: 'me', role: 'viewer' },
        { userId: 'u2', handle: 'owner', role: 'manager' }
      ]
    });
    await screen.getByRole('button', { name: MEMBERS_COPY.leaveButton }).click();
    await expect.element(screen.getByText(MEMBERS_COPY.leaveSimplePrompt)).toBeInTheDocument();
    await expect
      .element(screen.getByRole('button', { name: MEMBERS_COPY.leaveSimpleButton }))
      .toBeInTheDocument();

    await screen.getByRole('button', { name: MEMBERS_COPY.leaveCancel }).click();
    await expect
      .element(screen.getByRole('button', { name: MEMBERS_COPY.leaveButton }))
      .toBeInTheDocument();
    await expect.element(screen.getByText(MEMBERS_COPY.leaveSimplePrompt)).not.toBeInTheDocument();
  });

  it('submit is disabled until the typed title matches', async () => {
    const screen = await render(LeaveSimConfirm, {
      ...base,
      currentUserId: 'u1',
      members: [
        { userId: 'u1', handle: 'me', role: 'manager' },
        { userId: 'u2', handle: 'other', role: 'manager' }
      ]
    });
    const submit = screen.getByRole('button', { name: MEMBERS_COPY.leaveButton });
    await expect.element(submit).toBeDisabled();
    await screen.getByLabelText(MEMBERS_COPY.leaveConfirmTitleLabel).fill('My Sim');
    await expect.element(submit).toBeEnabled();
  });

  it('fires onLeave and applies the result on a successful leave', async () => {
    update.mockClear();
    const onLeave = vi.fn();
    const screen = await render(LeaveSimConfirm, {
      ...base,
      currentUserId: 'u1',
      members: [
        { userId: 'u1', handle: 'me', role: 'viewer' },
        { userId: 'u2', handle: 'owner', role: 'manager' }
      ],
      onLeave
    });
    await screen.getByRole('button', { name: MEMBERS_COPY.leaveButton }).click();
    await screen.getByRole('button', { name: MEMBERS_COPY.leaveSimpleButton }).click();
    await vi.waitFor(() => expect(onLeave).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
  });

  it('hands a successful result to onsubmit instead of applying it', async () => {
    update.mockClear();
    const onsubmit = vi.fn();
    const screen = await render(LeaveSimConfirm, {
      ...base,
      currentUserId: 'u1',
      members: [
        { userId: 'u1', handle: 'me', role: 'viewer' },
        { userId: 'u2', handle: 'owner', role: 'manager' }
      ],
      onsubmit
    });
    await screen.getByRole('button', { name: MEMBERS_COPY.leaveButton }).click();
    await screen.getByRole('button', { name: MEMBERS_COPY.leaveSimpleButton }).click();
    await vi.waitFor(() => expect(onsubmit).toHaveBeenCalledWith({ type: 'redirect' }));
    expect(update).not.toHaveBeenCalled();
  });

  it('shows the line for the failure code above the buttons, and does not fire onLeave', async () => {
    update.mockClear();
    const onLeave = vi.fn();
    const screen = await render(LeaveSimConfirm, {
      ...base,
      enhance: enhanceWith({ type: 'failure', data: { code: 'not_member' } }) as never,
      currentUserId: 'u1',
      members: [
        { userId: 'u1', handle: 'me', role: 'viewer' },
        { userId: 'u2', handle: 'owner', role: 'manager' }
      ],
      onLeave
    });
    await screen.getByRole('button', { name: MEMBERS_COPY.leaveButton }).click();
    await screen.getByRole('button', { name: MEMBERS_COPY.leaveSimpleButton }).click();
    const status = screen.getByTestId('leave-status');
    await expect.element(status).toHaveTextContent(MEMBER_ERROR_COPY.not_member);
    for (const b of screen.container.querySelectorAll('button')) {
      expect(
        !!(status.element().compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
      ).toBe(true);
    }
    expect(onLeave).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('shows the generic line, never server text, for an unknown failure', async () => {
    const screen = await render(LeaveSimConfirm, {
      ...base,
      enhance: enhanceWith({
        type: 'failure',
        data: { code: 'nope', error: 'D1_ERROR: locked' }
      }) as never,
      currentUserId: 'u1',
      members: [
        { userId: 'u1', handle: 'me', role: 'viewer' },
        { userId: 'u2', handle: 'owner', role: 'manager' }
      ]
    });
    await screen.getByRole('button', { name: MEMBERS_COPY.leaveButton }).click();
    await screen.getByRole('button', { name: MEMBERS_COPY.leaveSimpleButton }).click();
    await expect
      .element(screen.getByTestId('leave-status'))
      .toHaveTextContent(MEMBER_ERROR_COPY.failed);
    expect(screen.container.textContent).not.toContain('D1');
  });

  it('the last manager sees a successor picker including "Let the app choose"', async () => {
    const screen = await render(LeaveSimConfirm, {
      ...base,
      currentUserId: 'u1',
      members: [
        { userId: 'u1', handle: 'me', role: 'manager' },
        { userId: 'u2', handle: 'editor', role: 'editor' }
      ]
    });
    await expect
      .element(screen.getByLabelText(MEMBERS_COPY.leaveSuccessorLabel))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole('option', { name: MEMBERS_COPY.leaveSuccessorAuto }))
      .toBeInTheDocument();
    await expect.element(screen.getByRole('option', { name: /@editor/i })).toBeInTheDocument();
  });
});
