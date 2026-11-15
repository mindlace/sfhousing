import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { LocalStatus } from '$lib/sim-store/log-store.svelte';
import type { Stopped } from '$lib/sim-store/types';
import { saveState, type RegState, type SaveInput, type SaveState } from './save-state';
import { OFF_VIEW, type SocketView } from './sim-socket';

const base: SaveInput = {
  live: true,
  local: 'idle',
  pendingCount: 1,
  heldCount: 0,
  stopped: null,
  registration: 'done',
  socket: { ...OFF_VIEW, phase: 'live', write: true }
};
const at = (over: Partial<SaveInput> = {}, socket: Partial<SocketView> = {}): SaveInput => ({
  ...base,
  ...over,
  socket: { ...base.socket, ...socket }
});
const saved: SaveState = { kind: 'saved', why: null };
const saving: SaveState = { kind: 'saving', why: null };
const device = (why: SaveState['why']): SaveState => ({ kind: 'device', why });
const unsaved = (why: SaveState['why']): SaveState => ({ kind: 'unsaved', why });

describe('saveState', () => {
  it.each([
    ['V1 nothing pending or held', at({ pendingCount: 0 }), saved],
    [
      'V1 nothing pending, storage failed, offline',
      at({ pendingCount: 0, local: 'failed' }, { phase: 'offline' }),
      saved
    ],
    [
      'V2 nothing pending but commits held',
      at({ pendingCount: 0, heldCount: 1, stopped: 'stale' }),
      device('stale')
    ],
    [
      'V18 a look stopped stale, nothing pending or held',
      at({ pendingCount: 0, stopped: 'stale' }),
      saved
    ],
    ['V12 halted broken', at({}, { phase: 'halted', halt: 'broken' }), device('broken')],
    ['V3 pending, live, a writer', at(), saving],
    [
      'V4 pending, offline, the store writing',
      at({ local: 'writing' }, { phase: 'offline' }),
      saving
    ],
    ['V5 pending, offline', at({}, { phase: 'offline' }), device('offline')],
    [
      'V6 pending, offline, storage failed',
      at({ local: 'failed' }, { phase: 'offline' }),
      unsaved('offline')
    ],
    ['V7 dev', at({ live: false }, { phase: 'off' }), device('dev')],
    [
      'V7 dev, storage failed',
      at({ live: false, local: 'failed' }, { phase: 'off' }),
      unsaved('dev')
    ],
    ['V8 sign-in', at({ registration: 'sign-in' }, { phase: 'off' }), device('sign-in')],
    ['V8 taken', at({ registration: 'taken' }, { phase: 'off' }), device('taken')],
    ['V8 quota', at({ registration: 'quota' }, { phase: 'off' }), device('quota')],
    ['V8 failed', at({ registration: 'failed' }, { phase: 'off' }), device('register-failed')],
    ['V9 retrying', at({ registration: 'retrying' }, { phase: 'off' }), device('unreachable')],
    ['V10 registering', at({ registration: 'registering' }, { phase: 'off' }), saving],
    ['V10 waiting for the first write', at({ registration: 'waiting' }, { phase: 'off' }), saving],
    ['V11 not-writer', at({}, { hold: 'not-writer' }), device('no-write')],
    ['V11 write false', at({}, { write: false }), device('no-write')],
    ['V12 halted gone', at({}, { phase: 'halted', halt: 'gone' }), device('gone')],
    ['V12 halted diverged', at({}, { phase: 'halted', halt: 'diverged' }), device('diverged')],
    ['V12 halted protocol', at({}, { phase: 'halted', halt: 'protocol' }), device('protocol')],
    ['V13 full', at({}, { hold: 'full' }), device('full')],
    ['V13 newer', at({}, { hold: 'newer' }), device('newer')],
    ['V14 limit', at({}, { hold: 'limit' }), saving],
    ['V15 waiting to reconnect', at({}, { phase: 'waiting' }), device('unreachable')],
    ['V15 connecting', at({}, { phase: 'connecting', write: null }), saving],
    ['V15 catching up', at({}, { phase: 'catching-up' }), saving],
    ['V16 future, even live', at({ stopped: 'future' }), device('future')],
    [
      'V17 unknown dataset while live',
      at({ stopped: 'unknown-dataset' }),
      device('unknown-dataset')
    ],
    [
      'V17 unknown dataset while connecting',
      at({ stopped: 'unknown-dataset' }, { phase: 'connecting', write: null }),
      saving
    ],
    [
      'order: taken before offline',
      at({ registration: 'taken' }, { phase: 'offline' }),
      device('taken')
    ],
    [
      'order: a halt before stale',
      at({ stopped: 'stale' }, { phase: 'halted', halt: 'gone' }),
      device('gone')
    ]
  ] as const)('%s', (_, input, want) => {
    expect(saveState(input)).toEqual(want);
  });

  it('S9: saved exactly when nothing is pending or held; never device with storage failed', () => {
    const regs: RegState[] = [
      'idle',
      'none',
      'waiting',
      'registering',
      'retrying',
      'sign-in',
      'taken',
      'quota',
      'failed',
      'done'
    ];
    const view: fc.Arbitrary<SocketView> = fc.record({
      phase: fc.constantFrom<SocketView['phase']>(
        'off',
        'connecting',
        'catching-up',
        'live',
        'offline',
        'waiting',
        'halted'
      ),
      halt: fc.constantFrom<SocketView['halt']>(null, 'gone', 'diverged', 'protocol', 'broken'),
      hold: fc.constantFrom<SocketView['hold']>(null, 'not-writer', 'limit', 'full', 'newer'),
      write: fc.constantFrom<boolean | null>(null, true, false),
      serverBuild: fc.constant(null),
      inFlight: fc.constant(null)
    });
    const input: fc.Arbitrary<SaveInput> = fc.record({
      live: fc.boolean(),
      local: fc.constantFrom<LocalStatus>('idle', 'writing', 'failed'),
      pendingCount: fc.nat({ max: 3 }),
      heldCount: fc.nat({ max: 2 }),
      stopped: fc.constantFrom<Stopped | null>(null, 'future', 'stale', 'unknown-dataset'),
      registration: fc.constantFrom(...regs),
      socket: view
    });
    expect(() =>
      fc.assert(
        fc.property(input, (i) => {
          const s = saveState(i);
          const owed = i.pendingCount > 0 || i.heldCount > 0;
          if (owed === (s.kind === 'saved')) return false;
          return !(i.local === 'failed' && s.kind === 'device');
        }),
        { seed: 42, numRuns: 2000 }
      )
    ).not.toThrow();
  });
});
