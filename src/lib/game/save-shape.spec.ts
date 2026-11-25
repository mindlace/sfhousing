import { describe, expect, it } from 'vitest';
import { newId } from '../ids/base58';
import { parseGameSave, parseGameState, parseRunResult, type GameSave } from './save-shape';
import type { RunResult } from './run-result';
import { NEW_GAME, type GameState } from './state';

const T = '2026-11-02T00:00:00.000Z';
const STAGES = {
  preApplication: 0,
  filed: 1,
  entitled: 2,
  permitFiled: 3,
  permitIssued: 4,
  construction: 5
};

function validResult(): RunResult {
  return {
    rung: 0,
    amount: 82069,
    datasetVersion: 'fixture-0',
    at: T,
    homes: 80000,
    reachedOn: 20000,
    stages: { ...STAGES },
    waitingMoney: null,
    dropped: { home: 10 },
    collected: { home: 8 },
    lump: { home: 2000 },
    side: [{ id: 'collect-run', reward: { home: 500 } }]
  };
}

function validState(): GameState {
  return {
    v: 2,
    phase: 'runs',
    firstWinAt: T,
    bought: { 'permit-1': 2 },
    units: { home: 150 },
    rung: 1,
    met: [{ rung: 0, reachedOn: 20000, datasetVersion: 'fixture-0', at: T }],
    side: { 'collect-run': T },
    runs: 3,
    last: validResult()
  };
}

function validSave(): GameSave {
  return {
    v: 2,
    id: newId(),
    name: 'Game, 4 Mar',
    nameIsDefault: true,
    state: validState(),
    plan: null,
    policy: 'x',
    savedAt: T
  };
}

const json = (x: unknown) => JSON.parse(JSON.stringify(x));
type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A save with the state changed by `f`. */
function withState(f: (s: Any) => void): unknown {
  const save = json(validSave());
  f(save.state);
  return save;
}
function withSave(f: (s: Any) => void): unknown {
  const save = json(validSave());
  f(save);
  return save;
}

