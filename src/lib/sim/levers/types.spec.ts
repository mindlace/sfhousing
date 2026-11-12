import { describe, expect, it } from 'vitest';
import { maxFunding } from './fixtures/finance';
import { DEFAULT_LEVERS, LeverFormatError, parseSimLevers, type SimLevers } from './types';

function with_(patch: Record<string, unknown>): unknown {
  return { ...structuredClone(DEFAULT_LEVERS), ...patch };
}

function pathOf(json: unknown): string {
  try {
    parseSimLevers(json);
  } catch (e) {
    expect(e).toBeInstanceOf(LeverFormatError);
    return (e as LeverFormatError).path;
  }
  throw new Error('expected parseSimLevers to throw');
}

const edit = { lots: ['a'], stories: 5 };
it('a rule edit may carry a string source; a non-string source names its path', () => {
  expect(parseSimLevers(with_({ rules: [{ ...edit, source: 'r1' }] })).rules[0].source).toBe('r1');
  expect(pathOf(with_({ rules: [{ ...edit, source: 3 }] }))).toBe('rules[0].source');
  expect('source' in parseSimLevers(with_({ rules: [edit] })).rules[0]).toBe(false);
});

const timer = { pathway: 'discretionary', stage: 'filed', scale: 1, reach: 'all' };

describe('parseSimLevers', () => {
  it('round-trips the defaults', () => {
    expect(parseSimLevers(DEFAULT_LEVERS)).toEqual(DEFAULT_LEVERS);
  });

  it('returns a copy, not the input', () => {
    const out = parseSimLevers(DEFAULT_LEVERS);
    expect(out).not.toBe(DEFAULT_LEVERS);
    expect(out.rules).not.toBe(DEFAULT_LEVERS.rules);
    expect(out.paint).not.toBe(DEFAULT_LEVERS.paint);
  });

  it('accepts a fully populated document', () => {
    const full: SimLevers = {
      ...structuredClone(DEFAULT_LEVERS),
      rules: [edit],
      paint: [{ lots: ['b', 'c'], stories: 0 }, edit],
      protect: { rentControl: true, historic: true, newerThanYears: 15 },
      timers: [timer as SimLevers['timers'][number]],
      routeShares: { discretionary: 1, streamlined: 2, permitOnly: 0 },
      compare: 'fzp'
    };
    expect(parseSimLevers(full)).toEqual(full);
  });

  it('rejects unknown keys at every level', () => {
    expect(pathOf(with_({ extra: 1 }))).toBe('extra');
    expect(pathOf(with_({ rules: [{ ...edit, extra: 1 }] }))).toBe('rules[0].extra');
    expect(pathOf(with_({ paint: [{ ...edit, mode: 'set' }] }))).toBe('paint[0].mode');
    expect(pathOf(with_({ protect: { ...DEFAULT_LEVERS.protect, extra: 1 } }))).toBe(
      'protect.extra'
    );
    expect(pathOf(with_({ timers: [{ ...timer, extra: 1 }] }))).toBe('timers[0].extra');
  });

  it('rejects a schema-1 document', () => {
    expect(pathOf({ ...DEFAULT_LEVERS, schema: 1 })).toBe('schema');
  });

  it('is schema 3 and rejects schema 2 with its message', () => {
    expect(DEFAULT_LEVERS.schema).toBe(3);
    expect(() => parseSimLevers({ ...DEFAULT_LEVERS, schema: 2 })).toThrow(
      new LeverFormatError('schema', 'expected 3, got 2')
    );
  });

  it('defaults to empty funding and parses a full one', () => {
    expect(DEFAULT_LEVERS.finance).toEqual({
      baselineScale: [],
      pools: [],
      programmes: [],
      terms: {}
    });
    const full = { ...structuredClone(DEFAULT_LEVERS), finance: maxFunding() };
    expect(parseSimLevers(full)).toEqual(full);
  });

  it('names a bad finance field with its lever path', () => {
    const f = maxFunding();
    f.pools[0].id = 'pool-1';
    expect(pathOf(with_({ finance: f }))).toBe('finance.pools[0].id');
    expect(pathOf({ ...DEFAULT_LEVERS, finance: undefined })).toBe('finance');
  });

  it.each([-1, 256, 2.5])('rejects stories of %s', (stories) => {
    expect(pathOf(with_({ rules: [{ ...edit, stories }] }))).toBe('rules[0].stories');
    expect(pathOf(with_({ paint: [{ ...edit, stories }] }))).toBe('paint[0].stories');
  });

  it('accepts stories of 0 and 255', () => {
    const out = parseSimLevers(
      with_({ rules: [{ ...edit, stories: 255 }], paint: [{ ...edit, stories: 0 }] })
    );
    expect(out.rules[0].stories).toBe(255);
    expect(out.paint[0].stories).toBe(0);
  });

  it('rejects a construction timer', () => {
    expect(pathOf(with_({ timers: [{ ...timer, stage: 'construction' }] }))).toBe(
      'timers[0].stage'
    );
  });

  it.each([0.04, 10.01, NaN])('rejects scale %s', (scale) => {
    expect(pathOf(with_({ timers: [{ ...timer, scale }] }))).toBe('timers[0].scale');
  });

  it('rejects a negative route share and shares summing to 0', () => {
    expect(
      pathOf(with_({ routeShares: { discretionary: -1, streamlined: 2, permitOnly: 0 } }))
    ).toBe('routeShares.discretionary');
    expect(
      pathOf(with_({ routeShares: { discretionary: 0, streamlined: 0, permitOnly: 0 } }))
    ).toBe('routeShares');
  });

  it('rejects newerThanYears of 0', () => {
    expect(pathOf(with_({ protect: { ...DEFAULT_LEVERS.protect, newerThanYears: 0 } }))).toBe(
      'protect.newerThanYears'
    );
  });

  it('rejects a non-string lot id', () => {
    expect(pathOf(with_({ rules: [{ ...edit, lots: [3] }] }))).toBe('rules[0].lots[0]');
  });

  it('rejects non-boolean flags and a bad compare', () => {
    expect(pathOf(with_({ localProgramStreamlined: 1 }))).toBe('localProgramStreamlined');
    expect(pathOf(with_({ compare: 'x' }))).toBe('compare');
    expect(pathOf(with_({ compare: 'currentLaw' }))).toBe('compare');
  });
});
