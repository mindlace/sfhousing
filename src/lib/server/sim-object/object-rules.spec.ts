import { describe, expect, it } from 'vitest';
import { CLOSE_BINARY, CLOSE_MALFORMED } from '$lib/sim-stream/protocol';
import { LIMITS } from './limits';
import {
  closeReply,
  distinctIdentities,
  openStatus,
  readMessage,
  roleChanges
} from './object-rules';
import type { OpenParams } from './open-params';

const params: OpenParams = {
  identity: 'id-1',
  write: true,
  title: 'T',
  datasetVersion: 'fixture-0',
  build: 'b'
};
const open = { upgrade: 'websocket', params, simId: 's1', host: true, gone: false };
const att = { identity: 'id-1', write: true, resumed: false };

describe('openStatus', () => {
  it('opens a well-formed upgrade', () => {
    expect(openStatus(open)).toBeNull();
    expect(openStatus({ ...open, upgrade: 'WebSocket' })).toBeNull();
  });

  it('refuses in order: 426, 400, 503, 410', () => {
    expect(openStatus({ ...open, upgrade: null, params: null, host: false })).toBe(426);
    expect(openStatus({ ...open, upgrade: 'h2c' })).toBe(426);
    expect(openStatus({ ...open, params: null, host: false })).toBe(400);
    expect(openStatus({ ...open, simId: undefined })).toBe(400);
    expect(openStatus({ ...open, simId: '' })).toBe(400);
    expect(openStatus({ ...open, host: false, gone: true })).toBe(503);
    expect(openStatus({ ...open, gone: true })).toBe(410);
  });
});

describe('readMessage', () => {
  it('closes 1003 on a binary message', () => {
    expect(readMessage(new ArrayBuffer(2), att)).toEqual({
      kind: 'close',
      code: CLOSE_BINARY,
      reason: 'binary'
    });
  });

  it('closes 1008 without a valid attachment or on a malformed frame', () => {
    const resume = JSON.stringify({ type: 'resume', after: 0 });
    expect(readMessage(resume, null)).toEqual({
      kind: 'close',
      code: CLOSE_MALFORMED,
      reason: 'malformed'
    });
    expect(readMessage(resume, { ...att, extra: 1 })).toEqual({
      kind: 'close',
      code: CLOSE_MALFORMED,
      reason: 'malformed'
    });
    expect(readMessage('{"type":"nope"}', att)).toEqual({
      kind: 'close',
      code: CLOSE_MALFORMED,
      reason: 'malformed'
    });
    expect(readMessage('not json', att)).toEqual({
      kind: 'close',
      code: CLOSE_MALFORMED,
      reason: 'malformed'
    });
  });

  it('answers an oversized text without parsing it', () => {
    const small = { ...LIMITS, frameBytes: 10 };
    expect(readMessage('not json at all', att, small)).toEqual({ kind: 'oversized' });
  });

  it('hands back the frame, the attachment and the UTF-8 size', () => {
    const text = JSON.stringify({ type: 'append', commit: { id: 'c1', label: 'é' } });
    expect(readMessage(text, att)).toEqual({
      kind: 'frame',
      frame: { type: 'append', commit: { id: 'c1', label: 'é' }, id: 'c1' },
      attachment: att,
      bytes: text.length + 1
    });
  });
});

describe('closeReply', () => {
  it('echoes a sendable code and replaces the reserved ones with 1000', () => {
    expect(closeReply(1000)).toBe(1000);
    expect(closeReply(1001)).toBe(1001);
    expect(closeReply(4000)).toBe(4000);
    expect([closeReply(1005), closeReply(1006), closeReply(1015)]).toEqual([1000, 1000, 1000]);
  });
});

describe('roleChanges', () => {
  it('names each socket whose right changed, with its new attachment', () => {
    const sockets = [
      { identity: 'a', write: true, resumed: true },
      { identity: 'b', write: false, resumed: false },
      { identity: 'c', write: true, resumed: true },
      { identity: null, write: false, resumed: true }
    ];
    const writers = new Map([
      ['a', false],
      ['b', true],
      ['c', true]
    ]);
    expect(roleChanges(sockets, writers)).toEqual([
      { index: 0, attachment: { identity: 'a', write: false, resumed: true } },
      { index: 1, attachment: { identity: 'b', write: true, resumed: false } }
    ]);
  });

  it('leaves alone a socket whose identity was not read, or whose attachment is invalid', () => {
    // A socket opened while the roles were read: the Worker has just set its right.
    const sockets = [{ identity: 'new', write: true, resumed: false }, 'junk'];
    expect(roleChanges(sockets, new Map([['a', false]]))).toEqual([]);
  });
});

describe('distinctIdentities', () => {
  it('lists each identity of a valid attachment once', () => {
    expect(
      distinctIdentities([
        att,
        { identity: 'id-2', write: false, resumed: true },
        { identity: null, write: false, resumed: true },
        { ...att, resumed: true },
        'junk',
        null
      ])
    ).toEqual(['id-1', 'id-2']);
  });
});