describe('parseGameSave', () => {
  it('parses a valid save equal to itself', () => {
    const s = validSave();
    expect(parseGameSave(json(s))).toEqual(s);
  });

  it('round-trips a save of NEW_GAME', () => {
    const s: GameSave = { ...validSave(), state: NEW_GAME };
    expect(parseGameSave(json(s))).toEqual(s);
  });

  it('rejects other versions', () => {
    expect(parseGameSave(withSave((s) => (s.v = 1)))).toBeNull();
    expect(parseGameSave(withState((s) => (s.v = 1)))).toBeNull();
    expect(parseGameSave(withState((s) => delete s.v))).toBeNull();
  });

  it.each([
    ['an array', (s: Any) => s, true],
    ['a bad id', (s: Any) => (s.id = 'not an id!'), false],
    ['a leading space in the name', (s: Any) => (s.name = ' Game'), false],
    ['an empty name', (s: Any) => (s.name = ''), false],
    ['a 61 code point name', (s: Any) => (s.name = 'é'.repeat(61)), false],
    ['nameIsDefault text', (s: Any) => (s.nameIsDefault = 'yes'), false],
    ['a bad savedAt', (s: Any) => (s.savedAt = 'never'), false],
    ['a numeric plan', (s: Any) => (s.plan = 5), false],
    ['a numeric policy', (s: Any) => (s.policy = 5), false],
    ['a null state', (s: Any) => (s.state = null), false]
  ])('rejects %s', (_label, f, asArray) => {
    const save: unknown = withSave(f);
    expect(parseGameSave(asArray ? [save] : save)).toBeNull();
  });

  it('accepts a 60 code point name', () => {
    const r = parseGameSave(withSave((s) => (s.name = 'é'.repeat(60))));
    expect(r?.name).toBe('é'.repeat(60));
  });

  it('rejects a missing field', () => {
    expect(parseGameSave(withSave((s) => delete s.plan))).toBeNull();
    expect(parseGameSave(withState((s) => delete s.runs))).toBeNull();
  });

  it('drops unknown fields at the top, in the state and in last', () => {
    const save = withSave((s) => {
      s.extra = 1;
      s.state.extra = 1;
      s.state.last.extra = 1;
    });
    const r = parseGameSave(save);
    expect(r).not.toBeNull();
    expect(r).not.toHaveProperty('extra');
    expect(r?.state).not.toHaveProperty('extra');
    expect(r?.state.last).not.toHaveProperty('extra');
    expect(r).toEqual(validSave_withId(r));
  });

  it('keeps drift', () => {
    const r = parseGameSave(
      withState((s) => {
        s.bought = { 'no-such-node': 9 };
        s.side = { 'no-such-goal': T };
        s.rung = 99;
      })
    );
    expect(r?.state.bought).toEqual({ 'no-such-node': 9 });
    expect(r?.state.side).toEqual({ 'no-such-goal': T });
    expect(r?.state.rung).toBe(99);
  });

  it('keeps __proto__ as an own key of bought and side', () => {
    const save = withState((s) => {
      s.bought = JSON.parse('{"__proto__": 2}');
      s.side = JSON.parse('{"__proto__": "' + T + '"}');
    });
    const r = parseGameSave(save);
    expect(r).not.toBeNull();
    expect(Object.hasOwn(r!.state.bought, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(r!.state.bought, '__proto__')?.value).toBe(2);
    expect(Object.getPrototypeOf(r!.state.bought)).toBe(Object.prototype);
    expect(Object.hasOwn(r!.state.side, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(r!.state.side, '__proto__')?.value).toBe(T);
    expect(Object.getPrototypeOf(r!.state.side)).toBe(Object.prototype);
  });
});

/** The parsed value stands for itself; used to compare what remains after dropping. */
function validSave_withId(r: GameSave | null): GameSave {
  return { ...validSave(), id: r!.id };
}

describe('parseGameState', () => {
  const parse = (f: (s: Any) => void) =>
    parseGameState(
      json(
        (() => {
          const s = json(validState());
          f(s);
          return s;
        })()
      )
    );

  it.each([
    ['(2) a bad phase', (s: Any) => (s.phase = 'done')],
    ['(3) a bad firstWinAt', (s: Any) => (s.firstWinAt = 'x')],
    ['(4) a zero bought', (s: Any) => (s.bought = { a: 0 })],
    ['(4) bought an array', (s: Any) => (s.bought = [])],
    ['(5) negative units', (s: Any) => (s.units = { home: -1 })],
    ['(6) a fractional rung', (s: Any) => (s.rung = 1.5)],
    ['(7) met an object', (s: Any) => (s.met = {})],
    ['(7) a partial met', (s: Any) => (s.met = [{ rung: 0 }])],
    ['(8) a bad side time', (s: Any) => (s.side = { a: 'x' })],
    ['(9) negative runs', (s: Any) => (s.runs = -1)],
    ['(10) an empty last', (s: Any) => (s.last = {})],
    ['(11) runs without a first win', (s: Any) => (s.firstWinAt = null)]
  ])('rejects %s', (_label, f) => {
    expect(parse(f)).toBeNull();
  });

  it('(1) rejects an array', () => {
    expect(parseGameState([])).toBeNull();
  });

  it.each([
    ['runs', (s: Any) => (s.runs = 1)],
    ['rung', (s: Any) => (s.rung = 1)],
    ['a met rung', (s: Any) => (s.met = validState().met)],
    ['a last result', (s: Any) => (s.last = validResult())]
  ])('(11) rejects phase opening with %s', (_label, f) => {
    const s: Any = json(NEW_GAME);
    f(s);
    expect(parseGameState(s)).toBeNull();
  });

  it('parses NEW_GAME', () => {
    expect(parseGameState(json(NEW_GAME))).toEqual(NEW_GAME);
  });

  it('units: bad values null, unknown kinds dropped', () => {
    expect(parse((s) => (s.units = { home: -1 }))).toBeNull();
    expect(parse((s) => (s.units = { home: 1.5 }))).toBeNull();
    expect(parse((s) => (s.units = { home: '3' }))).toBeNull();
    expect(parse((s) => (s.units = { gold: -1 }))).toBeNull();
    expect(parse((s) => (s.units = { home: 0, gold: 4 }))?.units).toEqual({ home: 0 });
    expect(parse((s) => (s.units = { home: 2 ** 53 }))).toBeNull();
    expect(parse((s) => (s.units = { home: Number.MAX_SAFE_INTEGER }))?.units).toEqual({
      home: Number.MAX_SAFE_INTEGER
    });
  });

  it('met must ascend strictly', () => {
    const m = (rung: number) => ({ rung, reachedOn: 1, datasetVersion: 'v', at: T });
    expect(parse((s) => (s.met = [m(1), m(0)]))).toBeNull();
    expect(parse((s) => (s.met = [m(0), m(0)]))).toBeNull();
    expect(parse((s) => (s.met = [m(0), m(1)]))?.met).toHaveLength(2);
  });
});

describe('parseRunResult', () => {
  it('parses a valid result equal to itself', () => {
    expect(parseRunResult(json(validResult()))).toEqual(validResult());
  });

  it('rejects a missing stage', () => {
    const r = json(validResult());
    delete r.stages.construction;
    expect(parseRunResult(r)).toBeNull();
  });

  it('rejects amount 0', () => {
    expect(parseRunResult({ ...json(validResult()), amount: 0 })).toBeNull();
  });

  it('rejects an empty side id', () => {
    expect(parseRunResult({ ...json(validResult()), side: [{ id: '', reward: {} }] })).toBeNull();
  });

  it('keeps a side id the catalogue no longer has', () => {
    const r = parseRunResult({
      ...json(validResult()),
      side: [{ id: 'gone-goal', reward: { home: 1 } }]
    });
    expect(r?.side).toEqual([{ id: 'gone-goal', reward: { home: 1 } }]);
  });
});
