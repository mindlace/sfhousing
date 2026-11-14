import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { MEMBERS_COPY, SIMS_COPY, invitationsRow } from '$lib/members/copy';
import Page from './+page.svelte';

describe('/sims page', () => {
  it('lists invitations addressed to the user with Accept and Decline', async () => {
    const screen = await render(Page, {
      data: {
        sims: [],
        invitations: [{ id: 'i1', simId: 's1', simTitle: 'Garden', inviterHandle: 'mara' }]
      },
      form: null
    } as never);
    expect(screen.container.textContent).toContain(invitationsRow('mara', 'Garden'));
    await expect
      .element(screen.getByRole('button', { name: /Accept invitation to Garden/ }))
      .toBeInTheDocument();
  });

  it('shows no invitations section when there are none', async () => {
    const screen = await render(Page, {
      data: { sims: [], invitations: [] },
      form: null
    } as never);
    expect(screen.container.textContent).not.toContain(MEMBERS_COPY.invitationsHeading);
  });

  it('ties a create error to the title field, before the Create button', async () => {
    const screen = await render(Page, {
      data: { sims: [], invitations: [] },
      form: { error: SIMS_COPY.titleRequired }
    } as never);
    const input = screen.getByLabelText(SIMS_COPY.titleLabel);
    await expect.element(input).toHaveAttribute('aria-invalid', 'true');
    const id = input.element().getAttribute('aria-describedby')!;
    const err = document.getElementById(id)!;
    expect(err.textContent).toContain(SIMS_COPY.titleRequired);
    const create = screen.getByRole('button', { name: SIMS_COPY.create }).element();
    expect(!!(err.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(screen.container.querySelector('[role="alert"]')).toBeNull();
  });
});
