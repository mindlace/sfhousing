import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockConsole } from '$lib/server/test/mock-console';
import { EMAIL_COPY } from './copy';
import { buildInviteEmail } from './invite';

// Silence the components' Svelte SSR placement error (see sign-in.spec.ts).
beforeEach(() => {
  mockConsole('warn', 'error');
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildInviteEmail', () => {
  it('renders inviter handle, sim title, and the accept url', async () => {
    const out = await buildInviteEmail({
      inviterHandle: 'dana',
      simTitle: 'Upzone the Sunset',
      url: 'https://sfhousing.mindlace.net/invite/abc'
    });
    expect(out.subject).toBe(EMAIL_COPY.invite.subject('dana', 'Upzone the Sunset'));
    expect(out.html).toContain('https://sfhousing.mindlace.net/invite/abc');
    expect(out.html).toContain(EMAIL_COPY.invite.heading('dana'));
    expect(out.text).toContain('Upzone the Sunset');
    expect(`${out.subject}${out.html}${out.text}`).not.toMatch(/plan ?afoot/i);
  });
});
