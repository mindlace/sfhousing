import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockConsole } from '$lib/server/test/mock-console';
import { EMAIL_COPY } from './copy';
import { buildSignInEmail } from './sign-in';

// The @better-svelte-email components emit a Svelte SSR placement warning
// (`<div>` inside `<html>`) via console.error during render; silence it so it
// doesn't trip signoff's stderr policer.
beforeEach(() => {
  mockConsole('warn', 'error');
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildSignInEmail', () => {
  it('renders a subject, html containing the link, and matching plain text', async () => {
    const url = 'https://sfhousing.mindlace.net/api/auth/magic-link/verify?token=abc123';
    const mail = await buildSignInEmail(url);

    expect(mail.subject).toBe(EMAIL_COPY.signIn.subject);
    expect(mail.html).toContain(url);
    expect(mail.html).toContain(EMAIL_COPY.wordmark);
    expect(mail.html).toContain(EMAIL_COPY.signIn.heading);
    // toPlainText keeps anchor hrefs, so the plain-text twin carries the link too.
    expect(mail.text).toContain(url);
    expect(`${mail.subject}${mail.html}${mail.text}`).not.toMatch(/plan ?afoot/i);
  });

  it('escapes a crafted url so it cannot break out of the href attribute', async () => {
    const url = 'https://sfhousing.mindlace.net/verify?token=a"b';
    const mail = await buildSignInEmail(url);

    expect(mail.html).not.toContain('token=a"b');
    expect(mail.html).toContain('token=a&quot;b');
  });
});
