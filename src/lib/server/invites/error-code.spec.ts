import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { memberErrorCode } from './error-code';
import { MEMBER_ERROR_COPY, isMemberErrorCode, memberErrorText } from '$lib/members/copy';

/** Every message the invite and membership services throw, read from their source. */
function thrownMessages(): string[] {
  const files = ['./control-plane.ts', '../sims/sim-index.ts'];
  const out: string[] = [];
  for (const f of files) {
    const src = readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
    for (const m of src.matchAll(/throw new Error\('([^']+)'\)/g)) out.push(m[1]);
  }
  return out;
}

describe('memberErrorCode', () => {
  it('maps each known service reason to its code', () => {
    expect(memberErrorCode(new Error('resend too soon'))).toBe('resend_too_soon');
    expect(memberErrorCode(new Error('email invites require a verified account'))).toBe(
      'email_needs_confirmed'
    );
    expect(memberErrorCode(new Error('invite expired'))).toBe('invite_invalid');
    expect(memberErrorCode(new Error('title did not match'))).toBe('title_mismatch');
  });

  it('answers failed for an unknown error, a database error, or a non-Error', () => {
    expect(memberErrorCode(new Error('D1_ERROR: no such table: invite'))).toBe('failed');
    expect(memberErrorCode('boom')).toBe('failed');
    expect(memberErrorCode(undefined)).toBe('failed');
    // An inherited key is not a known reason.
    expect(memberErrorCode(new Error('constructor'))).toBe('failed');
  });

  it('gives every user-facing service reason a specific code', () => {
    // Internal invariants a person cannot act on fall back to the generic line on purpose.
    const generic = new Set(['user not found', 'could not establish a sim manager; please retry']);
    const messages = thrownMessages();
    expect(messages.length).toBeGreaterThan(10);
    for (const m of messages) {
      const code = memberErrorCode(new Error(m));
      if (generic.has(m)) expect(code, m).toBe('failed');
      else expect(code, m).not.toBe('failed');
    }
  });
});

describe('memberErrorText', () => {
  it('maps a known code to its line and anything else to the generic line', () => {
    expect(memberErrorText('already_invited')).toBe(MEMBER_ERROR_COPY.already_invited);
    expect(memberErrorText('resend too soon')).toBe(MEMBER_ERROR_COPY.failed);
    expect(memberErrorText(undefined)).toBe(MEMBER_ERROR_COPY.failed);
    expect(memberErrorText('toString')).toBe(MEMBER_ERROR_COPY.failed);
    expect(isMemberErrorCode('failed')).toBe(true);
  });

  it('every line is sentence case and ends with a full stop', () => {
    for (const line of Object.values(MEMBER_ERROR_COPY)) {
      expect(line).toMatch(/^[A-Z].*[.?]$/);
    }
  });
});
