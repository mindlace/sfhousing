import { describe, expect, it } from 'vitest';
import { dayOf } from '../scenario/dates';
import {
  CURRENT_LAW_SWITCH,
  DEFAULT_LEVERS,
  FZP_COMPAT_LEVERS,
  LeverFormatError,
  parseSimLevers,
  type SimLevers
} from './types';

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

const edit = { lots: ['a'], mode: 'raise', stories: 5, densityLimits: false };
const timer = { pathway: 'discretionary', stage: 'filed', scale: 1, reach: 'all' };

describe('parseSimLevers', () => {
  it('round-trips the defaults and the /fzp-compatible levers', () => {
    expect(parseSimLevers(DEFAULT_LEVERS)).toEqual(DEFAULT_LEVERS);
    expect(parseSimLevers(FZP_COMPAT_LEVERS)).toEqual(FZP_COMPAT_LEVERS);
  });

  it('returns a copy, not the input', () => {
    const out = parseSimLevers(DEFAULT_LEVERS);
    expect(out).not.toBe(DEFAULT_LEVERS);
    expect(out.stock).not.toBe(DEFAULT_LEVERS.stock);
  });

  it('normalises stock to canonical order without duplicates', () => {
    const out = parseSimLevers(with_({ stock: ['sb79', 'fzp', 'sb79'] }));
    expect(out.stock).toEqual(['fzp', 'sb79']);
  });

  it('accepts a fully populated document', () => {
    const full: SimLevers = {
      ...structuredClone(DEFAULT_LEVERS),
      user: [edit as SimLevers['user'][number]],
      protect: { rentControl: true, historic: true, newerThanYears: 15, lots: ['x'] },
      timers: [timer as SimLevers['timers'][number]],
      routeShares: { discretionary: 1, streamlined: 2, permitOnly: 0 }
    };
    expect(parseSimLevers(full)).toEqual(full);
  });

  it('rejects an empty stock', () => {
    expect(pathOf(with_({ stock: [] }))).toBe('stock');
  });

  it('rejects an unknown stock layer', () => {
    expect(pathOf(with_({ stock: ['nope'] }))).toBe('stock[0]');
  });

  it('rejects unknown keys at every level', () => {
    expect(pathOf(with_({ extra: 1 }))).toBe('extra');
    expect(pathOf(with_({ user: [{ ...edit, extra: 1 }] }))).toBe('user[0].extra');
    expect(pathOf(with_({ protect: { ...DEFAULT_LEVERS.protect, extra: 1 } }))).toBe(
      'protect.extra'
    );
    expect(pathOf(with_({ timers: [{ ...timer, extra: 1 }] }))).toBe('timers[0].extra');
  });

  it('rejects a wrong schema', () => {
    expect(pathOf(with_({ schema: 2 }))).toBe('schema');
  });

  it.each([-1, 256, 2.5])('rejects stories of %s', (stories) => {
    expect(pathOf(with_({ user: [{ ...edit, stories }] }))).toBe('user[0].stories');
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
    expect(pathOf(with_({ user: [{ ...edit, lots: [3] }] }))).toBe('user[0].lots[0]');
    expect(pathOf(with_({ protect: { ...DEFAULT_LEVERS.protect, lots: [null] } }))).toBe(
      'protect.lots[0]'
    );
  });

  it('rejects non-boolean flags and a bad compare', () => {
    expect(pathOf(with_({ assumeAlternativePlanKept: 1 }))).toBe('assumeAlternativePlanKept');
    expect(pathOf(with_({ compare: 'x' }))).toBe('compare');
  });
});

describe('CURRENT_LAW_SWITCH', () => {
  it('is 2032-01-31 and a tier 4 assumption', () => {
    expect(CURRENT_LAW_SWITCH.day).toBe(dayOf(2032, 1, 31));
    expect(CURRENT_LAW_SWITCH.provenance.tier).toBe(4);
  });
});
