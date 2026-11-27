import { limitsOf, type Limits } from '../../limits';
import type { SaveEntry } from '../../save-shape';
import { NEW_GAME, type GameState } from '../../state';
import type { GameStore, StoreChange } from '../../store.svelte';
import { FakeSync } from '../../test/fake-sync.svelte';

export type GameCall =
  | { kind: 'switchTo' | 'remove'; id: string }
  | { kind: 'rename'; id: string; name: string }
  | { kind: 'newGame' };

export interface FakeGameInit {
  saves?: readonly SaveEntry[];
  currentId?: string;
  state?: Partial<GameState>;
  limits?: Limits;
  open?: boolean;
  sync?: FakeSync;
}

/** A save entry for tests: id `id-${name}`, nameIsDefault false, phase 'opening', round 0, savedAt now. */
export function entry(name: string, over: Partial<SaveEntry> = {}): SaveEntry {
  return {
    id: `id-${name}`,
    name,
    nameIsDefault: false,
    savedAt: new Date().toISOString(), // eslint-disable-line svelte/prefer-svelte-reactivity
    phase: 'opening',
    round: 0,
    finished: false,
    ...over
  };
}

const OK: StoreChange = { ok: true };

/** The G7 members GamePanel reads, reactive ($state.raw), recording each call. */
export class FakeGame {
  state = $state.raw<GameState>(NEW_GAME);
  limits = $state.raw<Limits>(limitsOf(NEW_GAME));
  readonly open: boolean;
  saves = $state.raw<readonly SaveEntry[]>([]);
  currentId = $state.raw('');
  readonly sync: FakeSync;
  /** When set, switchTo, newGame and remove return it and change nothing. */
  refuse: StoreChange | null = null;
  readonly calls: GameCall[] = [];

  constructor(init: FakeGameInit = {}) {
    this.saves = init.saves ?? [entry('Mission')];
    this.currentId = init.currentId ?? this.saves[0].id;
    this.state = { ...structuredClone(NEW_GAME), ...init.state };
    this.limits = init.limits ?? limitsOf(NEW_GAME);
    this.open = init.open ?? false;
    this.sync = init.sync ?? new FakeSync();
  }

  switchTo(id: string): StoreChange {
    this.calls.push({ kind: 'switchTo', id });
    if (this.refuse) return this.refuse;
    this.currentId = id;
    return OK;
  }

  newGame(): StoreChange {
    this.calls.push({ kind: 'newGame' });
    if (this.refuse) return this.refuse;
    const made = entry(`Game ${this.saves.length + 1}`, { phase: 'opening', round: 0 });
    this.saves = [made, ...this.saves];
    this.currentId = made.id;
    return OK;
  }

  rename(id: string, name: string): void {
    this.calls.push({ kind: 'rename', id, name });
    this.saves = this.saves.map((e) => (e.id === id ? { ...e, name, nameIsDefault: false } : e));
  }

  remove(id: string): StoreChange {
    this.calls.push({ kind: 'remove', id });
    if (this.refuse) return this.refuse;
    this.saves = this.saves.filter((e) => e.id !== id);
    if (id === this.currentId && this.saves.length > 0) this.currentId = this.saves[0].id;
    return OK;
  }

  /** This, cast for `provideGame`. */
  asStore(): GameStore {
    return this as unknown as GameStore;
  }
}
