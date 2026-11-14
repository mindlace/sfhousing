import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockConsole } from '$lib/server/test/mock-console';
import { buildConfirmEmail } from './confirm-email';
import { EMAIL_COPY } from './copy';

// Silence the components' Svelte SSR placement error (see sign-in.spec.ts).
beforeEach(() => {
  mockConsole('warn', 'error');
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildConfirmEmail', () => {
  it('renders subject, html with the link, and a text alternative', async () => {
    const url = 'https://sfhousing.mindlace.net/verify-email?token=xyz';
    const out = await buildConfirmEmail(url);
    expect(out.subject).toBe(EMAIL_COPY.confirmEmail.subject);
    expect(out.html).toContain(url);
    expect(out.html).toContain(EMAIL_COPY.confirmEmail.heading);
    expect(out.text.length).toBeGreaterThan(0);
    expect(`${out.subject}${out.html}${out.text}`).not.toMatch(/plan ?afoot/i);
  });
});
