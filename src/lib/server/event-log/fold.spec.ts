import { describe, it, expect } from 'vitest';
import { foldEventLog, foldLatest, foldRevokeWins } from './fold';

describe('foldLatest', () => {
  it('keeps the last event per key in pre-sorted log order', () => {
    const events = [
      { k: 'a', v: 1 },
      { k: 'b', v: 2 },
      { k: 'a', v: 3 }
    ];
    const out = foldLatest(events, (e) => e.k);
    expect(out.get('a')).toEqual({ k: 'a', v: 3 });
    expect(out.get('b')).toEqual({ k: 'b', v: 2 });
    expect([...out.keys()]).toEqual(['a', 'b']);
  });
});

describe('foldEventLog', () => {
  it('walks events into the accumulator, supporting install/mutate/delete', () => {
    type Ev = { kind: 'add' | 'rename' | 'del'; id: string; name?: string };
    const events: Ev[] = [
      { kind: 'add', id: 'x', name: 'X0' },
      { kind: 'rename', id: 'x', name: 'X1' },
      { kind: 'add', id: 'y', name: 'Y0' },
      { kind: 'del', id: 'y' }
    ];
    const out = foldEventLog<Ev, { name: string }>(events, (acc, e) => {
      if (e.kind === 'add') acc.set(e.id, { name: e.name! });
      else if (e.kind === 'rename') {
        const cur = acc.get(e.id);
        if (cur) cur.name = e.name!;
      } else acc.delete(e.id);
    });
    expect([...out.entries()]).toEqual([['x', { name: 'X1' }]]);
  });
});

describe('foldRevokeWins', () => {
  const stamp = (e: { at: number }) => e.at;
  const key = (e: { id: string }) => e.id;
  const isRevoke = (e: { action: string }) => e.action === 'revoke';

  it('last-write-wins by stamp', () => {
    const events = [
      { id: 'a', action: 'grant', at: 1 },
      { id: 'a', action: 'revoke', at: 2 }
    ];
    expect(foldRevokeWins(events, { key, stamp, isRevoke }).get('a')!.action).toBe('revoke');
  });

  it('on an equal stamp, revoke beats grant regardless of arrival order', () => {
    const grantLast = [
      { id: 'a', action: 'revoke', at: 5 },
      { id: 'a', action: 'grant', at: 5 }
    ];
    expect(foldRevokeWins(grantLast, { key, stamp, isRevoke }).get('a')!.action).toBe('revoke');
    const revokeLast = [
      { id: 'a', action: 'grant', at: 5 },
      { id: 'a', action: 'revoke', at: 5 }
    ];
    expect(foldRevokeWins(revokeLast, { key, stamp, isRevoke }).get('a')!.action).toBe('revoke');
  });

  it('a strictly later grant overrides an earlier revoke', () => {
    const events = [
      { id: 'a', action: 'revoke', at: 1 },
      { id: 'a', action: 'grant', at: 9 }
    ];
    expect(foldRevokeWins(events, { key, stamp, isRevoke }).get('a')!.action).toBe('grant');
  });
});
