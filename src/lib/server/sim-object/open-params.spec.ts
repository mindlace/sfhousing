import { describe, expect, it } from 'vitest';
import { DEFAULT_SIM_NAME } from '$lib/sim-log';
import { checkName } from '$lib/sim-log/shapes';
import { encodeOpenParams, headerTitle, parseOpenParams, type OpenParams } from './open-params';

const ok: OpenParams = {
  identity: 'u1',
  write: true,
  title: 'Garden',
  datasetVersion: 'fixture-0',
  build: 'dev'
};

describe('open params', () => {
  it('round-trips', () => {
    expect(parseOpenParams(encodeOpenParams(ok))).toEqual(ok);
    const reader = { ...ok, identity: null, write: false };
    expect(parseOpenParams(encodeOpenParams(reader))).toEqual(reader);
  });

  it('encodes to a header value: ASCII only, and a non-Latin title survives', () => {
    const title = 'Jardín 庭';
    const header = encodeOpenParams({ ...ok, title });
    expect(/^[\x20-\x7e]*$/.test(header)).toBe(true);
    expect(() => new Headers({ x: header })).not.toThrow();
    expect(parseOpenParams(header)?.title).toBe(title);
  });

  it('round-trips an astral character, and a 63-character non-Latin title stays bounded', () => {
    const astral = { ...ok, title: 'a😀b' };
    expect(parseOpenParams(encodeOpenParams(astral))).toEqual(astral);
    const long = { ...ok, title: '庭'.repeat(63) };
    const header = encodeOpenParams(long);
    expect(header.length).toBeLessThan(600);
    expect(parseOpenParams(header)).toEqual(long);
  });

  it.each<[string, unknown]>([
    ['a writer with no identity', { ...ok, identity: null }],
    ['an unknown key', { ...ok, extra: 1 }],
    ['a missing key', { identity: 'u1', write: true, title: 'G', datasetVersion: 'fixture-0' }],
    ['a bad dataset version', { ...ok, datasetVersion: 'latest' }],
    ['an empty build', { ...ok, build: '' }],
    ['a long build', { ...ok, build: 'b'.repeat(1000) }],
    ['an empty title', { ...ok, title: '' }],
    ['a long title', { ...ok, title: 't'.repeat(64) }],
    ['an empty identity', { ...ok, identity: '' }],
    ['a long identity', { ...ok, identity: 'x'.repeat(65) }],
    ['a numeric identity', { ...ok, identity: 1 }],
    ['a string write', { ...ok, write: 'true' }],
    ['a missing write', { identity: 'u1', title: 'G', datasetVersion: 'fixture-0', build: 'd' }],
    ['an array', [ok]],
    ['null', null],
    ['a string', 'u1']
  ])('refuses %s', (_, v) => {
    expect(parseOpenParams(JSON.stringify(v))).toBeNull();
  });

  it('refuses no header, an empty header and junk', () => {
    expect(parseOpenParams(null)).toBeNull();
    expect(parseOpenParams('')).toBeNull();
    expect(parseOpenParams('{')).toBeNull();
  });

  it('headerTitle makes any stored title one the header and the name check accept', () => {
    expect(headerTitle('Garden')).toBe('Garden');
    expect(headerTitle('  Garden \n')).toBe('Garden');
    expect(headerTitle('t'.repeat(80))).toBe('t'.repeat(63));
    expect(headerTitle('a'.repeat(62) + ' b')).toBe('a'.repeat(62));
    expect(headerTitle('a'.repeat(62) + '😀')).toBe('a'.repeat(62));
    expect(headerTitle('a'.repeat(61) + '😀')).toBe('a'.repeat(61) + '😀');
    expect(headerTitle('')).toBe(DEFAULT_SIM_NAME);
    expect(headerTitle(' \t ')).toBe(DEFAULT_SIM_NAME);
    for (const t of ['  x ', 'é'.repeat(99), ' ', '😀'.repeat(40)]) {
      const title = headerTitle(t);
      expect(parseOpenParams(encodeOpenParams({ ...ok, title }))?.title).toBe(title);
      expect(() => checkName(title, 'name')).not.toThrow();
    }
  });

  it('accepts the limits exactly', () => {
    const edge = { ...ok, identity: 'x'.repeat(64), title: 't'.repeat(63) };
    expect(parseOpenParams(JSON.stringify(edge))).toEqual(edge);
  });
});
