import { describe, expect, it } from 'vitest';
import { accessChanges, canWrite, parseAttachment } from './access';

describe('access', () => {
  it('managers and editors write; viewers and strangers read', () => {
    expect([canWrite('manager'), canWrite('editor'), canWrite('viewer'), canWrite(null)]).toEqual([
      true,
      true,
      false,
      false
    ]);
  });

  it('lists the sockets whose right to write changed', () => {
    const sockets = [
      { identity: 'a', write: true },
      { identity: 'b', write: false },
      { identity: null, write: false },
      { identity: 'a', write: true },
      { identity: 'c', write: true }
    ];
    const writers = new Map([
      ['a', false],
      ['b', true]
    ]);
    expect(accessChanges(sockets, writers)).toEqual([0, 1, 3]);
  });

  it('never grants a signed-out socket, whatever the map holds', () => {
    const writers = new Map([['null', true]]);
    expect(accessChanges([{ identity: null, write: false }], writers)).toEqual([]);
  });

  it('reads only a well-formed attachment', () => {
    expect(parseAttachment({ identity: 'a', write: true, resumed: false })).toEqual({
      identity: 'a',
      write: true,
      resumed: false
    });
    expect(parseAttachment(null)).toBeNull();
    expect(parseAttachment({ identity: 'a', write: 'yes', resumed: false })).toBeNull();
  });

  it.each<[string, unknown]>([
    ['undefined', undefined],
    ['a string', 'x'],
    ['an array', []],
    ['an unknown key', { identity: 'a', write: false, resumed: false, extra: 1 }],
    ['a missing resumed', { identity: 'a', write: false }],
    ['a missing identity', { write: false, resumed: false }],
    ['a writer with no identity', { identity: null, write: true, resumed: false }],
    ['an empty identity', { identity: '', write: false, resumed: false }],
    ['a long identity', { identity: 'x'.repeat(65), write: false, resumed: false }],
    ['a numeric resumed', { identity: 'a', write: false, resumed: 0 }]
  ])('refuses an attachment with %s', (_, v) => {
    expect(parseAttachment(v)).toBeNull();
  });
});
