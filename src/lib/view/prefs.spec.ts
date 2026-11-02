import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEW, HIDDEN_VIEW, VIEW_KEY, readViewPrefs, writeViewPrefs } from './prefs';

const mem = (v: string | null) => ({ getItem: (k: string) => (k === VIEW_KEY ? v : null) });

describe('view prefs', () => {
  it('defaults to stops off, capacity on and the height limits on', () => {
    expect(DEFAULT_VIEW).toEqual({ transitStops: false, transitAccess: true, heightLimits: true });
    expect(readViewPrefs(mem(null))).toEqual(DEFAULT_VIEW);
    expect(readViewPrefs(null)).toEqual(DEFAULT_VIEW);
    expect(readViewPrefs(null).heightLimits).toBe(true);
  });

  it('HIDDEN_VIEW turns every layer off', () => {
    expect(HIDDEN_VIEW).toEqual({ transitStops: false, transitAccess: false, heightLimits: false });
  });

  it('reads stored booleans and falls back per field on junk', () => {
    expect(
      readViewPrefs(mem('{"transitStops":false,"transitAccess":true,"heightLimits":false}'))
    ).toEqual({ transitStops: false, transitAccess: true, heightLimits: false });
    expect(readViewPrefs(mem('{"transitStops":3}'))).toEqual(DEFAULT_VIEW);
    expect(readViewPrefs(mem('{"transitStops":false,"transitAccess":"x"}'))).toEqual({
      transitStops: false,
      transitAccess: true,
      heightLimits: true
    });
    expect(readViewPrefs(mem('"nope"'))).toEqual(DEFAULT_VIEW);
    expect(readViewPrefs(mem('{'))).toEqual(DEFAULT_VIEW);
  });

  it('a record from before the height limits (no heightLimits or heightFog) reads them on', () => {
    expect(readViewPrefs(mem('{"transitStops":true,"transitAccess":false}'))).toEqual({
      transitStops: true,
      transitAccess: false,
      heightLimits: true
    });
  });

  it('a stored heightFog: false reads as heightLimits: false; writes heightLimits only', () => {
    const saved = new Map<string, string>([
      [VIEW_KEY, '{"transitStops":true,"transitAccess":true,"heightFog":false}']
    ]);
    const s = {
      getItem: (k: string) => saved.get(k) ?? null,
      setItem: (k: string, v: string) => void saved.set(k, v)
    };
    const v = readViewPrefs(s);
    expect(v).toEqual({ transitStops: true, transitAccess: true, heightLimits: false });
    writeViewPrefs(v, s);
    expect(JSON.parse(saved.get(VIEW_KEY)!)).toEqual({
      transitStops: true,
      transitAccess: true,
      heightLimits: false
    });
    // The new field wins over a legacy one.
    expect(readViewPrefs(mem('{"heightFog":false,"heightLimits":true}')).heightLimits).toBe(true);
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
      { transitStops: false, transitAccess: true, heightLimits: true, extra: 1 } as never,
      { setItem: (_k, v) => (saved = v) }
    );
    expect(JSON.parse(saved)).toEqual({
      transitStops: false,
      transitAccess: true,
      heightLimits: true
    });
  });

  it('a written heightLimits: false reads back false', () => {
    const saved = new Map<string, string>();
    const s = {
      getItem: (k: string) => saved.get(k) ?? null,
      setItem: (k: string, v: string) => void saved.set(k, v)
    };
    writeViewPrefs({ ...DEFAULT_VIEW, heightLimits: false }, s);
    expect(readViewPrefs(s).heightLimits).toBe(false);
  });
});
