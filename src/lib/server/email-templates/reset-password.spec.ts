import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockConsole } from '$lib/server/test/mock-console';
import { EMAIL_COPY } from './copy';
import { buildResetPasswordEmail } from './reset-password';

// Silence the components' Svelte SSR placement error (see sign-in.spec.ts).
beforeEach(() => {
  mockConsole('warn', 'error');
});
afterEach(() => {
  vi.restoreAllMocks();
});

const url = 'https://sfhousing.mindlace.net/reset-password?token=abc';

describe('buildResetPasswordEmail', () => {
  it('renders subject, html and text all carrying the reset URL', async () => {
    const mail = await buildResetPasswordEmail(url);
    expect(mail.html).toContain(url);
    expect(mail.text).toContain(url);
    expect(mail.subject).toBe(EMAIL_COPY.resetPassword.subject);
    expect(`${mail.subject}${mail.html}${mail.text}`).not.toMatch(/plan ?afoot/i);
  });
});
