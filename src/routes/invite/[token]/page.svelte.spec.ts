import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { AUTH_COPY } from '$lib/account/copy';
import { MEMBER_ERROR_COPY, MEMBERS_COPY } from '$lib/members/copy';
import Page from './+page.svelte';

const INVITE = {
  invite: { simTitle: 'Trip', inviterHandle: 'ada', invitedEmail: 'x@y.z' },
  signedIn: false,
  linkError: false
};

/** True when `a` comes before `b` in document order. */
const before = (a: Element, b: Element) =>
  !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

/** The status sits under the heading and before every button. */
function expectUnderHeading(container: HTMLElement, status: HTMLElement) {
  expect(before(container.querySelector('h1')!, status)).toBe(true);
  for (const b of container.querySelectorAll('button')) expect(before(status, b)).toBe(true);
}

describe('invite page', () => {
  it('email field has an explicit label and autocomplete', async () => {
    expect.hasAssertions();
    const { container } = await render(Page, { data: INVITE, form: null } as never);
    const input = container.querySelector('#invite-email')!;
    expect(input.getAttribute('autocomplete')).toBe('email');
    expect(container.querySelector(`label[for="invite-email"]`)!.textContent).toContain(
      MEMBERS_COPY.inviteEmailLabel
    );
  });

  it('a failed Join shows the line for its code under the heading, before the buttons', async () => {
    const { container } = await render(Page, {
      data: INVITE,
      form: { code: 'rate_limited' }
    } as never);
    const status = container.querySelector('[data-testid="form-status"]') as HTMLElement;
    expect(status.textContent).toContain(MEMBER_ERROR_COPY.rate_limited);
    expect(status.dataset.tone).toBe('error');
    expectUnderHeading(container, status);
  });

  it('a failed Accept, signed in, shows its line under the heading', async () => {
    const { container } = await render(Page, {
      data: { ...INVITE, signedIn: true },
      form: { code: 'not_addressed' }
    } as never);
    const status = container.querySelector('[data-testid="form-status"]') as HTMLElement;
    expect(status.textContent).toContain(MEMBER_ERROR_COPY.not_addressed);
    expect(status.dataset.tone).toBe('error');
    expectUnderHeading(container, status);
    expect(container.textContent).toContain(MEMBERS_COPY.inviteAccept);
  });

  it('an unknown code shows the generic line, never server text', async () => {
    const { container } = await render(Page, {
      data: { ...INVITE, signedIn: true },
      form: { code: 'D1_ERROR', error: 'D1_ERROR: locked' }
    } as never);
    const status = container.querySelector('[data-testid="form-status"]') as HTMLElement;
    expect(status.textContent).toContain(MEMBER_ERROR_COPY.failed);
    expect(container.textContent).not.toContain('D1');
  });

  it('a magic link that came back failed says so', async () => {
    const { container } = await render(Page, {
      data: { ...INVITE, linkError: true },
      form: null
    } as never);
    const status = container.querySelector('[data-testid="form-status"]') as HTMLElement;
    expect(status.textContent).toContain(AUTH_COPY.linkFailed);
    expect(status.dataset.tone).toBe('error');
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
      data: { invite: null, signedIn: false, linkError: false },
      form: null
    } as never);
    expect(container.querySelector('h1')!.textContent).toBe(MEMBERS_COPY.inviteInvalidTitle);
  });
});
