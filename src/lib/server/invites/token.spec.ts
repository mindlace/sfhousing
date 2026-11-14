import { describe, it, expect } from 'vitest';
import { generateInviteToken, hashToken } from './token';

describe('invite-token', () => {
  it('generates a high-entropy url-safe token', () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it('hashes deterministically to sha-256 hex', async () => {
    const token = generateInviteToken();
    const h1 = await hashToken(token);
    const h2 = await hashToken(token);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(h2);
    expect(h1).not.toBe(token);
  });
});
