import { describe, expect, it } from 'vitest';
import { getDb } from './index';

describe('getDb', () => {
  it('throws when the platform is undefined', () => {
    expect(() => getDb(undefined)).toThrow(/DB unavailable/);
  });

  it('throws when the DB binding is missing', () => {
    expect(() => getDb({ env: {} } as never)).toThrow(/DB unavailable/);
  });

  it('returns a drizzle instance for a D1 binding', () => {
    const fakeD1 = {
      prepare() {
        throw new Error('unused');
      }
    };
    const db = getDb({ env: { DB: fakeD1 } } as never);
    expect(typeof db.select).toBe('function');
  });
});
