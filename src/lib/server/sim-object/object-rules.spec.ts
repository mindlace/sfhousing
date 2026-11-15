import { describe, expect, it, vi } from 'vitest';
import { CLOSE_BINARY, CLOSE_MALFORMED, PROTOCOL } from '$lib/sim-stream/protocol';
import { LIMITS } from './limits';
import { DrizzleQueryError } from 'drizzle-orm';
import {
  LOG_MAX,
  NON_ERROR,
  QUERY_FAILED,
  closeReply,
  distinctIdentities,
  helloFrame,
  loggable,
  openStatus,
  ROLE_READ_FAILED,
  readMessage,
  receivesLive,
  rereadChanges,
  roleChanges,
  serverAppendResult,
  withResumed
} from './object-rules';
import type { OpenParams } from './open-params';
import type { AppendOutcome } from './log-host';
import { nameDraft } from './test/drafts';

describe('serverAppendResult', () => {
  it('names the position of an accepted commit, and nothing of its body', () => {
    const commit = { ...nameDraft(0, 'A'), seq: 1, actor: 'u1', at: 1, hash: 'h' };
    const out: AppendOutcome = { kind: 'accepted', commit, body: JSON.stringify(commit) };
    expect(serverAppendResult(out)).toStrictEqual({ kind: 'accepted', seq: 1 });
  });

  it('a duplicate is a duplicate, with no id', () => {
    expect(serverAppendResult({ kind: 'duplicate', id: 'x' })).toStrictEqual({
      kind: 'duplicate'
    });
  });

  it('a refusal keeps its reason and drops the id', () => {
    expect(serverAppendResult({ kind: 'refused', id: 'x', why: 'limit' })).toStrictEqual({
      kind: 'refused',
      why: 'limit'
    });
    expect(serverAppendResult({ kind: 'refused', id: null, why: 'gone' })).toStrictEqual({
      kind: 'refused',
      why: 'gone'
    });
  });
});

const params: OpenParams = {
  identity: 'id-1',
  write: true,
  title: 'T',
  datasetVersion: 'fixture-0',
  build: 'b'
};
describe('helloFrame', () => {
  it('carries the build, the protocol and the server dataset (R55)', () => {
    expect(JSON.parse(helloFrame(params))).toEqual({
      type: 'hello',
      build: params.build,
      protocol: PROTOCOL,
      dataset: params.datasetVersion
    });
  });
});

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

describe('loggable', () => {
  const identity = 'ident-7Hx9QpL2';

  it('never logs a failed query or its bound parameters', () => {
    const e = new DrizzleQueryError(
      'select * from x where id = ?',
      [identity],
      new Error('D1_ERROR: busy')
    );
    expect(loggable(e)).toBe('D1_ERROR: busy');
    expect(loggable(e)).not.toContain(identity);
    const bare = new DrizzleQueryError('select * from x where id = ?', [identity]);
    expect(loggable(bare)).not.toContain(identity);
    expect(loggable(bare)).toBe(QUERY_FAILED);
  });

  it('gives a plain error its message, and a nested cause the innermost one', () => {
    expect(loggable(new Error('boom'))).toBe('boom');
    const inner = new Error('innermost');
    const mid = new Error('middle', { cause: inner });
    expect(loggable(new Error('outer', { cause: mid }))).toBe('innermost');
    expect(loggable(new Error('outer', { cause: 'not an error' }))).toBe('outer');
  });

  it('uses a placeholder for a non-Error and cuts a long message', () => {
    expect(loggable('a string')).toBe(NON_ERROR);
    expect(loggable({ message: identity })).toBe(NON_ERROR);
    const long = loggable(new Error('x'.repeat(LOG_MAX * 2)));
    expect(long.length).toBe(LOG_MAX);
    expect(long.endsWith('…')).toBe(true);
  });

  it('stops on a cause cycle', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    a.cause = b;
    expect(['a', 'b']).toContain(loggable(a));
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

describe('withResumed and receivesLive', () => {
  it('marks a valid attachment resumed, and only a resumed socket receives live commits', () => {
    expect(receivesLive(att)).toBe(false);
    const marked = withResumed(att);
    expect(marked).toEqual({ ...att, resumed: true });
    expect(receivesLive(marked)).toBe(true);
  });

  it('leaves an invalid attachment unmarked and sends it nothing', () => {
    for (const bad of [null, 'junk', { ...att, extra: 1 }, { identity: null, write: true }]) {
      expect(withResumed(bad)).toBeNull();
      expect(receivesLive(bad)).toBe(false);
    }
  });

  it('keeps a write changed by a concurrent rereadRoles', () => {
    // rereadRoles revoked write while the resume answer was going out: the mark reads the
    // socket's current attachment, so the revocation stands.
    const revoked = { ...att, write: false };
    expect(withResumed(revoked)).toEqual({ identity: 'id-1', write: false, resumed: true });
  });
});

describe('rereadChanges', () => {
  const sockets = [
    { identity: 'a', write: true, resumed: true },
    { identity: 'b', write: false, resumed: false },
    { identity: null, write: false, resumed: true }
  ];

  it('reads each identity once and names the sockets whose right changed', async () => {
    const read = vi.fn(async (id: string) => id === 'b');
    const changes = await rereadChanges(() => [...sockets, sockets[0]], read, 's1');
    expect(read.mock.calls.map((c) => c[0]).sort()).toEqual(['a', 'b']);
    expect(changes).toEqual([
      { index: 0, attachment: { identity: 'a', write: false, resumed: true } },
      { index: 1, attachment: { identity: 'b', write: true, resumed: false } },
      { index: 3, attachment: { identity: 'a', write: false, resumed: true } }
    ]);
  });

  it('names sockets from the list taken after the read', async () => {
    let calls = 0;
    const list = () => (calls++ === 0 ? sockets : [sockets[1], sockets[0]]);
    expect(await rereadChanges(list, async () => false, 's1')).toEqual([
      { index: 1, attachment: { identity: 'a', write: false, resumed: true } }
    ]);
  });

  it('returns nothing, reading nothing, when no socket has an identity', async () => {
    const read = vi.fn(async () => true);
    expect(await rereadChanges(() => [], read, 's1')).toEqual([]);
    expect(await rereadChanges(() => [sockets[2], 'junk'], read, 's1')).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });

  it('on a failed read logs once, revokes nobody and throws a fixed message', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const identity = 'ident-7Hx9QpL2';
    const read = vi.fn(async (id: string) => {
      if (id === identity) throw new Error('D1 busy');
      return false;
    });
    const list = [{ identity, write: true, resumed: true }, sockets[0]];
    const failed = await rereadChanges(() => list, read, 's1').catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(Error);
    expect((failed as Error).message).toBe(ROLE_READ_FAILED);
    expect((failed as Error).message).not.toContain(identity);
    expect(err).toHaveBeenCalledOnce();
    expect(err.mock.calls[0].join(' ')).toContain('s1');
    expect(err.mock.calls[0].join(' ')).toContain('D1 busy');
    err.mockRestore();
  });
});
