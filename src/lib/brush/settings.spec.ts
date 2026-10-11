import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_KEY, readSettings, writeSettings } from './settings';

const store = (v: string | null) => ({ getItem: () => v });

describe('readSettings', () => {
  it('has the expected key and defaults', () => {
    expect(SETTINGS_KEY).toBe('sfhousing:brush');
    expect(DEFAULT_SETTINGS).toEqual({ stories: 6, radiusM: 30 });
  });
  it('returns defaults for null storage or missing value', () => {
    expect(readSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(readSettings(store(null))).toEqual(DEFAULT_SETTINGS);
  });
  it('returns defaults for invalid JSON and JSON null', () => {
    expect(readSettings(store('{nope'))).toEqual(DEFAULT_SETTINGS);
    expect(readSettings(store('null'))).toEqual(DEFAULT_SETTINGS);
  });
  it('defaults bad fields and clamps good ones', () => {
    expect(readSettings(store('{"stories":"abc","radiusM":9999}'))).toEqual({
      stories: 6,
      radiusM: 500
    });
    expect(readSettings(store('{"stories":12}'))).toEqual({ stories: 12, radiusM: 30 });
    expect(readSettings(store('{"stories":null,"radiusM":null}'))).toEqual(DEFAULT_SETTINGS);
  });
  it('survives a throwing getter', () => {
    const s = {
      getItem: () => {
        throw new Error('denied');
      }
    };
    expect(readSettings(s)).toEqual(DEFAULT_SETTINGS);
  });
});

describe('writeSettings', () => {
  it('swallows a throwing setItem', () => {
    const s = {
      setItem: () => {
        throw new Error('quota');
      }
    };
    expect(() => writeSettings({ stories: 3, radiusM: 40 }, s)).not.toThrow();
  });
  it('does nothing without storage', () => {
    expect(() => writeSettings({ stories: 3, radiusM: 40 }, null)).not.toThrow();
  });
  it('round trips', () => {
    const m = new Map<string, string>();
    const s = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v)
    };
    writeSettings({ stories: 20, radiusM: 120 }, s);
    expect(m.get(SETTINGS_KEY)).toBe('{"stories":20,"radiusM":120}');
    expect(readSettings(s)).toEqual({ stories: 20, radiusM: 120 });
  });
});
