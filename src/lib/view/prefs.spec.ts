import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEW, HIDDEN_VIEW, VIEW_KEY, readViewPrefs, writeViewPrefs } from './prefs';

const mem = (v: string | null) => ({ getItem: (k: string) => (k === VIEW_KEY ? v : null) });

describe('view prefs', () => {
  it('defaults to stops off, capacity on and the height fog on', () => {
    expect(DEFAULT_VIEW).toEqual({ transitStops: false, transitAccess: true, heightFog: true });
    expect(readViewPrefs(mem(null))).toEqual(DEFAULT_VIEW);
    expect(readViewPrefs(null)).toEqual(DEFAULT_VIEW);
    expect(readViewPrefs(null).heightFog).toBe(true);
  });

  it('HIDDEN_VIEW turns every layer off', () => {
    expect(HIDDEN_VIEW).toEqual({ transitStops: false, transitAccess: false, heightFog: false });
  });

  it('reads stored booleans and falls back per field on junk', () => {
    expect(
      readViewPrefs(mem('{"transitStops":false,"transitAccess":true,"heightFog":false}'))
    ).toEqual({ transitStops: false, transitAccess: true, heightFog: false });
    expect(readViewPrefs(mem('{"transitStops":3}'))).toEqual(DEFAULT_VIEW);
    expect(readViewPrefs(mem('{"transitStops":false,"transitAccess":"x"}'))).toEqual({
      transitStops: false,
      transitAccess: true,
      heightFog: true
    });
    expect(readViewPrefs(mem('"nope"'))).toEqual(DEFAULT_VIEW);
    expect(readViewPrefs(mem('{'))).toEqual(DEFAULT_VIEW);
  });

  it('a record from before the fog (no heightFog) reads heightFog on', () => {
    expect(readViewPrefs(mem('{"transitStops":true,"transitAccess":false}'))).toEqual({
      transitStops: true,
      transitAccess: false,
      heightFog: true
    });
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

  it('writes exactly the three fields', () => {
    let saved = '';
    writeViewPrefs(
      { transitStops: false, transitAccess: true, heightFog: true, extra: 1 } as never,
      { setItem: (_k, v) => (saved = v) }
    );
    expect(JSON.parse(saved)).toEqual({
      transitStops: false,
      transitAccess: true,
      heightFog: true
    });
  });

  it('a written heightFog: false reads back false', () => {
    const saved = new Map<string, string>();
    const s = {
      getItem: (k: string) => saved.get(k) ?? null,
      setItem: (k: string, v: string) => void saved.set(k, v)
    };
    writeViewPrefs({ ...DEFAULT_VIEW, heightFog: false }, s);
    expect(readViewPrefs(s).heightFog).toBe(false);
  });
});
