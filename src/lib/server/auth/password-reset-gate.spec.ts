import { describe, it, expect } from 'vitest';
import { mayReceivePasswordReset } from './password-reset-gate';

describe('mayReceivePasswordReset', () => {
  it('allows a real verified address', () => {
    expect(mayReceivePasswordReset({ email: 'ada@example.com', emailVerified: true })).toBe(true);
  });

  it('refuses an unverified address (the squatting vector)', () => {
    expect(mayReceivePasswordReset({ email: 'ada@example.com', emailVerified: false })).toBe(false);
  });

  it('refuses the synthetic pseudonymous address even if flagged verified', () => {
    expect(
      mayReceivePasswordReset({
        email: 'abc123@pseudonymous.sfhousing.invalid',
        emailVerified: true
      })
    ).toBe(false);
  });

  it('refuses a synthetic address in mixed case', () => {
    expect(
      mayReceivePasswordReset({
        email: 'ABC123@Pseudonymous.SFHousing.Invalid',
        emailVerified: true
      })
    ).toBe(false);
  });

  it('allows a real address on a lookalike domain that merely ends similarly', () => {
    expect(
      mayReceivePasswordReset({
        email: 'ada@notpseudonymous.sfhousing.invalid',
        emailVerified: true
      })
    ).toBe(true);
  });

  it('refuses a synthetic address padded with whitespace', () => {
    expect(
      mayReceivePasswordReset({
        email: '  abc123@pseudonymous.sfhousing.invalid  ',
        emailVerified: true
      })
    ).toBe(false);
  });

  it('treats an address with no @ as non-synthetic', () => {
    expect(mayReceivePasswordReset({ email: 'not-an-email', emailVerified: true })).toBe(true);
  });

  it('refuses the sfhousing pseudonymous domain', () => {
    expect(
      mayReceivePasswordReset({ email: 'x@pseudonymous.sfhousing.invalid', emailVerified: true })
    ).toBe(false);
  });
});
