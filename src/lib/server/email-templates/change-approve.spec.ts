import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockConsole } from '$lib/server/test/mock-console';
import { buildChangeApprove } from './change-approve';
import { EMAIL_COPY } from './copy';

// Silence the components' Svelte SSR placement error (see sign-in.spec.ts).
beforeEach(() => {
  mockConsole('warn', 'error');
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildChangeApprove', () => {
  it('renders subject, the link, and the new email, plus a text alternative', async () => {
    const url = 'https://sfhousing.mindlace.net/verify-email?token=abc';
    const out = await buildChangeApprove(url, 'new@x.com');
    expect(out.subject).toBe(EMAIL_COPY.changeApprove.subject);
    expect(out.html).toContain(url);
    expect(out.html).toContain('new@x.com');
    expect(out.text.length).toBeGreaterThan(0);
    expect(`${out.subject}${out.html}${out.text}`).not.toMatch(/plan ?afoot/i);
  });
});
