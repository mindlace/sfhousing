import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEW, VIEW_KEY, readViewPrefs, writeViewPrefs } from './prefs';

const mem = (v: string | null) => ({ getItem: (k: string) => (k === VIEW_KEY ? v : null) });

describe('view prefs', () => {
  it('defaults to both layers on', () => {
    expect(DEFAULT_VIEW).toEqual({ transitStops: true, transitAccess: true });
    expect(readViewPrefs(mem(null))).toEqual(DEFAULT_VIEW);
    expect(readViewPrefs(null)).toEqual(DEFAULT_VIEW);
  });

  it('reads stored booleans and falls back per field on junk', () => {
    expect(readViewPrefs(mem('{"transitStops":false,"transitAccess":true}'))).toEqual({
      transitStops: false,
      transitAccess: true
    });
    expect(readViewPrefs(mem('{"transitStops":3}'))).toEqual(DEFAULT_VIEW);
    expect(readViewPrefs(mem('{"transitStops":false,"transitAccess":"x"}'))).toEqual({
      transitStops: false,
      transitAccess: true
    });
    expect(readViewPrefs(mem('"nope"'))).toEqual(DEFAULT_VIEW);
    expect(readViewPrefs(mem('{'))).toEqual(DEFAULT_VIEW);
  });

  it('never throws when storage throws', () => {
    const boom = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('full');
      }
    };
    expect(readViewPrefs(boom)).toEqual(DEFAULT_VIEW);
    expect(() => writeViewPrefs(DEFAULT_VIEW, boom)).not.toThrow();
  });

  it('writes exactly the two fields', () => {
    let saved = '';
    writeViewPrefs({ transitStops: false, transitAccess: true, extra: 1 } as never, {
      setItem: (_k, v) => (saved = v)
    });
    expect(JSON.parse(saved)).toEqual({ transitStops: false, transitAccess: true });
  });
});
