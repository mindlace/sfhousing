import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { MEMBERS_COPY, invitationsRow } from '$lib/members/copy';
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
});
