import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clearE2eMail, readE2eMail } from '$lib/server/e2e/mail-sink';

const { sendEmail, buildInviteEmail } = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  buildInviteEmail: vi.fn()
}));

vi.mock('$lib/server/email/send', () => ({ sendEmail }));
vi.mock('$lib/server/email-templates/invite', () => ({ buildInviteEmail }));

import { sendInviteEmail } from './email';

function platform(env: Record<string, unknown> = {}): App.Platform {
  return { env } as unknown as App.Platform;
}

afterEach(() => {
  vi.unstubAllEnvs();
  clearE2eMail();
});

beforeEach(() => {
  vi.clearAllMocks();
  sendEmail.mockResolvedValue({ sent: false, logged: true });
  buildInviteEmail.mockImplementation(async (a: { url: string }) => ({
    subject: 'You are invited',
    html: `<a href="${a.url}">join</a>`,
    text: a.url
  }));
});

describe('sendInviteEmail', () => {
  it('builds the /invite/<token> URL and sends one email to the recipient', async () => {
    expect.hasAssertions();
    await sendInviteEmail({
      platform: platform(),
      origin: 'https://app.example',
      to: 'r@example.com',
      token: 'tok123',
      inviterHandle: 'alice',
      simTitle: 'Climb Olympus'
    });

    expect(buildInviteEmail).toHaveBeenCalledWith({
      inviterHandle: 'alice',
      simTitle: 'Climb Olympus',
      url: 'https://app.example/invite/tok123'
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [, input] = sendEmail.mock.calls[0];
    expect(input.to).toBe('r@example.com');
    expect(input.subject).toBe('You are invited');
    expect(input.html).toContain('https://app.example/invite/tok123');
  });

  it('records nothing in the mail sink outside an e2e env', async () => {
    expect.hasAssertions();
    vi.stubEnv('VITE_E2E', '');
    await sendInviteEmail({
      platform: platform({ ENVIRONMENT: 'development' }),
      origin: 'https://app.example',
      to: 'r@example.com',
      token: 'tok',
      inviterHandle: 'alice',
      simTitle: 'Q'
    });
    expect(readE2eMail('invite', 'r@example.com')).toBeNull();
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('records the URL under kind invite for the recipient in an e2e env', async () => {
    expect.hasAssertions();
    vi.stubEnv('VITE_E2E', '1');
    await sendInviteEmail({
      platform: platform({ ENVIRONMENT: 'development' }),
      origin: 'https://app.example',
      to: 'r@example.com',
      token: 'tok',
      inviterHandle: 'alice',
      simTitle: 'Q'
    });
    expect(readE2eMail('invite', 'r@example.com')).toBe('https://app.example/invite/tok');
  });
});
