import { describe, expect, it } from 'vitest';
import { accessChanges, canWrite, newSocketId, parseAttachment } from './access';
import { utf8Bytes } from './limits';

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
    expect(accessChanges(sockets, writers)).toEqual([0, 1, 3, 4]);
  });

  it('revokes a socket whose identity is absent from the map; leaves one that cannot write', () => {
    const sockets = [
      { identity: 'gone', write: true },
      { identity: 'gone', write: false },
      { identity: 'kept', write: true }
    ];
    expect(accessChanges(sockets, new Map([['kept', true]]))).toEqual([0]);
    expect(accessChanges(sockets, new Map())).toEqual([0, 2]);
  });

  it('refuses any string that is not a role', () => {
    const bad = ['toString', '__proto__', 'constructor', 'hasOwnProperty', 'owner', ''];
    for (const r of bad) expect(canWrite(r as never)).toBe(false);
    expect(canWrite(undefined as never)).toBe(false);
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

  it("reads the socket's id, and still reads an attachment from before ids", () => {
    const sid = newSocketId();
    expect(parseAttachment({ identity: null, write: false, resumed: true, sid })).toEqual({
      identity: null,
      write: false,
      resumed: true,
      sid
    });
    expect(parseAttachment({ identity: 'a', write: false, resumed: false })).not.toHaveProperty(
      'sid'
    );
  });

  it.each<[string, unknown]>([
    ['a numeric id', 7],
    ['an empty id', ''],
    ['a null id', null],
    ['an id of the wrong form', 'not-a-socket-id'],
    ['an id too long', 'a'.repeat(25)]
  ])('refuses an attachment with %s', (_, sid) => {
    expect(parseAttachment({ identity: 'a', write: false, resumed: false, sid })).toBeNull();
  });

  it('mints short random socket ids, each different, that name no one', () => {
    const minted = Array.from({ length: 50 }, () => newSocketId());
    for (const sid of minted) expect(sid).toMatch(/^[0-9a-f]{24}$/);
    expect(new Set(minted).size).toBe(50);
    expect(
      utf8Bytes(
        JSON.stringify({ identity: 'x'.repeat(64), write: true, resumed: true, sid: minted[0] })
      )
    ).toBeLessThan(200);
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
