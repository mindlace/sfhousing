import { describe, expect, it } from 'vitest';
import { LogFormatError } from './types';
import { F } from './test/fixtures';
import { REGISTRY, SHAPES_REVISION, checkName } from './shapes';

const rows = ['transit', 'painted', 'category', 'routes', 'baseline', 'fund', 'terms'];
const names = ['sim', 'stroke', ...rows.flatMap((r) => [`policy.${r}`, `span.${r}`])].sort();

describe('shape registry', () => {
  it('revision 1 declares the sixteen shapes at version 1', () => {
    expect(REGISTRY.current).toBe(SHAPES_REVISION);
    expect(Object.keys(REGISTRY.revisions[1]).sort()).toEqual(names);
    expect(Object.values(REGISTRY.revisions[1]).every((v) => v === 1)).toBe(true);
  });
  it('never drops a shape and has an upgrade out of every older version', () => {
    expect(Object.keys(REGISTRY.shapes).sort()).toEqual(names);
    for (let r = 2; r <= REGISTRY.current; r++)
      for (const s of Object.keys(REGISTRY.revisions[r - 1]))
        expect(REGISTRY.revisions[r][s]).toBeGreaterThanOrEqual(REGISTRY.revisions[r - 1][s]);
    for (const vs of Object.values(REGISTRY.shapes))
      vs.slice(0, -1).forEach((v) => expect(v.up).toBeDefined());
  });
  it('checks names as checkSimTitle does', () => {
    expect(checkName('Mission', 'v')).toBe('Mission');
    expect(checkName('x'.repeat(63), 'v')).toHaveLength(63);
    for (const bad of ['', ' Mission', 'Mission ', 'x'.repeat(64), 7])
      expect(() => checkName(bad, 'v')).toThrow(LogFormatError);
  });
  it('keeps where, what and kind on their row', () => {
    const t = REGISTRY.shapes['policy.transit'][0];
    const ok = {
      id: 'z1',
      kind: 'zoning',
      where: { tag: 'transit', stopTypes: [] },
      label: '',
      preset: null,
      on: true
    };
    expect(t.parse(ok, 'f')).toEqual(ok);
    expect(() => t.parse({ ...ok, where: { tag: 'painted' } }, 'f')).toThrow(LogFormatError);
    expect(() => t.parse({ ...ok, kind: 'money' }, 'f')).toThrow(LogFormatError);
    const p = REGISTRY.shapes['span.painted'][0];
    const span = { policy: 'z2', from: 20000, to: null, what: { tag: 'brushes' } };
    expect(p.parse(span, 'f')).toEqual(span);
    expect(() => p.parse({ ...span, what: { tag: 'brushes', brushes: [] } }, 'f')).toThrow(
      LogFormatError
    );
    const k = REGISTRY.shapes['stroke'][0];
    expect(() => k.parse({ ...F, stories: null }, 'f')).toThrow(LogFormatError);
    expect(() => k.parse({ ...F, kind: 'erase' }, 'f')).toThrow(LogFormatError);
  });
});
