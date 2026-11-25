import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { E2E_GAME_KEY, E2E_GOAL_KEY } from './e2e';
import { MAX_SAVE_BYTES } from './save-api';
import { MAX_SAVES, SAVES_KEY, SAVE_NAME_MAX, SHORT_MONTHS, saveKey } from './saves';
import { defaultSaveName, type DefaultFrom } from './words';

describe('constants', () => {
  it('the storage keys and limits', () => {
    expect(SAVES_KEY).toBe('sfhousing:saves:v1');
    expect(saveKey('abc')).toBe('sfhousing:save:abc');
    expect(saveKey('x')).toBe('sfhousing:save:x');
    expect(MAX_SAVES).toBe(12);
    expect(SAVE_NAME_MAX).toBe(60);
    expect(MAX_SAVE_BYTES).toBe(600_000);
  });
  it('the e2e keys', () => {
    expect(E2E_GAME_KEY).toBe('sfhousing:e2e:game');
    expect(E2E_GOAL_KEY).toBe('sfhousing:e2e:goal');
  });
  it('SHORT_MONTHS is Jan to Dec', () => {
    expect(SHORT_MONTHS).toEqual([
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec'
    ]);
  });
});

describe('defaultSaveName of words.ts', () => {
  it('cuts to 60 code points through a third name', () => {
    const long = 'x'.repeat(60);
    expect(defaultSaveName({ kind: 'conflict', name: long }, [long, 'x'.repeat(56) + ' (2)'])).toBe(
      'x'.repeat(56) + ' (3)'
    );
  });
  it('has no remix kind', () => {
    // @ts-expect-error DefaultFrom has no remix kind (P13)
    const remix: DefaultFrom = { kind: 'remix', title: 'T' };
    expect(remix.kind).toBe('remix');
  });
});

describe('saves.ts as Playwright loads it', () => {
  it('has no import line at all', () => {
    const text = readFileSync(new URL('./saves.ts', import.meta.url), 'utf8');
    expect(text).not.toMatch(/^import /m);
  });
});
