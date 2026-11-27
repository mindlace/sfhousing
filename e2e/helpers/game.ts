import type { Page } from '@playwright/test';
import { newId } from '../../src/lib/ids/base58';
import { E2E_GAME_KEY, E2E_GOAL_KEY } from '../../src/lib/game/e2e';
import { SAVES_KEY, saveKey } from '../../src/lib/game/saves';
import { NEW_GAME, type GameState } from '../../src/lib/game/state';
import type { GameSave } from '../../src/lib/game/save-shape';

const seeded = new WeakSet<Page>();

/** The policy record key (`SIM_KEY4` of `src/lib/timeline/sim-doc4`). */
const POLICY_RECORD = 'sfhousing:sim:v2';
/** The plan record key (the opening's autosave). */
const PLAN_RECORD = 'sfhousing:plan:v1';

/** Before the page loads, switch the real game on and store a game: the new game with `state` over
 *  it (a 'runs' state gets a `firstWinAt`). */
export async function seedGame(page: Page, state?: Partial<GameState>): Promise<void> {
  if (seeded.has(page)) throw new Error('seedGame: this page already has a game');
  seeded.add(page);

  const id = newId();
  const at = new Date().toISOString();
  const merged: GameState = { ...NEW_GAME, ...state, v: 3 };
  if (state?.firstWinAt === undefined && merged.phase === 'runs') merged.firstWinAt = at;

  const save: GameSave = {
    v: 2,
    id,
    name: 'Seeded game',
    nameIsDefault: false,
    state: merged,
    plan: null,
    policy: null,
    savedAt: at
  };
  const index = {
    v: 2,
    current: id,
    saves: [
      {
        id,
        name: 'Seeded game',
        nameIsDefault: false,
        savedAt: at,
        phase: merged.phase,
        round: merged.round
      }
    ]
  };
  await store(page, id, JSON.stringify(save), JSON.stringify(index), null, null);
}

/**
 * Before the page loads, switch the real game on and store a raw version 2 save as the old build
 * wrote it (its index entry carries `rung`): the upgrade journey. `policy` and `plan` are document
 * texts (a schema 4 policy, a plan); each is stored as the autosave record the pages read
 * (`{ v: 1, savedAt, plan }`) under its record key and in the save.
 */
export async function seedV2Game(
  page: Page,
  v2: Record<string, unknown>,
  policy?: string,
  plan?: string
): Promise<void> {
  if (seeded.has(page)) throw new Error('seedV2Game: this page already has a game');
  seeded.add(page);

  const id = newId();
  const at = new Date().toISOString();
  const record = (text: string | undefined): string | null =>
    text === undefined ? null : JSON.stringify({ v: 1, savedAt: at, plan: text });
  const policyRecord = record(policy);
  const planRecord = record(plan);
  const save = {
    v: 2,
    id,
    name: 'Old game',
    nameIsDefault: false,
    state: v2,
    plan: planRecord,
    policy: policyRecord,
    savedAt: at
  };
  const entry = {
    id,
    name: 'Old game',
    nameIsDefault: false,
    savedAt: at,
    phase: v2.phase,
    rung: v2.rung
  };
  const index = { v: 2, current: id, saves: [entry] };
  await store(page, id, JSON.stringify(save), JSON.stringify(index), policyRecord, planRecord);
}

/** Stores the game switch, the save and the index (and the records) before load. */
async function store(
  page: Page,
  id: string,
  save: string,
  index: string,
  policy: string | null,
  plan: string | null
): Promise<void> {
  await page.addInitScript(
    (a) => {
      try {
        localStorage.setItem(a.gameKey, '1');
        if (localStorage.getItem(a.savesKey) === null) {
          localStorage.setItem(a.key, a.save);
          localStorage.setItem(a.savesKey, a.index);
          if (a.policy !== null) localStorage.setItem(a.policyKey, a.policy);
          if (a.plan !== null) localStorage.setItem(a.planKey, a.plan);
        }
      } catch {
        // storage refused: write nothing more, so the page still loads
      }
    },
    {
      gameKey: E2E_GAME_KEY,
      savesKey: SAVES_KEY,
      key: saveKey(id),
      save,
      index,
      policyKey: POLICY_RECORD,
      policy,
      planKey: PLAN_RECORD,
      plan
    }
  );
}

/** Before the page loads, switch the real game on with nothing stored: a new visitor. */
export async function newVisitor(page: Page): Promise<void> {
  if (seeded.has(page)) throw new Error('newVisitor: this page already has a game');
  seeded.add(page);
  await page.addInitScript((key) => {
    try {
      localStorage.setItem(key, '1');
    } catch {
      // storage refused: the page still loads
    }
  }, E2E_GAME_KEY);
}

/** Before the page loads, set the goal's amount for this page. */
export async function seedGoalAmount(page: Page, amount: number): Promise<void> {
  if (!Number.isSafeInteger(amount) || amount < 1)
    throw new Error('seedGoalAmount: amount must be a whole number of at least 1');
  await page.addInitScript(
    (a) => {
      try {
        localStorage.setItem(a.key, a.value);
      } catch {
        // storage refused: the page still loads
      }
    },
    { key: E2E_GOAL_KEY, value: String(amount) }
  );
}
