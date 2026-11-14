import { describe, it, expect } from 'vitest';
import { freshDb, seedUser } from '$lib/server/test/auth-db';
import { handleTombstone } from '$lib/server/db/schema';
import { seedHandle, generateUniqueHandle } from './handle';
import { skeleton } from './confusable-skeleton';

/** Build a deterministic rng that returns successive words from the given list. */
function deterministicRng(...words: string[]): () => string {
  let i = 0;
  return () => {
    if (i >= words.length)
      throw new Error(`deterministicRng: exhausted after ${words.length} calls`);
    return words[i++];
  };
}

describe('seedHandle', () => {
  it('uses the slugified first word + a whimsical suffix', () => {
    expect(seedHandle('Move to Portland')).toMatch(/^move-[a-z]+$/);
  });

  it('falls back to whimsical-only when the first word is empty/punctuation', () => {
    expect(seedHandle('   !!!  ')).toMatch(/^[a-z]+-[a-z]+$/);
  });
});

describe('generateUniqueHandle', () => {
  it('skips a candidate held by a live tombstone (grows the suffix)', async () => {
    const { db } = freshDb();
    // An identity must exist for the tombstone FK.
    await seedUser(db, { id: 'u1', email: 'u1@example.com', handle: 'someone' });
    // 'move-wren' is reserved by a non-expired tombstone, so generation must skip it.
    await db.insert(handleTombstone).values({
      handle: 'move-wren',
      skeleton: skeleton('move-wren'),
      releasedBy: 'u1',
      releasedAt: new Date('2026-06-01'),
      expiresAt: new Date('2027-06-01')
    });
    const h = await generateUniqueHandle({
      db,
      simTitle: 'Move',
      rng: deterministicRng('wren', 'otter'),
      now: new Date('2026-06-08')
    });
    expect(h).toBe('move-wren-otter');
  });

  it('grows when the candidate skeleton collides with an existing user (confusable)', async () => {
    const { db } = freshDb();
    // Existing user holds 'm0ve-wren' (digit zero U+0030); its skeleton equals
    // skeleton('move-wren'), so the first candidate is a confusable collision.
    await seedUser(db, { id: 'u1', email: 'u1@example.com', handle: 'm0ve-wren' });
    // rng yields 'wren' first (candidate 'move-wren' → skeleton collides), then 'otter'.
    const h = await generateUniqueHandle({
      db,
      simTitle: 'Move',
      rng: deterministicRng('wren', 'otter')
    });
    expect(h).not.toBe('move-wren');
    expect(h).toBe('move-wren-otter');
  });

  it('treats a handle as free when no live user row holds it', async () => {
    const { db } = freshDb();
    // Only 'move-cat' is taken; 'move-wren' is free because no live row holds it.
    await seedUser(db, { id: 'u1', email: 'u1@example.com', handle: 'move-cat' });
    // rng yields 'wren' — no live row has 'move-wren' so it is free immediately
    const h = await generateUniqueHandle({
      db,
      simTitle: 'Move',
      rng: deterministicRng('wren')
    });
    expect(h).toBe('move-wren');
  });
});
