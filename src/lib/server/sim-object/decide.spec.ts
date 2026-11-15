import { describe, expect, it } from 'vitest';
import { decideAppend, type AppendGate } from './decide';
import { LIMITS } from './limits';
import { nameDraft } from './test/drafts';

function makeGate(over: Partial<AppendGate> = {}): { gate: AppendGate; tokens: () => number } {
  let tokens = 0;
  const gate: AppendGate = {
    gone: false,
    write: true,
    identity: 'u1',
    takeToken: () => {
      tokens++;
      return true;
    },
    tip: 1,
    bytes: 1000,
    hasId: () => false,
    ...over
  };
  return { gate, tokens: () => tokens };
}
const gate = (over: Partial<AppendGate> = {}) => makeGate(over).gate;

describe('decideAppend', () => {
  const draft = nameDraft(1, 'Garden');

  it('accepts a valid commit on the tip, parsed', () => {
    expect(decideAppend(gate(), draft, draft.id, 400)).toEqual({ kind: 'accept', draft });
  });

  it.each<[string, Partial<AppendGate>, string]>([
    ['a sim taken down', { gone: true }, 'gone'],
    ['a socket that may not write', { write: false }, 'not-writer'],
    ['a socket with no identity', { identity: null }, 'not-writer'],
    ['no rate token', { takeToken: () => false }, 'limit'],
    ['a stale parent', { tip: 2 }, 'behind'],
    ['a parent ahead of the tip', { tip: 0 }, 'behind'],
    ['a sim at its length cap', { tip: LIMITS.simCommits }, 'limit'],
    ['a sim at its size cap', { bytes: LIMITS.simBytes }, 'limit']
  ])('refuses %s', (_, over, why) => {
    expect(decideAppend(gate(over), draft, draft.id, 400)).toEqual({
      kind: 'refused',
      id: draft.id,
      why
    });
  });

  it('refuses an oversized frame as limit before parsing it', () => {
    expect(decideAppend(gate(), { junk: true }, 'x', LIMITS.frameBytes + 1)).toEqual({
      kind: 'refused',
      id: 'x',
      why: 'limit'
    });
  });

  it('refuses a commit that does not parse as invalid', () => {
    expect(decideAppend(gate(), { ...draft, kind: 'other' }, draft.id, 400)).toMatchObject({
      why: 'invalid'
    });
    expect(decideAppend(gate(), 7, null, 4)).toEqual({ kind: 'refused', id: null, why: 'invalid' });
  });

  it('treats a stored id as a duplicate, even on a stale parent', () => {
    expect(
      decideAppend(gate({ tip: 5, hasId: (x) => x === draft.id }), draft, draft.id, 400)
    ).toEqual({ kind: 'duplicate', id: draft.id });
  });

  it('checks gone, then the writer, then the rate', () => {
    expect(decideAppend(gate({ gone: true, write: false }), draft, draft.id, 400)).toMatchObject({
      why: 'gone'
    });
    expect(
      decideAppend(gate({ write: false, takeToken: () => false }), draft, draft.id, 400)
    ).toMatchObject({ why: 'not-writer' });
    expect(decideAppend(gate({ takeToken: () => false }), { junk: 1 }, null, 4)).toMatchObject({
      why: 'limit'
    });
  });

  it('takes no token for a gone or not-writer append', () => {
    for (const over of [{ gone: true }, { write: false }, { identity: null }]) {
      const g = makeGate(over);
      decideAppend(g.gate, draft, draft.id, 400);
      expect(g.tokens()).toBe(0);
    }
  });

  it('takes one token for a refused parse, a stale parent, a duplicate and an accept', () => {
    const cases: [Partial<AppendGate>, unknown][] = [
      [{}, 7],
      [{ tip: 9 }, draft],
      [{ hasId: () => true }, draft],
      [{}, draft]
    ];
    for (const [over, commit] of cases) {
      const g = makeGate(over);
      decideAppend(g.gate, commit, null, 400);
      expect(g.tokens()).toBe(1);
    }
  });

  it('honours injected limits', () => {
    const small = { ...LIMITS, simCommits: 1 };
    expect(decideAppend(gate(), draft, draft.id, 400, small)).toMatchObject({ why: 'limit' });
  });
});
