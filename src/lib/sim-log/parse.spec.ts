import { describe, expect, it } from 'vitest';
import { parseChange, parseCommit, parseCommitDraft } from './parse';
import { LogFormatError } from './types';

const ID = 'CVBRX1eXcVRvAio3MBkuW'; // base58 of UUIDv7 019a8c3e-7b00-7000-8000-000000000001
type J = Record<string, unknown>;
const draft = (over: J = {}): J => ({
  id: ID,
  parent: 0,
  kind: 'edit',
  label: 'Renamed',
  restores: null,
  datasetVersion: 'fixture-0',
  shapes: 1,
  build: 'dev',
  source: 'sim.name',
  changes: [{ op: 'set', key: 'sim', field: 'name', value: 'Mission' }],
  ...over
});
const stored = (over: J = {}): J => ({
  ...draft(),
  seq: 1,
  actor: 'actor-1',
  at: 1763164800000,
  hash: 'a'.repeat(64),
  ...over
});
function failsAt(run: () => unknown, path: string): void {
  try {
    run();
  } catch (e) {
    expect(e).toBeInstanceOf(LogFormatError);
    expect((e as LogFormatError).path).toBe(path);
    return;
  }
  expect.unreachable(`expected a LogFormatError at ${path}`);
}

describe('parseChange', () => {
  it.each([
    [{ op: 'add', key: 'p:z1', shape: 'policy.painted', fields: { id: 'z1' }, after: null }],
    [{ op: 'add', key: 's:20000:z1', shape: 'span.painted', fields: { from: 20000 } }],
    [{ op: 'end', key: 's:20000:z1', to: 20100 }],
    [{ op: 'move', key: 'p:z1', after: 'p:z0' }],
    [{ op: 'set', key: 'p:z1', field: 'on', value: false }],
    [{ op: 'delete', key: 'p:z1' }]
  ])('parses %o', (c) => {
    expect(parseChange(c, 'c')).toStrictEqual(c);
  });
  it('rejects bad changes at their field', () => {
    failsAt(() => parseChange({ op: 'patch', key: 'x' }, 'c'), 'c.op');
    failsAt(() => parseChange({ op: 'end', key: 'x', to: 1.5 }, 'c'), 'c.to');
    failsAt(() => parseChange({ op: 'delete', key: '' }, 'c'), 'c.key');
    failsAt(() => parseChange({ op: 'delete', key: 'x', after: null }, 'c'), 'c.after');
    failsAt(() => parseChange({ op: 'set', key: 'x', field: 'on', value: [1] }, 'c'), 'c.value');
    failsAt(() => parseChange({ op: 'add', key: 'x', shape: 's', fields: [] }, 'c'), 'c.fields');
    failsAt(
      () => parseChange({ op: 'add', key: 'x', shape: 's', fields: { p: [[1, Infinity]] } }, 'c'),
      'c.fields.p[0][1]'
    );
  });
  it('omits an absent after rather than setting it undefined', () => {
    const c = parseChange({ op: 'add', key: 'x', shape: 's', fields: {} }, 'c');
    expect('after' in c).toBe(false);
  });
});

describe('parseCommitDraft', () => {
  it('returns an equal draft', () => {
    expect(parseCommitDraft(draft())).toStrictEqual(draft());
  });
  it('takes a restore with its target', () => {
    const d = draft({ parent: 5, kind: 'restore', restores: { position: 4, as: 'undo' } });
    expect(parseCommitDraft(d)).toStrictEqual(d);
  });
  it.each([
    [{ extra: 1 }, 'extra'],
    [{ id: 'not-an-id' }, 'id'],
    [{ parent: -1 }, 'parent'],
    [{ kind: 'merge' }, 'kind'],
    [{ kind: 'restore' }, 'restores'],
    [{ restores: { position: 0, as: 'undo' } }, 'restores'],
    [{ kind: 'restore', restores: { position: 1, as: 'undo' } }, 'restores.position'],
    [{ kind: 'restore', restores: { position: 0, as: 'sideways' } }, 'restores.as'],
    [{ label: 'x'.repeat(201) }, 'label'],
    [{ datasetVersion: 'latest' }, 'datasetVersion'],
    [{ shapes: 0 }, 'shapes'],
    [{ build: '' }, 'build'],
    [{ source: 'Bad Code' }, 'source'],
    [{ changes: [] }, 'changes'],
    [{ changes: [{ op: 'delete' }] }, 'changes[0].key']
  ])('rejects %o at %s', (over, path) => {
    failsAt(() => parseCommitDraft(draft(over)), path);
  });
});

describe('parseCommit', () => {
  it('returns an equal commit', () => {
    expect(parseCommit(stored())).toStrictEqual(stored());
  });
  it.each([
    [{ seq: 0 }, 'seq'],
    [{ seq: 2 }, 'parent'],
    [{ actor: '' }, 'actor'],
    [{ at: -1 }, 'at'],
    [{ hash: 'xyz' }, 'hash']
  ])('rejects %o at %s', (over, path) => {
    failsAt(() => parseCommit(stored(over)), path);
  });
});
