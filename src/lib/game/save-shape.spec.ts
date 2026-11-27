import { describe, expect, it } from 'vitest';
import { newId } from '../ids/base58';
import { parseGameSave, parseGameState, type GameSave } from './save-shape';
import { NEW_GAME, type GameState } from './state';

const T = '2026-11-02T00:00:00.000Z';

function validState(): GameState {
  return {
    v: 3,
    phase: 'runs',
    firstWinAt: T,
    round: 2,
    target: 33000,
    editable: ['sb423-clock', 'transit-rail'],
    wins: [{ round: 1, goalMonth: 33000, beat: null, at: T, datasetVersion: 'fixture-0' }],
    finished: false,
    own: false
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

/** A version 2 save as the old build wrote it: one rung met, a run played. */
function v2Save(): Record<string, unknown> {
  return {
    v: 2,
    id: newId(),
    name: 'Old game',
    nameIsDefault: false,
    state: {
      v: 2,
      phase: 'runs',
      firstWinAt: T,
      bought: { 'housing-bond': 1, 'stop-rail': 1 },
      units: { home: 40 },
      rung: 1,
      met: [{ rung: 0, reachedOn: 33000, datasetVersion: 'fixture-0', at: T }],
      side: { 'collect-run': T },
      runs: 2,
      last: null
    },
    plan: '{"v":1,"plan":"painted"}',
    policy: '{"schema":4,"kinds":{"zoning":[{"id":"game-transit"}]}}',
    savedAt: T
  };
}

const json = (x: unknown) => JSON.parse(JSON.stringify(x));
type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

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

  it('rejects other envelope versions and state versions', () => {
    expect(parseGameSave(withSave((s) => (s.v = 1)))).toBeNull();
    expect(parseGameSave(withSave((s) => (s.v = 3)))).toBeNull();
    expect(parseGameSave(withState((s) => (s.v = 1)))).toBeNull();
    expect(parseGameSave(withState((s) => (s.v = 4)))).toBeNull();
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
    expect(parseGameSave(withState((s) => delete s.wins))).toBeNull();
  });

  it('drops unknown fields at the top, in the state and in a win', () => {
    const save = withSave((s) => {
      s.extra = 1;
      s.state.extra = 1;
      s.state.wins[0].extra = 1;
    });
    const r = parseGameSave(save);
    expect(r).not.toBeNull();
    expect(r).not.toHaveProperty('extra');
    expect(r?.state).not.toHaveProperty('extra');
    expect(r?.state.wins[0]).not.toHaveProperty('extra');
    expect(r).toEqual({ ...validSave(), id: r!.id });
  });

  it('keeps drift: an unknown editable key and a round past the last', () => {
    const r = parseGameSave(
      withState((s) => {
        s.editable = ['hands-radius'];
        s.round = 99;
      })
    );
    expect(r?.state.editable).toEqual(['hands-radius']);
    expect(r?.state.round).toBe(99);
  });

  it('a version 2 save parses to version 3, its plan and policy text unchanged', () => {
    const old = v2Save();
    const r = parseGameSave(json(old));
    expect(r).not.toBeNull();
    expect(r!.v).toBe(2);
    expect(r!.state.v).toBe(3);
    expect(r!.state).toMatchObject({
      round: 2,
      editable: ['housing-bond'],
      own: true,
      wins: [{ round: 0, beat: null }]
    });
    expect(r!.plan).toBe(old.plan);
    expect(r!.policy).toBe(old.policy);
    expect(r!.id).toBe(old.id);
    expect(r!.name).toBe(old.name);
    expect(r!.savedAt).toBe(old.savedAt);
  });

  it('a version 2 save with an unexpected extra field still upgrades', () => {
    const old = json(v2Save());
    old.state.surprise = { nested: [1, 2] };
    old.surprise = 'top';
    const r = parseGameSave(old);
    expect(r?.state.v).toBe(3);
    expect(r).not.toHaveProperty('surprise');
    expect(r?.state).not.toHaveProperty('surprise');
  });

  it('a finished version 2 save upgrades finished', () => {
    const old = json(v2Save());
    old.state.rung = 4;
    old.state.met = [0, 1, 2, 3, 4].map((rung) => ({
      rung,
      reachedOn: 24000,
      datasetVersion: 'fixture-0',
      at: T
    }));
    const r = parseGameSave(old);
    expect(r?.state).toMatchObject({ round: 4, finished: true, own: true });
    expect(r?.state.wins).toHaveLength(5);
  });

  it('the upgraded state passes the version 3 parser', () => {
    const r = parseGameSave(json(v2Save()));
    expect(parseGameState(json(r!.state))).toEqual(r!.state);
  });
});

describe('parseGameState', () => {
  const parse = (f: (s: Any) => void) => {
    const s = json(validState());
    f(s);
    return parseGameState(s);
  };

  it.each([
    ['a bad phase', (s: Any) => (s.phase = 'done')],
    ['a bad firstWinAt', (s: Any) => (s.firstWinAt = 'x')],
    ['a negative round', (s: Any) => (s.round = -1)],
    ['a fractional round', (s: Any) => (s.round = 1.5)],
    ['a text round', (s: Any) => (s.round = '2')],
    ['a fractional target', (s: Any) => (s.target = 1.5)],
    ['a text target', (s: Any) => (s.target = '2060')],
    ['editable not an array', (s: Any) => (s.editable = {})],
    ['an empty editable key', (s: Any) => (s.editable = [''])],
    ['a numeric editable key', (s: Any) => (s.editable = [3])],
    ['wins not an array', (s: Any) => (s.wins = {})],
    ['a win with a bad round', (s: Any) => (s.wins[0].round = -1)],
    ['a win with a text goalMonth', (s: Any) => (s.wins[0].goalMonth = 'x')],
    ['a win with a fractional beat', (s: Any) => (s.wins[0].beat = 0.5)],
    ['a win with a bad at', (s: Any) => (s.wins[0].at = 'later')],
    ['a win with no datasetVersion', (s: Any) => (s.wins[0].datasetVersion = '')],
    ['finished text', (s: Any) => (s.finished = 'no')],
    ['own missing', (s: Any) => delete s.own],
    ['runs without a first win', (s: Any) => (s.firstWinAt = null)]
  ])('rejects %s', (_label, f) => {
    expect(parse(f)).toBeNull();
  });

  it('rejects an array', () => {
    expect(parseGameState([])).toBeNull();
  });

  it.each([
    ['a round', (s: Any) => (s.round = 1)],
    ['a target', (s: Any) => (s.target = 33000)],
    ['a win', (s: Any) => (s.wins = validState().wins)],
    ['an editable key', (s: Any) => (s.editable = ['sb423-clock'])],
    ['finished', (s: Any) => (s.finished = true)]
  ])('rejects phase opening with %s', (_label, f) => {
    const s: Any = json(NEW_GAME);
    f(s);
    expect(parseGameState(s)).toBeNull();
  });

  it('parses NEW_GAME and a null target and goal month', () => {
    expect(parseGameState(json(NEW_GAME))).toEqual(NEW_GAME);
    const r = parse((s) => {
      s.target = null;
      s.wins[0].goalMonth = null;
      s.wins[0].beat = 30000;
    });
    expect(r?.target).toBeNull();
    expect(r?.wins[0]).toMatchObject({ goalMonth: null, beat: 30000 });
  });

  it('a version 2 state goes through the upgrade', () => {
    const r = parseGameState(json(v2Save()).state);
    expect(r?.v).toBe(3);
  });
});
