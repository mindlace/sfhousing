import { describe, it, expect } from 'vitest';
import { resolveHandleToEmail } from './magic-link';
import { freshDb, seedUser } from '$lib/server/test/auth-db';

describe('resolveHandleToEmail', () => {
  it('returns the email for a non-anonymous handle', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'S', email: 'real@example.com', handle: 'oldtimer-fox' });
    expect(await resolveHandleToEmail(db, 'oldtimer-fox')).toBe('real@example.com');
  });

  it('returns null for an unknown handle', async () => {
    const { db } = freshDb();
    expect(await resolveHandleToEmail(db, 'nobody-here')).toBeNull();
  });

  it('resolves a canonically-equivalent input (uppercase / NFD) to the stored handle', async () => {
    const { db } = freshDb();
    // Stored canonical form: NFC, lowercase 'café' (U+0063 U+0061 U+0066 U+00E9).
    await seedUser(db, { id: 'C', email: 'cafe@example.com', handle: 'café' });
    // Uppercase input 'CAFÉ' (U+0043 U+0041 U+0046 U+00C9) — differs pre-normalization.
    expect(await resolveHandleToEmail(db, 'CAFÉ')).toBe('cafe@example.com');
    // NFD-decomposed input (U+0063 U+0061 U+0066 U+0065 U+0301) — differs pre-normalization.
    expect(await resolveHandleToEmail(db, 'café'.normalize('NFD'))).toBe('cafe@example.com');
  });

  it('does NOT resolve a confusable look-alike (same skeleton, different canonical handle)', async () => {
    const { db } = freshDb();
    // Stored Latin handle 'oka' (U+006F U+006B U+0061).
    await seedUser(db, { id: 'O', email: 'oka@example.com', handle: 'oka' });
    // Confusable input: Cyrillic о (U+043E) + Latin k (U+006B) + Cyrillic а (U+0430).
    // Same visual skeleton, but a different canonical handle → must not match.
    expect(await resolveHandleToEmail(db, 'оkа')).toBeNull();
  });
});
