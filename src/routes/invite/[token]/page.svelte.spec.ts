import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { MEMBERS_COPY } from '$lib/members/copy';
import Page from './+page.svelte';

const INVITE = {
  invite: { simTitle: 'Trip', inviterHandle: 'ada', invitedEmail: 'x@y.z' },
  signedIn: false
};

describe('invite page a11y', () => {
  it('email field has explicit label, autocomplete, and error association when failed', async () => {
    expect.hasAssertions();
    const { container } = await render(Page, { data: INVITE, form: { error: 'bad' } } as never);
    const input = container.querySelector('#invite-email')!;
    expect(input.getAttribute('autocomplete')).toBe('email');
    expect(container.querySelector(`label[for="invite-email"]`)!.textContent).toContain(
      MEMBERS_COPY.inviteEmailLabel
    );
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('invite-email-error');
    await expect.poll(() => document.activeElement).toBe(input);
  });

  it('checkEmail confirmation announces via the focused status node', async () => {
    expect.hasAssertions();
    const { container } = await render(Page, { data: INVITE, form: { checkEmail: true } } as never);
    const status = container.querySelector('[data-testid="form-status"]') as HTMLElement;
    expect(status.getAttribute('role')).toBe('status');
    expect(status.textContent).toContain(MEMBERS_COPY.inviteCheckEmail);
    await expect.poll(() => document.activeElement).toBe(status);
  });

  it('invalid invite renders a heading', async () => {
    expect.hasAssertions();
    const { container } = await render(Page, {
      data: { invite: null, signedIn: false },
      form: null
    } as never);
    expect(container.querySelector('h1')!.textContent).toBe(MEMBERS_COPY.inviteInvalidTitle);
  });
});
