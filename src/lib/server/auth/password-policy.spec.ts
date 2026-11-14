import { describe, it, expect } from 'vitest';
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, validatePasswordShape } from './password-policy';

describe('validatePasswordShape', () => {
  it('accepts a passphrase at the minimum length', () => {
    expect(validatePasswordShape('a'.repeat(PASSWORD_MIN_LENGTH))).toEqual({ ok: true });
  });

  it('rejects one character below the minimum', () => {
    expect(validatePasswordShape('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toEqual({
      ok: false,
      reason: 'too-short'
    });
  });

  it('accepts a long passphrase at the maximum', () => {
    expect(validatePasswordShape('a'.repeat(PASSWORD_MAX_LENGTH))).toEqual({ ok: true });
  });

  it('rejects one character above the maximum', () => {
    expect(validatePasswordShape('a'.repeat(PASSWORD_MAX_LENGTH + 1))).toEqual({
      ok: false,
      reason: 'too-long'
    });
  });

  it('imposes NO composition rules — a long all-lowercase phrase passes', () => {
    expect(validatePasswordShape('correct horse battery staple')).toEqual({ ok: true });
  });

  it('counts by code points, so emoji do not inflate the length', () => {
    // 9 astral code points = 18 UTF-16 units. Must be judged too short.
    expect(validatePasswordShape('😀'.repeat(9))).toEqual({ ok: false, reason: 'too-short' });
  });
});
