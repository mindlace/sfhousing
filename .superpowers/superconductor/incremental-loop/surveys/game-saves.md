# Survey: the game layer and saved games, as they are today

Worktree `/Users/mindlace/Projects/sfhousing/.claude/worktrees/incremental-feel`, commit `7bb0efbc`
(branch `worktree-incremental-feel`). Read-only. No test was run and no server was started.

Marks: **V** = verified at a file:line I read. **I** = inferred (the reason is given). Paths are
relative to the worktree root. A table headed "all rows V" is verified at the line each row cites.

Contents: (a) exports, (b) importer census, (c) the saved game, (d) the store's state, (e) the e2e
seam, (f) AccountOffer and account creation, (g) copy.ts, (h) test counts, doc/code disagreements,
appendix.

---

## (a) Exports of every non-test file

### `src/lib/game/levels.ts` (all rows V)

| Line | Export as written |
| --- | --- |
| 6 | `export type Level = 1 \| 2 \| 3 \| 4 \| 5;` |
| 7 | `export const LAST_LEVEL: Level = 5;` |
| 10 | `export type Result = GoalOutcome;` (`GoalOutcome` is `{ kind: 'reached'; on: Day } \| { kind: 'missed'; short: number }`, `src/lib/timeline/outcome.ts:10`) |
| 13-15 | `export interface Bar { on: Day; }` |
| 21 | `export function beats(seen: Result, bar: Bar): boolean` |
| 29 | `export function paintWon(net: number, amount: number): boolean` |

### `src/lib/game/progress.ts` (all rows V)

| Line | Export as written |
| --- | --- |
| 4-11 | `export interface Banked { on: Day; datasetVersion: string; at: string; }` |
| 13-20 | `export interface Progress { v: 1; level: Level; banked: Partial<Record<2 \| 3 \| 4 \| 5, Banked>>; firstWinAt: string \| null; }` |
| 22 | `export const NEW_GAME: Progress = { v: 1, level: 1, banked: {}, firstWinAt: null };` |
| 25 | `export function barOf(p: Progress): Bar \| null` |
| 32 | `export function roundComplete(p: Progress): boolean` |
| 37 | `export function levelUp(p: Progress, banked: Banked \| null): Progress` |

### `src/lib/game/standing.ts` (all rows V)

| Line | Export as written |
| --- | --- |
| 4-5 | `export type Standing = { kind: 'playing' } \| { kind: 'short'; seen: Result; bar: Bar \| null } \| { kind: 'won'; on: Day };` |
| 8 | `export function standing(level: Level, bar: Bar \| null, seen: Result \| null): Standing` |

### `src/lib/game/allowed.ts` (all rows V)

| Line | Export as written |
| --- | --- |
| 5-10 | `export interface Allowed { kinds: ReadonlySet<PolicyKind>; money: 'given' \| 'all'; }` |
| 12-15 | `export const ALL_ALLOWED: Allowed = { kinds: new Set<PolicyKind>(['zoning', 'permitting', 'money']), money: 'all' };` |
| 26 | `export function allowedAt(level: Level): Allowed` |
| 33 | `export function unlocksAt(kind: PolicyKind): Level` |
| 38 | `export function isGiven(p: Policy): boolean` |
| 45 | `export function runs(kind: PolicyKind, p: Policy, a: Allowed): boolean` |
| 51 | `export function playable(doc: SimPolicy4, a: Allowed): SimPolicy4` |
| 66 | `export function levelNeeded(doc: SimPolicy4): Level \| 6` |
| 76 | `export function simLocked(p: Progress): boolean` |
| 81 | `export function needsHigher(doc: SimPolicy4, p: Progress): Level \| 6 \| null` |

### `src/lib/game/copy.ts` (all rows V)

| Line | Export as written |
| --- | --- |
| 10 | `export function barText(bar: Bar): string` |
| 24 | `export function unlockText(next: Level \| 6): string` |
| 29 | `export function lockedLane(kind: PolicyKind, level: Level): string` |
| 37 | `export function levelText(level: Level): string` |
| 42 | `export function aimText(p: Progress): string` |
| 50 | `export function nextText(p: Progress): string` |
| 58 | `export function syncText(state: SyncState): string \| null` |
| 76 | `export function playedText(savedAt: string, now: Date): string` |
| 88 | ``export const FULL_TEXT = `${MAX_SAVES} saved games. Delete one first.`;`` |
| 89 | `export const STORAGE_TEXT = 'This browser refused to save.';` |

### `src/lib/game/navigate.ts` (all rows V)

| Line | Export as written |
| --- | --- |
| 4 | `export function gamePath(level: Level): '/' \| '/sim'` |
| 9 | `export function remixPath(kind: 'plan' \| 'sim'): '/' \| '/sim'` |
| 14 | `export function loadPage(path: '/' \| '/sim'): void` |

### `src/lib/game/e2e.ts` (all rows V)

| Line | Export as written |
| --- | --- |
| 1 | `export const E2E_GAME_KEY = 'sfhousing:e2e:game';` |
| 2 | `export const E2E_GOAL_KEY = 'sfhousing:e2e:goal';` |
| 5 | `export function e2eOpen(storage: Storage \| null): boolean` |
| 16 | `export function e2eGoalAmount(storage: Storage \| null): number \| null` |

### `src/lib/game/saves.ts` (all rows V)

| Line | Export as written |
| --- | --- |
| 5-19 | `export interface GameSave { v: 1; id: string; name: string; nameIsDefault: boolean; progress: Progress; plan: string \| null; policy: string \| null; savedAt: string; }` |
| 22-24 | `export type SaveEntry = Pick<GameSave, 'id' \| 'name' \| 'nameIsDefault' \| 'savedAt'> & { level: Level; };` |
| 26 | `export const SAVES_KEY = 'sfhousing:saves:v1';` |
| 27 | ``export const saveKey = (id: string): string => `sfhousing:save:${id}`;`` |
| 28 | `export const MAX_SAVES = 12;` |
| 29 | `export const SAVE_NAME_MAX = 60;` |
| 31-44 | `export const SHORT_MONTHS: readonly string[] = ['Jan', … 'Dec'];` |
| 93 | `export function parseGameSave(json: unknown): GameSave \| null` |
| 127 | `export function defaultSaveName(from: DefaultFrom, taken: readonly string[]): string` where (not exported, 109-110) `type DefaultFrom = { kind: 'new'; at: Date } \| { kind: 'remix'; title: string } \| { kind: 'conflict'; name: string };` |

### `src/lib/game/save-api.ts` (all rows V)

| Line | Export as written |
| --- | --- |
| 3 | `export const MAX_SAVE_BYTES = 600_000;` |
| 6-10 | `export interface AccountLine { handle: string; handleClaimed: boolean; }` |
| 13-18 | `export type ListGames = { status: 200; body: AccountLine & { saves: (SaveEntry & { rev: number })[]; removed: string[] }; } \| { status: 401 };` |
| 21-22 | `export type GetGame = { status: 200; body: { rev: number; save: GameSave } } \| { status: 401 \| 404 \| 410 };` |
| 25-29 | `export interface PutGameBody { baseRev: number \| null; save: GameSave; }` |
| 32-38 | `export type PutGame = { status: 200; body: AccountLine & { rev: number } } \| { status: 409; body: { rev: number; save: GameSave } } \| { status: 410 } \| { status: 401; body: { error: 'sign_in' } } \| { status: 422; body: { error: 'invalid' \| 'too_many' \| 'no_win' } } \| { status: 403 \| 413 \| 415 \| 429 };` |
| 41 | `export type DeleteGame = { status: 204 } \| { status: 401 };` |

### `src/lib/game/save-sync.svelte.ts` (all rows V)

| Line | Export as written |
| --- | --- |
| 8 | `export type SyncState = 'local' \| 'saving' \| 'saved' \| 'offline' \| 'sign-in' \| 'full';` |
| 10-23 | `export interface SaveSync { readonly state: SyncState; readonly account: AccountLine \| null; changed(id: string): void; removed(id: string): void; pull(): Promise<void>; attach(store: GameStore): void; }` |
| 25 | `export const SAVE_REVS_KEY = 'sfhousing:saves:revs';` |
| 28-32 | `export const syncReload = { reload(): void { location.reload(); } };` |
| 35-41 | `export interface SyncRecord { v: 1; seen: Record<string, { rev: number; savedAt: string }>; deleting: string[]; }` |
| 795-800 | `export function createSaveSync(opts: { storage: Storage \| null; fetchFn: typeof fetch; signedIn: () => boolean; }): SaveSync` |

Not exported: `class BrowserSync implements SaveSync` (126), `idleSync()` (115), `DEBOUNCE_MS = 2000` (43). V.

### `src/lib/game/store.svelte.ts` (all rows V)

| Line | Export as written |
| --- | --- |
| 18 | `export type StoreChange = { ok: true } \| { ok: false; reason: 'full' \| 'storage' \| 'changed' };` |
| 21-26 | `export interface Offer { on: Day \| null; datasetVersion: string; }` |
| 224 | `export class GameStore` (members below) |
| 790 | `export function openGame(): GameStore` |
| 801 | `export function provideGame(store: GameStore): void` |
| 805 | `export function useGame(): GameStore` |

`GameStore` public members (all V):

| Line | Member |
| --- | --- |
| 246 | `constructor(opts: { storage: Storage \| null; sync: SaveSync; now?: () => Date })` |
| 567 | `get progress(): Progress` (reactive) |
| 571 | `get allowed(): Allowed` (reactive; `$derived(this.#open ? ALL_ALLOWED : allowedAt(this.#progress.level))`, line 240) |
| 575 | `get open(): boolean` |
| 579 | `get saves(): readonly SaveEntry[]` (reactive) |
| 583 | `get currentId(): string` (reactive) |
| 587 | `get offer(): Offer \| null` (reactive) |
| 591 | `get sync(): SaveSync` |
| 595 | `won(): void` |
| 602 | `setOffer(offer: Offer \| null): void` |
| 606 | `levelUp(): void` |
| 619 | `touched(): void` |
| 624 | `beforeLeave(fn: () => void): () => void` |
| 632 | `newGame(): StoreChange` |
| 643 | `switchTo(id: string): StoreChange` |
| 651 | `remix(doc: { kind: 'plan' \| 'sim'; record: string; title: string }): StoreChange` |
| 672 | `rename(id: string, name: string): void` |
| 679 | `remove(id: string): StoreChange` |
| 707 | `read(id: string): GameSave \| null` |
| 718 | `adopt(saves: readonly GameSave[]): StoreChange` |
| 761 | `rekey(id: string, newId: string): StoreChange` |

### Components in `src/lib/game/` (default exports)

- **V** `AccountOffer.svelte`: no props (comment at :3; no `$props()` call other than `$props.id()` at :14).
- **V** `LevelPanel.svelte`: no props (comment at :2; only `$props.id()` at :22).
- **V** `WinCard.svelte:7-16`: `interface WinCardProps { title: string; unlocks: string | null; onlevelup: () => void; onkeep: () => void; }`.

### `src/lib/game/test/` (non-spec helpers)

- **V** `test/fake-sync.svelte.ts:5-9`: `export type SyncCall = { kind: 'changed'; id: string } | { kind: 'removed'; id: string } | { kind: 'pull' } | { kind: 'attach' };`
- **V** `test/fake-sync.svelte.ts:12`: `export class FakeSync implements SaveSync` with `state: SyncState = $state('local')`, `account: AccountLine | null = $state(null)`, `readonly calls: SyncCall[] = []`, `changed`, `removed`, `pull`, `attach`.
- **V** `test/StoreHost.svelte:7-17`: `interface StoreHostProps { store?: GameStore; show: 'panel' | 'card' | 'none'; card?: ComponentProps<typeof WinCard>; onuse?: (game: GameStore) => void; onescape?: () => void; }`.

### `src/lib/server/game/store.ts` (all rows V)

| Line | Export as written |
| --- | --- |
| 13 | `export const REMOVED_LIST_DAYS = 90;` |
| 34-37 | `export async function accountLine(db: Database, user: { id: string; handle: string }): Promise<AccountLine>` |
| 46-50 | `export async function listGames(db: Database, identityId: string, now: Date): Promise<{ saves: (SaveEntry & { rev: number })[]; removed: string[] }>` |
| 87-91 | `export async function readGame(db: Database, identityId: string, id: string): Promise<{ kind: 'live'; rev: number; save: GameSave } \| { kind: 'removed' } \| null>` |
| 110-115 | `export async function putGame(db: Database, identityId: string, save: GameSave, baseRev: number \| null): Promise<PutAnswer>` where (not exported, 98-102) `type PutAnswer = { kind: 'stored'; rev: number } \| { kind: 'conflict'; rev: number; save: GameSave } \| { kind: 'removed' } \| { kind: 'too_many' };` |
| 157-162 | `export async function removeGame(db: Database, identityId: string, id: string, now: Date): Promise<void>` |
| 169-173 | `export async function moveGames(db: Database, survivorId: string, absorbedId: string): Promise<void>` |
| 211 | `export async function deleteGamesOf(db: Database, identityIds: string[]): Promise<void>` |

### `src/lib/server/db/schema/gameSave.ts`

- **V** `:4` `export const gameSave = sqliteTable('game_save', …)`; re-exported by `src/lib/server/db/schema/index.ts:7` (`export * from './gameSave';`).

---

## (b) Importers outside `src/lib/game`

Method: a script parsed every `import`/`export … from`, `import()`, `vi.mock()` in `src`, `e2e`,
`scripts` and `pipeline` (multi-line imports included), resolved the specifier, and kept those that
land in `src/lib/game` or `src/lib/server/game` from a file outside `src/lib/game`. A single-line
`grep` gave the same lines. Line numbers are the first line of the import statement. All rows V.
`scripts/` and `pipeline/`: no hits. "(type)" = type-only import.

### `levels.ts`

| Export | Importers |
| --- | --- |
| `Level` (type) | `src/lib/server/game/store.ts:10`; `src/lib/shell/test/seeded-game.ts:3`; `src/lib/timeline/Timeline.svelte:15`; `src/lib/timeline/Timeline.svelte.spec.ts:9`; `src/lib/timeline/TimelineMode.svelte:170`; `src/lib/timeline/game-copy.ts:2`; `src/lib/timeline/test/game.ts:2` |
| `paintWon` | `src/routes/+page.svelte:19` |
| `LAST_LEVEL`, `Result`, `Bar`, `beats` | none outside `src/lib/game` |

### `progress.ts`

| Export | Importers |
| --- | --- |
| `Banked` (type) | `e2e/helpers/game.ts:7` |
| `Progress` (type) | `src/lib/shell/test/seeded-game.ts:4` |
| `barOf` | `src/lib/timeline/TimelineMode.svelte:171` |
| `roundComplete` | `src/lib/shell/LevelCell.svelte:11`; `src/lib/shell/SiteHeader.svelte:22`; `src/lib/shell/test/seeded-game.svelte.spec.ts:2`; `src/lib/sim-page/SimPage.svelte:38`; `src/lib/timeline/TimelineMode.svelte:171`; `src/lib/timeline/TimelineMode.game.svelte.spec.ts:17` |
| `NEW_GAME`, `levelUp` | none outside `src/lib/game` |

### `standing.ts`

| Export | Importers |
| --- | --- |
| `standing`, `Standing` (type) | `src/lib/timeline/TimelineMode.svelte:172` |

### `allowed.ts`

| Export | Importers |
| --- | --- |
| `ALL_ALLOWED` | `src/lib/sim-page/SimPage.svelte:35`; `src/lib/timeline/AddMenu.svelte:7`; `src/lib/timeline/Inspector.svelte:20`; `src/lib/timeline/Timeline.svelte:13`; `src/lib/timeline/TimelineMode.svelte:168`; `src/lib/timeline/activity-view.ts:7`; `src/lib/timeline/add.ts:9`; `src/lib/timeline/add.spec.ts:2` |
| `Allowed` (type) | `src/lib/sim-page/SimPage.svelte:35`; `src/lib/timeline/AddMenu.svelte:7`; `src/lib/timeline/Inspector.svelte:20`; `src/lib/timeline/Inspector.svelte.spec.ts:10`; `src/lib/timeline/Timeline.svelte:13`; `src/lib/timeline/Timeline.svelte.spec.ts:7`; `src/lib/timeline/activity-view.ts:7`; `src/lib/timeline/add.ts:9`; `src/lib/timeline/test/InspectorHost.svelte:8` |
| `allowedAt` | `src/lib/timeline/Inspector.svelte.spec.ts:10`; `src/lib/timeline/Timeline.svelte.spec.ts:7`; `src/lib/timeline/activity-view.spec.ts:9`; `src/lib/timeline/add.spec.ts:2` (specs only) |
| `isGiven` | `src/lib/sim-page/funding-presets.ts:26`; `src/lib/timeline/Inspector.svelte:20`; `src/lib/timeline/add.ts:9`; `src/lib/timeline/Timeline.svelte.spec.ts:7` |
| `runs` | `src/lib/sim-page/SimPage.svelte:35`; `src/lib/timeline/Timeline.svelte:13` |
| `playable` | `src/lib/sim-page/SimPage.svelte:35` |
| `simLocked` | `src/lib/shell/SiteHeader.svelte:21`; `src/lib/sim-page/SimRoute.svelte:14`; `src/routes/+page.svelte:16`; `src/routes/s/[id]/+page.svelte:7` |
| `needsHigher` | `src/routes/s/[id]/+page.svelte:7` |
| `unlocksAt`, `levelNeeded` | none outside `src/lib/game` |

### `copy.ts`

| Export | Importers |
| --- | --- |
| `FULL_TEXT` | `src/lib/sharing/SharedBanner.svelte:7`; `src/lib/sharing/SharedBanner.svelte.spec.ts:5`; `src/routes/p/[id]/page.view.svelte.spec.ts:15`; `src/routes/s/[id]/page.view.svelte.spec.ts:16` |
| `STORAGE_TEXT` | `src/routes/p/[id]/+page.svelte:13`; `src/routes/s/[id]/+page.svelte:8`; `src/routes/s/[id]/page.view.svelte.spec.ts:16` |
| `levelText` | `src/lib/shell/LevelCell.svelte:10` |
| `lockedLane` | `src/lib/timeline/Timeline.svelte:14`; `src/lib/timeline/Timeline.svelte.spec.ts:8` |
| `unlockText` | `src/lib/sim-page/SimPage.svelte:36`; `src/lib/timeline/TimelineMode.svelte:169`; `src/lib/timeline/TimelineMode.game.svelte.spec.ts:16`; `src/routes/+page.svelte:17` |
| `barText`, `aimText`, `nextText`, `syncText`, `playedText` | none outside `src/lib/game` |

### `navigate.ts`

| Export | Importers |
| --- | --- |
| `gamePath`, `loadPage`, `remixPath` | `src/routes/p/[id]/+page.svelte:14`; `src/routes/s/[id]/+page.svelte:9` |
| module mocked | `vi.mock('$lib/game/navigate')` at `src/routes/p/[id]/page.view.svelte.spec.ts:29` (`import()` type at :30) and `src/routes/s/[id]/page.view.svelte.spec.ts:62` (:63) |

### `e2e.ts`

| Export | Importers |
| --- | --- |
| `E2E_GAME_KEY` | `e2e/helpers/game.ts:5`; `e2e/game-helpers.spec.ts:3` |
| `E2E_GOAL_KEY` | `e2e/helpers/game.ts:5`; `e2e/game-helpers.spec.ts:3`; `e2e/game-journey.spec.ts:8` |
| `e2eOpen` | `src/routes/+layout.svelte:11` |
| `e2eGoalAmount` | `src/lib/sim-page/SimPage.svelte:37`; `src/lib/sim-page/SimRoute.svelte:15`; `src/routes/+page.svelte:18` |
| module mocked | `vi.mock('$lib/game/e2e')` at `src/routes/page.game.svelte.spec.ts:21` (`import()` type at :22) |

### `saves.ts`

| Export | Importers |
| --- | --- |
| `GameSave` (type) | `e2e/helpers/game.ts:6`; `src/lib/server/game/store.ts:9`; `src/lib/server/game/store.spec.ts:8`; `src/lib/server/auth/better-auth.spec.ts:9`; `src/lib/server/user-store/deletion.spec.ts:6`; `src/lib/shell/test/seeded-game.ts:5`; `src/routes/api/game/server.spec.ts:6`; `src/routes/api/game/[id]/server.spec.ts:8` |
| `SaveEntry` (type) | `src/lib/server/game/store.ts:9` |
| `SAVES_KEY` | `e2e/helpers/game.ts:6`; `e2e/game-core.spec.ts:3`; `e2e/game-helpers.spec.ts:4`; `e2e/game-save.spec.ts:5`; `src/lib/shell/test/seeded-game.ts:5`; `src/routes/p/[id]/page.view.svelte.spec.ts:16`; `src/routes/s/[id]/page.view.svelte.spec.ts:17` |
| `saveKey` | `e2e/helpers/game.ts:6`; `e2e/game-core.spec.ts:3`; `e2e/game-helpers.spec.ts:4`; `e2e/game-save.spec.ts:5`; `src/lib/shell/test/seeded-game.ts:5`; `src/lib/shell/test/seeded-game.svelte.spec.ts:3` |
| `MAX_SAVES` | `src/lib/about/copy.ts:6`; `src/lib/about/AboutParts.svelte.spec.ts:14`; `src/lib/server/game/store.ts:9`; `src/routes/api/game/[id]/server.spec.ts:8`; `src/routes/p/[id]/+page.svelte:15`; `src/routes/s/[id]/+page.svelte:10` |
| `parseGameSave` | `src/lib/server/game/store.ts:9`; `src/lib/server/game/store.spec.ts:8`; `src/lib/server/auth/better-auth.spec.ts:9`; `src/lib/server/user-store/deletion.spec.ts:6`; `src/lib/shell/test/seeded-game.svelte.spec.ts:3`; `src/routes/api/game/[id]/+server.ts:4` |
| `SAVE_NAME_MAX`, `SHORT_MONTHS`, `defaultSaveName` | none outside `src/lib/game` |

### `save-api.ts`

| Export | Importers |
| --- | --- |
| `MAX_SAVE_BYTES` | `src/routes/api/game/[id]/+server.ts:3`; `src/routes/api/game/[id]/server.spec.ts:7` |
| `AccountLine` (type) | `src/lib/server/game/store.ts:8`; `src/lib/shell/test/seeded-game.ts:1` |
| `ListGames` (type) | `src/routes/api/game/server.spec.ts:5` |
| `GetGame`, `PutGameBody`, `PutGame`, `DeleteGame` | none outside `src/lib/game` |

### `save-sync.svelte.ts`

| Export | Importers |
| --- | --- |
| `createSaveSync` | `src/routes/+layout.svelte:12` |
| `SaveSync` (type) | `src/lib/shell/test/seeded-game.ts:2` |
| `SyncState`, `SAVE_REVS_KEY`, `syncReload`, `SyncRecord` | none outside `src/lib/game` |

### `store.svelte.ts`

| Export | Importers |
| --- | --- |
| `GameStore` (value) | `src/routes/+layout.svelte:13`; `src/routes/page.game.svelte.spec.ts:9`; `src/lib/shell/test/seeded-game.ts:6`; `src/lib/timeline/test/game.ts:3` |
| `GameStore` (type) | `src/lib/sim-page/SimPage.svelte:39`; `src/lib/timeline/TimelineMode.svelte:173`; `src/lib/timeline/TimelineMode.game.svelte.spec.ts:18`; `src/lib/shell/test/LevelCellHost.svelte:4`; `src/lib/shell/test/SimRowGameHeader.svelte:4`; `src/routes/test/PageHost.svelte:5`; `src/routes/p/[id]/test/PageHost.svelte:5`; `src/routes/s/[id]/test/PageHost.svelte:6`; `src/routes/sim/test/GameSimHost.svelte:5`; `src/routes/sim/game.svelte.spec.ts:18` |
| `openGame` | `src/routes/+layout.svelte:13`; `src/lib/timeline/TimelineMode.game.svelte.spec.ts:18`; `src/routes/sim/game.svelte.spec.ts:18` |
| `provideGame` | `src/routes/+layout.svelte:13`; `src/lib/timeline/test/TimelineModeHost.svelte:17`; `src/lib/shell/test/LevelCellHost.svelte:4`; `src/lib/shell/test/SimRowGameHeader.svelte:4`; `src/routes/test/PageHost.svelte:5`; `src/routes/p/[id]/test/PageHost.svelte:5`; `src/routes/s/[id]/test/PageHost.svelte:6`; `src/routes/sim/test/GameSimHost.svelte:5` |
| `useGame` | `src/lib/shell/LevelCell.svelte:12`; `src/lib/shell/SiteHeader.svelte:23`; `src/lib/sim-page/SimRoute.svelte:16`; `src/routes/+page.svelte:20`; `src/routes/p/[id]/+page.svelte:16`; `src/routes/s/[id]/+page.svelte:11` |
| `StoreChange`, `Offer` | none outside `src/lib/game` |

### Components and test helpers

| Export | Importers |
| --- | --- |
| `LevelPanel.svelte` | `src/lib/shell/LevelCell.svelte:9` |
| `WinCard.svelte` | `src/lib/timeline/TimelineMode.svelte:174`; `src/routes/+page.svelte:21` |
| `AccountOffer.svelte` | none outside `src/lib/game` (inside: `WinCard.svelte:4`) |
| `test/fake-sync.svelte.ts` `FakeSync` | `src/lib/timeline/test/game.ts:4` |
| `test/fake-sync.svelte.ts` `SyncCall`, `test/StoreHost.svelte` | none outside `src/lib/game` |

### `src/lib/server/game/store.ts` (importers anywhere)

| Export | Importers |
| --- | --- |
| `accountLine` | `src/routes/api/game/+server.ts:4`; `src/routes/api/game/[id]/+server.ts:6`; `src/lib/server/game/store.spec.ts:9` |
| `listGames` | `src/routes/api/game/+server.ts:4`; `src/lib/server/game/store.spec.ts:9` |
| `readGame` | `src/routes/api/game/[id]/+server.ts:6`; `src/lib/server/game/store.spec.ts:9` |
| `putGame` | `src/routes/api/game/[id]/+server.ts:6`; `src/routes/api/game/server.spec.ts:4`; `src/lib/server/auth/better-auth.spec.ts:8`; `src/lib/server/user-store/deletion.spec.ts:5`; `src/lib/server/game/store.spec.ts:9` |
| `removeGame` | `src/routes/api/game/[id]/+server.ts:6`; `src/routes/api/game/server.spec.ts:4`; `src/lib/server/user-store/deletion.spec.ts:5`; `src/lib/server/game/store.spec.ts:9` |
| `moveGames` | `src/lib/server/auth/better-auth.ts:24` (called at :108 as `onFuse`); `src/lib/server/game/store.spec.ts:9` |
| `deleteGamesOf` | `src/lib/server/user-store/deletion.ts:16` (called at :166); `src/lib/server/game/store.spec.ts:9` |
| `REMOVED_LIST_DAYS` | `src/lib/server/game/store.spec.ts:9` only |

`gameSave` (the table) outside its schema file and the server store: only specs
(`src/lib/server/auth/better-auth.spec.ts:7`, `src/lib/server/game/store.spec.ts:4`,
`src/lib/server/user-store/deletion.spec.ts:17`, `src/routes/api/game/[id]/server.spec.ts:4`) and
the name `game_save` in `src/lib/server/db/schema/auth-schema.spec.ts:31,41,67`. V.

### Non-import uses of the store's methods outside `src/lib/game` (non-spec files; all V)

| Member | Call sites |
| --- | --- |
| `won()` | `src/routes/+page.svelte:189`; `src/lib/timeline/TimelineMode.svelte:762` |
| `setOffer()` | `src/routes/+page.svelte:215,218,223`; `src/lib/timeline/TimelineMode.svelte:774,1532`; `src/lib/timeline/test/game.ts:26` |
| `levelUp()` | `src/routes/+page.svelte:269`; `src/lib/timeline/TimelineMode.svelte:1760`; `src/lib/shell/LevelCell.svelte:51`; `src/lib/timeline/test/game.ts:27` (inside the game dir: `LevelPanel.svelte:75`) |
| `touched()` | `src/routes/+page.svelte:238`; `src/lib/sim-page/SimPage.svelte:335` |
| `beforeLeave()` | `src/routes/+page.svelte:80`; `src/lib/sim-page/SimPage.svelte:1123` |
| `remix()` | `src/routes/s/[id]/+page.svelte:64`; `src/routes/p/[id]/+page.svelte:70` |
| `newGame()`, `switchTo()`, `rename()`, `remove()` | none outside `src/lib/game` in non-spec files (callers: `LevelPanel.svelte:86,94,68,117,166`) |
| `adopt()`, `rekey()`, `read()` | none outside `src/lib/game` in non-spec files (caller: `save-sync.svelte.ts`) |
| `progress` / `open` / `offer` / `saves` / `sync` / `allowed` reads | `src/routes/+page.svelte:172`; `src/routes/s/[id]/+page.svelte:40-43,49`; `src/routes/p/[id]/+page.svelte:57-58,61`; `src/lib/shell/SiteHeader.svelte:71,72,78,193,253`; `src/lib/shell/LevelCell.svelte:29,31`; `src/lib/sim-page/SimPage.svelte:207,523,524`; `src/lib/sim-page/SimRoute.svelte:56,103`; `src/lib/timeline/TimelineMode.svelte:411` |

---

## (c) The saved game

### Payload types and version fields

- **V** `GameSave` (`src/lib/game/saves.ts:5-19`): `v: 1`, `id`, `name`, `nameIsDefault`, `progress: Progress`, `plan: string | null`, `policy: string | null`, `savedAt` (ISO).
- **V** `Progress` (`src/lib/game/progress.ts:13-20`): `v: 1`, `level: Level`, `banked: Partial<Record<2|3|4|5, Banked>>`, `firstWinAt: string | null`.
- **V** `Banked` (`progress.ts:4-11`): `on: Day`, `datasetVersion: string`, `at: string` (ISO). `Day` is "Integer days since 1970-01-01 UTC" (`src/lib/timelapse/time.ts:6-7`).
- **V** Version fields: `GameSave.v` (literal 1), `Progress.v` (literal 1), the index's `v: 1` (`store.svelte.ts:181,409`), `SyncRecord.v: 1` (`save-sync.svelte.ts:36`). Each parser refuses any other value: `parseGameSave` returns null unless `json.v === 1` (`saves.ts:94`), `parseProgress` unless `x.v === 1` (`saves.ts:69`), `parseIndex` unless `json.v === 1` (`store.svelte.ts:181`), `parseRecord` unless `json.v === 1` (`save-sync.svelte.ts:59`).
- **V** In the non-test files of the scope (all read in full) nothing converts a save, a progress, an index or a sync record from another `v`. A stored save that does not parse is moved to a corrupt key at construction (`store.svelte.ts:371`, `:384`); a `PUT` of one answers 422 `invalid` (`[id]/+server.ts:48-49`); a fetched one is skipped with a `console.error` (`save-sync.svelte.ts:493-499`).
- **V** `plan` and `policy` are opaque text copies of the `sfhousing:plan:v1` and `sfhousing:sim:v2` records (`saves.ts:13-16`); `parseGameSave` checks only null-or-string (`saves.ts:102-103`). **V** The server never parses them: `putGame` stores `JSON.stringify(save)` (`src/lib/server/game/store.ts:116`).

### Validation (`parseGameSave`, `saves.ts:93-107`; all V)

- Plain object with `v === 1` (:94).
- `id` a string for which `isValidId` holds (:96); `isValidId` = Base58 that decodes to 16 bytes forming a v7 UUID (`src/lib/ids/base58.ts:20-25`).
- `name` a string equal to its own `trim()` (:97), 1 to `SAVE_NAME_MAX` (60) code points (:98-99).
- `nameIsDefault` boolean (:100); `savedAt` a string `Date.parse` finds finite (:101, `isTime` :55-57).
- `plan`, `policy` each null or string (:102-103).
- `progress` (`parseProgress`, :68-91): `v === 1`; `level` an integer 1 to 5 (:71, with a local `LAST_LEVEL = 5` at :47); `firstWinAt` null or a time (:75); `banked` a plain object (:76) that must hold every key from `'2'` to `String(level - 1)` (:82), may hold `'5'` only at level 5 (:80), and holds no other key (:85); each entry passes `parseBanked` (:59-66: `on` a non-negative integer, `datasetVersion` a non-empty string, `at` a time).
- **V** The result is rebuilt from the known fields only (`saves.ts:106`, `:90`, `:65`): any other field on the input is dropped. The server stores the parsed value (`src/routes/api/game/[id]/+server.ts:48` then `store.ts:116`), `adopt` stores the parsed value (`store.svelte.ts:723-724`), and construction keeps the parsed value in memory (`store.svelte.ts:200-206`, `:369-370`, `:378-380`).

### Size limits (all V)

- `MAX_SAVE_BYTES = 600_000` (`save-api.ts:3`), applied only in `PUT /api/game/[id]`: on the declared `content-length` (`+server.ts:29-30`) and on the UTF-8 byte length of the body text (`:31-32`). The limit is on the whole request body (`{ baseRev, save }`), not on the save alone.
- `SAVE_NAME_MAX = 60` code points (`saves.ts:29`), enforced by `parseGameSave` (`saves.ts:98-99`), `cutName` (`store.svelte.ts:145-147`), `defaultSaveName` (`saves.ts:127-134`) and the rename field's `maxlength` (`LevelPanel.svelte:227`).
- **I** No size limit is applied in the browser store before a write: `store.svelte.ts` has no reference to `MAX_SAVE_BYTES` (grep over `src` finds it only in `save-api.ts`, the `[id]` route and its spec). A write the browser refuses surfaces as `{ ok: false, reason: 'storage' }` (`store.svelte.ts:49`, `:466`).

### Number of saved games (all V unless marked)

- `MAX_SAVES = 12` (`saves.ts:28`).
- Browser: `newGame()` and `remix()` answer `full` at `#games.size >= MAX_SAVES` (`store.svelte.ts:634`, `:653`); `adopt()` answers `full` when added ids would take the list past it (`:729`).
- Server: a new id is inserted only while the identity has fewer than `MAX_SAVES` live rows (`store.ts:129-131`); otherwise `too_many` (`:135`). An update of an existing id has no count check (`:138-151`).
- **I** `moveGames` applies no cap (no count check in `store.ts:169-209`; `docs/dev/game-save.md:120-121` says the same).
- **I** A rebuild from an invalid index applies no cap (no count check in `#recover`, `store.svelte.ts:338-401`; `docs/dev/game.md:97` says "The list may exceed `MAX_SAVES`").
- UI readers: `LevelPanel.svelte:34` (`full`), `:289-292`; `src/routes/s/[id]/+page.svelte:42`; `src/routes/p/[id]/+page.svelte:58`; `FULL_TEXT` (`copy.ts:88`); `src/lib/about/copy.ts:99` ("You can keep ${MAX_SAVES}.").

### D1: `game_save`

Schema `src/lib/server/db/schema/gameSave.ts:4-20`; the only migration that names the table is
`migrations/d1/20261123043045_cloudy_devos.sql` (identical text in
`migrations/d1/20261123043045_cloudy_devos/migration.sql`). `grep -rl game_save migrations` finds
those two files and that migration's `snapshot.json`, nothing else: no later migration alters the
table. All rows V.

| Column (SQL) | Drizzle field | Type | Null | Holds |
| --- | --- | --- | --- | --- |
| `identity_id` | `identityId` | text | NOT NULL, FK `user_identity(id)` | the account's identity id |
| `id` | `id` | text | NOT NULL | the saved game's id |
| `rev` | `rev` | integer | NOT NULL | 1 on insert (`store.ts:124`), `rev + 1` on update (`:143`) |
| `name` | `name` | text | NOT NULL | copy of `save.name` (`store.ts:124,145`) |
| `level` | `level` | integer | NOT NULL | copy of `save.progress.level` (`store.ts:124,146`) |
| `body` | `body` | text | NOT NULL | `JSON.stringify(save)` (`store.ts:116`); `''` once removed (`:165`) |
| `saved_at` | `savedAt` | integer (`timestamp_ms`) | NOT NULL | `new Date(save.savedAt)` (`store.ts:117`) |
| `removed_at` | `removedAt` | integer (`timestamp_ms`) | nullable | set by `removeGame` (`store.ts:165`) |

Primary key `(identity_id, id)` (`gameSave.ts:19`; SQL line 10). No other index. The foreign key
has no `ON DELETE` clause in the SQL (line 11).

- **V** `listGames` reads `name`, `savedAt`, `level`, `rev` from columns and `nameIsDefault` from the body with `json_extract(body, '$.nameIsDefault')` (`store.ts:52-59`); the `level` column is cast `as Level` (`:80`).
- **V** `moveGames` rewrites the body's top-level `id` with `json_set(body, '$.id', nid)` when the survivor already holds that id (`store.ts:188-200`).

### API routes

`/api/game` is in `SESSION_ROUTE_PREFIXES` (`src/lib/server/auth/session-gate.ts:27-36`). V.

**`GET /api/game`** (`src/routes/api/game/+server.ts:6-14`; all V)

| Status | Body | When |
| --- | --- | --- |
| 401 | empty | no `locals.user` (:7) |
| 200 | `{ handle, handleClaimed, saves: { id, name, nameIsDefault, savedAt, level, rev }[], removed: string[] }` | otherwise (:13; shapes from `store.ts:43`, `:75-83`). `saves` are live rows ordered by `saved_at` descending (`store.ts:61-62`); `removed` are ids removed within `REMOVED_LIST_DAYS` (90) of now (`store.ts:63-73`) |

**`GET /api/game/[id]`** (`src/routes/api/game/[id]/+server.ts:15-21`; all V)

| Status | Body | When |
| --- | --- | --- |
| 401 | empty | no `locals.user` (:16) |
| 404 | empty | no row (:18) |
| 410 | empty | a removed row (:19) |
| 200 | `{ rev, save }` | a live row (:20) |

**`PUT /api/game/[id]`** (`[id]/+server.ts:23-85`; request body `{ baseRev: number | null, save: GameSave }`; checks in this order; all V)

| Order | Status | Body | When |
| --- | --- | --- | --- |
| 1 | 415 | `{ error: AUTH_COPY.jsonRequired }` | content type is not `application/json` (:26; `src/lib/server/security/same-origin-json.ts:11-14`) |
| 1 | 403 | `{ error: AUTH_COPY.crossOrigin }` | an `Origin` header present and not this origin (`same-origin-json.ts:22-27`) |
| 2 | 413 | empty | declared `content-length` over 600,000 (:29-30) |
| 3 | 413 | empty | body text over 600,000 UTF-8 bytes (:31-32) |
| 4 | 422 | `{ error: 'invalid' }` | not JSON (:34-39); not a plain object (:40); `baseRev` neither null nor a positive integer (:42-47); `parseGameSave` refuses `save`, or `save.id !== params.id` (:48-49) |
| 5 | 401 | `{ error: 'sign_in' }` | no `locals.user` and the `sfh_known` cookie is `'1'` (:53; `src/lib/server/onboarding/known-device.ts:6,18-20`) |
| 6 | 422 | `{ error: 'no_win' }` | no `locals.user` and `save.progress.firstWinAt === null` (:54) |
| 7 | 429 | empty | no `locals.user` and the mint is refused at 429 (:55-57; `PSEUDO_MINT_RL`, key `pseudo_mint:<CF-Connecting-IP>`, critical, `src/lib/server/onboarding/pseudonymous-mint.ts:21-28`) |
| 7 | 500 | `{ error: minted.message }` | the mint fails otherwise (:58) |
| 8 | 429 | empty | `enforceRate(MUTATION_REGISTERED_RL, 'game_write:<user.id>', env)` refuses (:63-71) |
| 9 | 200 | `{ handle, handleClaimed, rev }` | `putGame` stored (:76-77) |
| 9 | 409 | `{ rev, save }` (the stored row) | `putGame` conflict (:78-79): a live row whose `rev !== baseRev` (`store.ts:138`, `:107`) |
| 9 | 410 | empty | the row is removed (:80-81) |
| 9 | 422 | `{ error: 'too_many' }` | a new id and 12 live rows already (:82-83) |

**`DELETE /api/game/[id]`** (`[id]/+server.ts:87-103`; all V)

| Status | Body | When |
| --- | --- | --- |
| 415 / 403 | `{ error }` | `refuseUnlessSameOriginJson` (:88-89) |
| 401 | empty | no `locals.user` (:91) |
| 429 | empty | `MUTATION_REGISTERED_RL`, key `game_write:<user.id>` (:92-100) |
| 204 | empty | after `removeGame` (:101-102); **I** also for an unknown or already removed id, because `removeGame`'s `UPDATE … WHERE removed_at IS NULL` matches nothing and does not throw (`store.ts:163-166`) |

**Rate limit** (all V): binding `MUTATION_REGISTERED_RL`, `{ "limit": 120, "period": 60 }` in
production (`wrangler.jsonc:31-35`, namespace 4107) and staging (namespace 4207, same numbers).
The key is per identity (`game_write:<id>`), shared by `PUT` and `DELETE`. `enforceRate` always
allows when `ENVIRONMENT === 'development'` (`src/lib/server/security/rate-limit.ts:23`) and, with
no `critical` option, allows when the binding is missing (`:24-34`). `GET` routes have no rate limit.

### localStorage keys

| Key | Defined | Holds | Mark |
| --- | --- | --- | --- |
| `sfhousing:saves:v1` | `SAVES_KEY`, `saves.ts:26` | the index `{ v: 1, current: <id>, saves: SaveEntry[] }` (`store.svelte.ts:407-410`; parsed at `:174-198`). Entries are latest first, ties by id (`:416-429`); each is `{ id, name, nameIsDefault, savedAt, level }` (`:149-157`) | V |
| `sfhousing:save:<id>` | `saveKey`, `saves.ts:27` | one `GameSave` as JSON (`store.svelte.ts:312`, `:485`) | V |
| `sfhousing:save:corrupt:<ISO time>` | `CORRUPT_PREFIX`, `store.svelte.ts:38` | the raw text of an index or a save that would not parse or whose id differs from its key (`:345-349`, `:356-358`, `:371`, `:384`); the time moves on one millisecond until the key is free (`freeKey`, `:86-96`) | V |
| `sfhousing:plan:v1` | `PLAN_RECORD`, `store.svelte.ts:29` (comment: `PLAN_KEY` of `$lib/sharing/storage`) | the current game's plan record; read by the store (`:127-132`, `:292`), written when another game becomes current (`:501-504`) | V |
| `sfhousing:sim:v2` | `POLICY_RECORD`, `store.svelte.ts:31` (comment: `SIM_KEY4` of `$lib/timeline/sim-doc4`) | the current game's policy record; same reads and writes | V |
| `sfhousing:sim:v1` | `OLD_POLICY`, `store.svelte.ts:33` | the schema 3 policy record; removed whenever a change writes the two record keys (`:496`, `:505`) | V |
| `sfhousing:sim:corrupt:<ISO time>` | `OLD_POLICY_ASIDE`, `store.svelte.ts:35` | the v1 policy text, copied there when `sfhousing:sim:v2` was absent (`:498-500`) | V |
| `sfhousing:saves:revs` | `SAVE_REVS_KEY`, `save-sync.svelte.ts:25` | the `SyncRecord` `{ v: 1, seen: { [id]: { rev, savedAt } }, deleting: string[] }` (`:35-41`, written `:217-225`); a value that does not parse is replaced by an empty record (`:207-213`) | V |
| `sfhousing:e2e:game` | `E2E_GAME_KEY`, `e2e.ts:1` | present (the helpers write `'1'`) = the real game is on, on a `VITE_E2E=1` build (`e2e.ts:5-13`) | V |
| `sfhousing:e2e:goal` | `E2E_GOAL_KEY`, `e2e.ts:2` | a whole number of at least 1: the goal's amount on a `VITE_E2E=1` build (`e2e.ts:16-27`) | V |

- **V** The store's key strings for the plan and policy records are literals repeated in `store.svelte.ts:29-35`, not imports of `PLAN_KEY` / `SIM_KEY4` / `SIM_KEY`.
- **V** The storage object is `getStorage()` of `$lib/sharing/storage` (`src/routes/+layout.svelte:14,21`). I did not read `getStorage`; that it returns `localStorage` is **I** (the docs call it `localStorage`, `docs/dev/game-save.md:275`).

---

## (d) The store's state

### What "current game" is

- **V** The store holds every saved game in memory by id (`#games`, `store.svelte.ts:234`) and one `#currentId` (`:237`). The current game is `#games.get(#currentId)` (`:440-442`).
- **V** The reactive state is `#progress` (the current game's `progress`), `#currentId`, `#offer`, `#saves` (`:236-239`), set together by `#settle` (`:432-438`).
- **V** For the current game only, the plan and policy text are read live from the two record keys, falling back to the stored copy (`recordsOf`, `:127-132`; `readRecord`, `:780-787`); `read(currentId)` returns that text and the played time (`:707-716`). For every other game the stored copy in its save is used.
- **V** "Played time" is the latest of the save's `savedAt` and each record's own finite `savedAt` (`playedTime`, `:113-124`; `recordTime`, `:98-110`).
- **V** Making another game current writes: the old game copied out (or its key removed), a v1 copy aside when due, the target's save when newly made, the target's two records, the index; then clears the offer and sets `#left` (`#makeCurrent`, `:513-546`).
- **V** The root layout builds one store per document: `openGame()` on the server or when `e2eOpen(storage)`, else `new GameStore({ storage, sync })` then `sync.attach(store)` (`src/routes/+layout.svelte:19-32`).

### Level, progress and banked dates

- **V** Level is `Progress.level`, 1 to 5 (`progress.ts:15`, `levels.ts:6`).
- **V** `banked[n]` is "the result banked on leaving level n" (`progress.ts:16-17`): keys 2 to 5, each `{ on: Day, datasetVersion, at }`.
- **V** `firstWinAt` is the ISO time `won()` first ran; set once (`store.svelte.ts:595-600`).
- **V** `NEW_GAME` is `{ v: 1, level: 1, banked: {}, firstWinAt: null }` (`progress.ts:22`). The open game is `{ v: 1, level: 5, banked: {}, firstWinAt: null }` (`store.svelte.ts:211`).

### `setOffer`

- **V** `setOffer(offer)` assigns `#offer` and does nothing else: no write, no sync call (`store.svelte.ts:602-604`).
- **V** `Offer` is `{ on: Day | null; datasetVersion: string }`; `on` is null for Paint's win (`:21-26`).
- **V** Callers: Paint sets `{ on: null, datasetVersion: data.datasetVersion }` while `won`, and null when it stops or the page is destroyed (`src/routes/+page.svelte:213-224`); `/sim` sets `{ on: s.on, datasetVersion }` while the standing is `won`, else null (`src/lib/timeline/TimelineMode.svelte:768-776`), and null again at `:1532`.
- **V** The offer is also cleared by `#makeCurrent` (`:543`), by `adopt` of the current id (`:754-757`) and by `levelUp` (below).

### `levelUp` (the store method)

- **V** `store.svelte.ts:606-617`: returns at once when `#offer` is null. Builds `banked = offer.on === null ? null : { on: offer.on, datasetVersion: offer.datasetVersion, at: now }`. Calls the pure `levelUp(cur.progress, banked)`. When progress is unchanged, or when the write of `{ ...cur, progress, savedAt: at }` is accepted, the offer is set to null. A refused write keeps the offer.
- **V** The write (`#write`, `:479-489`) stores the current save with the records copied in, rewrites the index and calls `sync.changed(id)`.
- **V** `LevelPanel.svelte:71-80` detects a refused write by comparing `game.offer` before and after and shows `STORAGE_TEXT`.

### `progress.ts` computes (all V)

- `barOf(p)` (`:25-29`): null when `p.level < 3`; else `{ on: p.banked[p.level - 1].on }`, or null when that entry is missing.
- `roundComplete(p)` (`:32-34`): `p.level === LAST_LEVEL && p.banked[5] !== undefined`.
- `levelUp(p, banked)` (`:37-43`): returns `p` when the round is complete; at level 1 returns `{ ...p, level: 2 }` (nothing banked, whatever `banked` is); returns `p` when `banked` is null; otherwise banks under `p.level` and raises the level by one, except at level 5 where the level stays 5.

### `standing.ts` computes (all V)

- `standing(level, bar, seen)` (`:8-14`): `{ kind: 'playing' }` at level 1 or when `seen` is null. At level 2 the bar is ignored (`against = null`). With no bar to beat, `won` is `seen.kind === 'reached'`; with one, `beats(seen, against)`. Won gives `{ kind: 'won', on: seen.on }`; otherwise `{ kind: 'short', seen, bar }` (the `bar` passed in, also at level 2).
- `beats` (`levels.ts:21-26`): `seen` reached and its UTC calendar month earlier than the bar's; a tie is false.
- Caller: `src/lib/timeline/TimelineMode.svelte:679-681` (`bar = barOf(g.progress)`; `standing(g.progress.level, bar, seenResult)`).

### `navigate.ts` (all V)

- `gamePath(level)`: `'/'` at level 1, `'/sim'` above (`:4-6`).
- `remixPath(kind)`: `'/'` for `'plan'`, `'/sim'` for `'sim'` (`:9-11`).
- `loadPage(path)`: `window.location.assign(path)` (`:14-16`).
- Callers: `LevelPanel.svelte:55,172` (`loadPage(gamePath(game.progress.level))`); `src/routes/s/[id]/+page.svelte:9,49`; `src/routes/p/[id]/+page.svelte:14,61`.

### `allowed.ts` (what a level allows; all V)

- `AT` (`:18-24`): levels 1 and 2 no kinds; 3 `permitting`; 4 `permitting`, `zoning`; 5 all three; `money: 'given'` at every level. `ALL_ALLOWED` is all three kinds with `money: 'all'` (`:12-15`); the store gives it only to the open game (`store.svelte.ts:240`), and eight files outside the game import it (census in (b); what they do with it was not read).
- `UNLOCKS` (`:30`): permitting 3, zoning 4, money 5.
- `isGiven` (`:38-43`): `typeof p.preset === 'string'` and `p.where.tag` is `fund`, `baseline` or `terms`.
- `runs` (`:45-47`), `playable` (`:51-63`), `levelNeeded` (`:66-73`, 6 for any money policy that is not given), `simLocked` (`:76-78`, `p.level === 1`), `needsHigher` (`:81-84`).

### Where the number of levels is written into code (all V)

`levels.ts:6-7`; `saves.ts:47` (its own `LAST_LEVEL = 5`), `:71`, `:79-88`; `progress.ts:17`
(`2 | 3 | 4 | 5`), `:27`; `allowed.ts:18-24`, `:30`, `:66-73`; `copy.ts:14-21`;
`store.svelte.ts:191` (`level < 1 || level > 5` in `parseIndex`), `:211`; the `level` column
(`gameSave.ts:13`) and `store.ts:80,124,146`; `SaveEntry.level` (`saves.ts:22-24`);
`e2e/helpers/game.ts:24-26,32,39`.

### Other store behaviour (all V)

- Memory mode: `#storage === null`; `newGame`, `switchTo` of another id, `remix`, `remove`, `adopt`, `rekey` answer `{ ok: false, reason: 'storage' }` (`:633`, `:645`, `:652`, `:680`, `:720`, `:762`).
- `touched()` writes the current save with `savedAt` now and calls `sync.changed`; it does nothing once `#left` is set (`:619-622`).
- `beforeLeave(fn)` registers a flush called before another game becomes current (`:624-631`, `:556-564`).
- `useGame()` returns the context's store or a new `openGame()` (`:805-807`).

---

## (e) The e2e seam

### `src/lib/game/e2e.ts` (all V)

- `e2eOpen(storage)` (`:5-13`): false unless `import.meta.env.VITE_E2E === '1'`; then true when `storage` is null, when `E2E_GAME_KEY` is absent, or when reading throws. Only caller: `src/routes/+layout.svelte:22` (then the layout provides `openGame()`).
- `e2eGoalAmount(storage)` (`:16-27`): null unless `VITE_E2E === '1'` and storage is not null; else the value under `E2E_GOAL_KEY` when it matches `/^[0-9]+$/` and is a safe integer of at least 1. Callers: `src/routes/+page.svelte:70`, `src/lib/sim-page/SimRoute.svelte:61`, `src/lib/sim-page/SimPage.svelte:219`.
- `VITE_E2E=1` is set in the Playwright web server command (`playwright.config.ts:52`).

### `e2e/helpers/game.ts` (all V)

- `SEED_BAR_DAY` (`:19`): the first day of the calendar month holding the fixture window's last day (`WINDOW_MONTHS = 480` at `:10`, `asOf` from the fixture's `calibration.json`).
- `seedGame(page, level: 1|2|3|4|5)` (`:24-70`): throws when the page already has a game or the level is out of range; builds a `GameSave` named "Seeded game" with `banked[n]` for `n` in `2..level-1` at `SEED_BAR_DAY` on `'fixture-0'`, `firstWinAt` set when `level > 1`; in an init script sets `E2E_GAME_KEY` to `'1'` and, only when `SAVES_KEY` is absent, writes the save and the index.
- `newVisitor(page)` (`:73-83`): sets `E2E_GAME_KEY` to `'1'` and stores nothing else.
- `seedGoalAmount(page, amount)` (`:86-99`): sets `E2E_GOAL_KEY`; throws unless `amount` is a safe integer of at least 1.
- It imports `saves.ts` and `e2e.ts` by relative path and `Banked` as a type (`:5-7`).
- No other file under `e2e/helpers` refers to the game (grep for `game|level|sfhousing:(e2e|save)`: a comment in `a11y.ts:8` about WCAG levels and a comment in `sharing.ts:83` about the Menu button's name). The other helpers were not read.

### Which specs use it (all V; line numbers are the calls)

| Spec | `seedGame` | `newVisitor` | `seedGoalAmount` | Other seam use |
| --- | --- | --- | --- | --- |
| `e2e/game-core.spec.ts` | 56, 69 | 45 | | `SAVES_KEY`, `saveKey` (:3) |
| `e2e/game-helpers.spec.ts` | 62, 75, 95, 102, 110, 139, 161, 188, 192, 193, 209, 223 | 118, 187, 197 | 180, 194 | `SEED_BAR_DAY` (:70, :91), `E2E_GAME_KEY`, `E2E_GOAL_KEY` (:3), `SAVES_KEY`, `saveKey` (:4) |
| `e2e/game-journey.spec.ts` | 177 | 72 | 73 | `E2E_GOAL_KEY` written with `page.evaluate` (:94-95) and read (:160) |
| `e2e/game-save.spec.ts` | 63 | 93 | | `SAVES_KEY`, `saveKey` (:5); `/api/game` responses (:12, :64, :79, :95-98) |
| `e2e/game-shell.spec.ts` | 89, 109, 143 | 54, 66 | 67 | |
| `e2e/game-sim.spec.ts` | 173, 184, 218, 231, 264, 280, 324, 338, 347 | | 185, 219, 232 | |
| `e2e/chrome-dark.spec.ts` | 543 | | | |
| `e2e/share-notices.spec.ts` | 226 | | | |
| `e2e/share-roundtrip.spec.ts` | 59 | | | |
| `e2e/share-states.spec.ts` | 141, 165 | | | |
| `e2e/sim-share.spec.ts` | 222, 363 | | | |

- **I** Every other e2e spec runs with the open game (no helper called, so `E2E_GAME_KEY` is absent and `e2eOpen` is true): `e2e/game-core.spec.ts:36` is titled "with no helper the layout provides the open game".

### Vitest-side seeding (outside the scope's directories; read because they build saves)

- **V** `src/lib/shell/test/seeded-game.ts:41-84` (`seededGame`): writes `SAVES_KEY`, one `saveKey(id)` per game and optionally the two record keys into a `MemoryStorage`, then constructs a `GameStore`; `quietSync` (`:11-20`).
- **V** `src/lib/timeline/test/game.ts:12-30` (`gameAt`): constructs a store with `FakeSync` and climbs with `setOffer` then `levelUp`.

---

## (f) AccountOffer and when an account is created

- **V** An account is made by `PUT /api/game/[id]` and nowhere else in the game layer: with no `locals.user`, no `sfh_known` cookie and a save whose `progress.firstWinAt` is not null, the route calls `mintPseudonymousSession(event)` (`src/routes/api/game/[id]/+server.ts:51-61`). Grep over `src` (non-spec) finds no other caller of `mintPseudonymousSession`.
- **V** `mintPseudonymousSession` (`src/lib/server/onboarding/pseudonymous-mint.ts:17-40`) rate-limits by IP on `PSEUDO_MINT_RL` (5 per 60 s, `wrangler.jsonc`), then calls `authFor(event).api.signInAnonymous()` (:29) and resolves the user (:33-38).
- **V** The first win: Paint calls `game.won()` when the card opens (`src/routes/+page.svelte:186-190`); `/sim` calls `g?.won()` when the standing becomes won (`src/lib/timeline/TimelineMode.svelte:750-763`). `won()` sets `firstWinAt` once and writes, which calls `sync.changed(id)` (`store.svelte.ts:595-600`, `:488`).
- **V** The browser's chain: with no session, `changed(id)` ignores a save whose `firstWinAt` is null (`save-sync.svelte.ts:306-309`), else marks it and starts the 2-second timer (`:311`, `:554-570`, `DEBOUNCE_MS` `:43`); `#put` sends `PUT /api/game/<id>` with `{ baseRev, save }` (`:661-666`); with no session at most one PUT is in flight (`:657-658`); a 200 with no session sets `#putSession` and sends every other saved game (`:687`, `:705-711`).
- **V** At attach with no session, every saved game with `firstWinAt` set and not already seen at that `savedAt` is marked to send (`:262-269`).
- **V** `AccountOffer.svelte` makes no account itself. Its only request is `PATCH /api/account/profile` with `{ handle }` (:51-55), followed on 200 by `currentUser.apply` and `game.sync.pull()` (:59-62). It is mounted only by `WinCard.svelte:62`.
- **V** Its four states (`AccountOffer.svelte:79-122`): sync state `sign-in` → a link to `/signin?returnTo=…` (:81-82); not claimed and a user or account present → the "Save as" form (:83-109); claimed → `@handle` link to `/account`, plus "Add an email to play on another device" while `!hasEmail` (:110-116); else `syncText('local')` (:117-118). `claimed` is `savedHandle !== null || (account === null ? user !== null : account.handleClaimed)` (:29-31). It renders nothing when `game.open` (:79).
- **V** `handleClaimed` is true when a `handle_tombstone` row has `released_by` equal to the user id (`store.ts:38-43`).

---

## (g) `copy.ts`: every user-visible string

All V, `src/lib/game/copy.ts`.

| Key | String(s) | Line |
| --- | --- | --- |
| `barText(bar)` | `` `Beat ${formatShortMonthYear(bar.on)}` `` (e.g. "Beat Jun 2057") | 11 |
| `unlockText(1)` | "Paint" | 15 |
| `unlockText(2)` | "The simulation" | 16 |
| `unlockText(3)` | "Permitting" | 17 |
| `unlockText(4)` | "Zoning" | 18 |
| `unlockText(5)` | "Public money" | 19 |
| `unlockText(6)` | "The end of the round" | 20 |
| `lockedLane(kind, level)` | "" when unlocked; "Unlocks when you level up" when the kind unlocks at `level + 1`; `` `Unlocks at level ${at}` `` otherwise | 31-33 |
| `levelText(level)` | `` `Level ${level}` `` | 38 |
| `aimText(p)` | "Round complete" (round complete); "Paint room for the goal" (level 1); `barText(bar)` when there is a bar; "Play to the goal" otherwise | 43-46 |
| `nextText(p)` | "Coming next: designing funding, market rules and affordability targets" (round complete); `` `Next: ${unlockText(p.level + 1)}` `` otherwise | 51-54 |
| `syncText('local')` | "On this device only" | 61 |
| `syncText('saving')` | "Saving" | 63 |
| `syncText('offline')` | "Offline" | 65 |
| `syncText('sign-in')` | "Sign in to save" | 67 |
| `syncText('full')` | "Account full. Delete a saved game." | 69 |
| `syncText('saved')` | null | 71 |
| `playedText(savedAt, now)` | "Today"; "Yesterday"; `` `${day} ${SHORT_MONTHS[month]}` `` (e.g. "4 Mar"); with the year when it is not this year (e.g. "4 Mar 2025") | 82-85 |
| `FULL_TEXT` | `` `${MAX_SAVES} saved games. Delete one first.` `` = "12 saved games. Delete one first." | 88 |
| `STORAGE_TEXT` | "This browser refused to save." | 89 |

User-visible strings of the game layer that are **not** in `copy.ts` (all V):

- `saves.ts:113`: `` `Game, ${day} ${month}` ``; `:116`: "Remix" / `` `Remix of ${title}` ``; `:118`: `` `${name} (this device)` ``; `:130`: suffix `` ` (${n})` ``; `:31-44`: the month names.
- `store.svelte.ts:250`: "Game" (the open game's name).
- `WinCard.svelte`: "Unlocks: " (:48), "Round complete" (:50), "Level up" (:55), "Keep playing" (:59).
- `LevelPanel.svelte`: "Level up" (:199), "Saved games" (:210), aria-label "Name" (:226), "Playing" (:246), `` `Delete ${name}?` `` (:249), "Delete" (:252, :281), "Cancel" (:260), `` `Rename ${name}` `` (:269), "Rename" (:272), `` `Delete ${name}` `` (:278), "New game" (:290).
- `AccountOffer.svelte`: "Saved." (:61), "Couldn't save. Try again." (:65, :69), "Sign in first." (:67), "Couldn't reach the server. Check your connection." (:72), "Save as" (:85), "@" (:87), "Save" (:105), "Add an email to play on another device" (:114).
- Outside the scope, found by the census and not read in full: `src/lib/timeline/game-copy.ts` exports `shortOfBar`, `missedBar`, `missed`, `winTitle`, `TO_BEAT_FLAG = 'To beat'`, `GOAL_AND_BAR_FLAG = 'Goal · To beat'`, `toBeatLine`, `toBeatDescription`, `LATER_ROUND = 'Unlocks in a later round'`, `levelledUp`, `lockedSim`, `GO_TO_PAINT = 'Go to Paint'` (lines 8-47); `src/lib/shell/LevelCell.svelte:29` has "Round complete"; `src/lib/about/copy.ts:99` has "Each saved game has its own level, months to beat, plan and policy. You can keep 12."

---

## (h) Tests per source file

Counted from source: `it(` / `test(` call sites at the start of a line, and `it.each` declarations
separately (each expands to several tests at run time). The tests were not run, so run-time totals
are not verified. All rows V as counts of declarations.

| Source file | Spec file | `it(`/`test(` | `it.each` | Notes |
| --- | --- | --- | --- | --- |
| `src/lib/game/AccountOffer.svelte` | `AccountOffer.svelte.spec.ts` | 19 | 0 | one `it` sits in a 2-item loop (:255) |
| `src/lib/game/LevelPanel.svelte` | `LevelPanel.svelte.spec.ts` | 24 | 0 | |
| `src/lib/game/WinCard.svelte` | `WinCard.svelte.spec.ts` | 9 | 0 | |
| `src/lib/game/allowed.ts` | `allowed.spec.ts` | 14 | 0 | one `it` sits in a loop over `cases` (:76) |
| `src/lib/game/copy.ts` | `copy.spec.ts` | 17 | 0 | one `it` sits in a loop over the kinds (:57) |
| `src/lib/game/e2e.ts` | `e2e.spec.ts` | 8 | 0 | |
| `src/lib/game/levels.ts` | `levels.spec.ts` | 4 | 2 | |
| `src/lib/game/navigate.ts` | `navigate.spec.ts` | 7 | 0 | |
| `src/lib/game/progress.ts` | `progress.spec.ts` | 11 | 3 | |
| `src/lib/game/save-sync.svelte.ts` | `save-sync.svelte.spec.ts` | 48 | 1 | 1,340 lines |
| `src/lib/game/saves.ts` | `saves.spec.ts` | 14 | 2 | |
| `src/lib/game/standing.ts` | `standing.spec.ts` | 4 | 6 | |
| `src/lib/game/store.svelte.ts` | `store.svelte.spec.ts` | 86 | 6 | 1,776 lines |
| `src/lib/game/save-api.ts` | none | 0 | 0 | types and one constant |
| `src/lib/game/test/fake-sync.svelte.ts`, `test/StoreHost.svelte` | none | 0 | 0 | test helpers |
| `src/lib/server/game/store.ts` | `store.spec.ts` | 16 | 0 | |
| `src/lib/server/db/schema/gameSave.ts` | none of its own | 0 | 0 | named in `src/lib/server/db/schema/auth-schema.spec.ts:31,41,67` |
| `src/routes/api/game/+server.ts` | `server.spec.ts` | 2 | 0 | |
| `src/routes/api/game/[id]/+server.ts` | `[id]/server.spec.ts` | 30 | 2 | |
| `e2e/helpers/game.ts` | `e2e/game-helpers.spec.ts` | 14 | 0 | |
| (e2e) | `e2e/game-core.spec.ts` | 4 | 0 | |
| (e2e) | `e2e/game-journey.spec.ts` | 2 | 0 | |
| (e2e) | `e2e/game-save.spec.ts` | 3 | 0 | |
| (e2e) | `e2e/game-shell.spec.ts` | 5 | 0 | |
| (e2e) | `e2e/game-sim.spec.ts` | 8 | 0 | two tests call `test.skip(isMobile, …)` inside (:183, :259) |

Game tests outside the scope's directories, seen in the census and not counted:
`src/routes/page.game.svelte.spec.ts`, `src/routes/sim/game.svelte.spec.ts`,
`src/lib/timeline/TimelineMode.game.svelte.spec.ts`, `src/lib/timeline/game-copy.spec.ts`,
`src/lib/shell/test/seeded-game.svelte.spec.ts`.

---

## Where a doc and the code disagree

1. **`copy.ts` and "every word".** Doc: "`copy.ts` holds every word the game shows" (`docs/dev/game.md:272`). Code: the strings listed at the end of (g) are in `saves.ts`, `store.svelte.ts`, `WinCard.svelte`, `LevelPanel.svelte`, `AccountOffer.svelte`, `src/lib/timeline/game-copy.ts` and `src/lib/shell/LevelCell.svelte`. V.
2. **`PutGame` type and the route.** Type (`save-api.ts:32-38`): no 500; 403, 413, 415 and 429 carry no body. Code: 500 `{ error: minted.message }` (`[id]/+server.ts:58`); 415 and 403 carry `{ error }` (`same-origin-json.ts:13,25`). `docs/dev/game-save.md:78-79,88-89` matches the code, not the type. V.
3. **`DeleteGame` type and the route.** Type (`save-api.ts:41`): 204 or 401. Code: also 415, 403 (`[id]/+server.ts:88-89`) and 429 (`:92-100`). `docs/dev/game-save.md:101-104` matches the code. V.

No other disagreement was found between `docs/dev/game.md` / `docs/dev/game-save.md` and the code
on the points checked: the storage layout table (`game.md:66-72`), construction steps 1 to 8
(`game.md:87-104` against `store.svelte.ts:297-401`), the changes table (`game.md:119-133`), the
offer table (`game.md:194-201`), the table's columns (`game-save.md:18-27`), the route steps
(`game-save.md:62-105`), the sync's answers table (`game-save.md:181-191`), the state order
(`game-save.md:266-273` against `save-sync.svelte.ts:169-176`). The pull steps
(`game-save.md:237-254`) were read against `save-sync.svelte.ts:390-472` once, not line by line: I.

---

## Appendix

### Files read in full

- `src/lib/game/`: `allowed.ts`, `copy.ts`, `e2e.ts`, `levels.ts`, `navigate.ts`, `progress.ts`, `save-api.ts`, `save-sync.svelte.ts`, `saves.ts`, `standing.ts`, `store.svelte.ts`, `AccountOffer.svelte`, `LevelPanel.svelte`, `WinCard.svelte`, `test/fake-sync.svelte.ts`, `test/StoreHost.svelte`
- `src/lib/server/game/store.ts`
- `src/lib/server/db/schema/gameSave.ts`
- `src/routes/api/game/+server.ts`, `src/routes/api/game/[id]/+server.ts`
- `migrations/d1/20261123043045_cloudy_devos.sql`, `migrations/d1/20261123043045_cloudy_devos/migration.sql`
- `docs/dev/game.md`, `docs/dev/game-save.md`
- `docs/superpowers/specs/2026-11-24-incremental-feel-design.html` (as extracted text; styles and scripts stripped)
- `e2e/helpers/game.ts`
- Outside the scope, to follow a call: `src/routes/+layout.svelte`, `src/lib/shell/test/seeded-game.ts`, `src/lib/timeline/test/game.ts`, `src/lib/server/security/rate-limit.ts`, `src/lib/server/security/same-origin-json.ts`, `src/lib/server/onboarding/pseudonymous-mint.ts`, `src/lib/server/onboarding/known-device.ts`

### Files read in part

- `src/routes/+page.svelte` (lines 60-284)
- `src/lib/timeline/TimelineMode.svelte` (lines 735-784, and grep hits at 168-175, 411, 663, 679-681, 719-727, 1532, 1757-1760)
- `src/lib/shell/LevelCell.svelte` (lines 40-56, grep hits at 9-12, 29, 31)
- `src/lib/sim-page/SimRoute.svelte` (lines 50-60, 98-108); `src/lib/sim-page/SimPage.svelte` (grep hits only)
- `src/lib/timeline/outcome.ts` (lines 1-40); `src/lib/timeline/game-copy.ts` (export lines only)
- `src/lib/timelapse/time.ts` (lines 1-9); `src/lib/ids/base58.ts` (lines 15-26)
- `src/lib/server/auth/session-gate.ts` (lines 20-45); `wrangler.jsonc` (lines 14-45, 78-95)
- `migrations/d1/20261123043045_cloudy_devos/snapshot.json` (grep for `game_save` only)
- `playwright.config.ts` (grep for `VITE_E2E`)
- Every spec file listed in (h): grep for test declarations, imports and loops only
- `e2e/game-*.spec.ts`: grep for test titles, imports, helper calls, `localStorage` and `/api/game`
- `e2e/helpers/{a11y,account,auth,chrome,header-text,pointer,run,sharing}.ts`: one grep for game terms

### Directories listed

`src/lib/game`, `src/lib/game/test`, `src/lib/server/game`, `src/lib/server/db`,
`src/lib/server/db/schema`, `src/routes/api/game`, `src/routes/api/game/[id]`, `migrations`,
`migrations/d1`, `migrations/d1/20261123043045_cloudy_devos`, `e2e`, `e2e/helpers`, the worktree
root.

### Not examined (in scope)

- The bodies of all spec files in scope: the 13 specs in `src/lib/game`, `src/lib/server/game/store.spec.ts`, `src/routes/api/game/server.spec.ts`, `src/routes/api/game/[id]/server.spec.ts`. What each test asserts is not reported; only declaration counts.
- The bodies of the six `e2e/game-*.spec.ts` files beyond the grep lines above.
- The six earlier migrations under `migrations/d1` (`grep -rl game_save` matched none of them) and the `.flattened` file and `snapshot.json` body of the `cloudy_devos` migration.
- No test, build, lint or type check was run; nothing here says the suites pass.

### Not examined (adjacent, outside the scope)

- The consumers of the game layer beyond the lines cited: `SimPage.svelte`, `TimelineMode.svelte`, `Timeline.svelte`, `Inspector.svelte`, `AddMenu.svelte`, `add.ts`, `activity-view.ts`, `funding-presets.ts`, `SiteHeader.svelte`, `LevelCell.svelte`, `SharedBanner.svelte`, `/s/[id]` and `/p/[id]` pages, `src/lib/about/copy.ts`. How each uses what it imports is not reported.
- `getStorage` (`$lib/sharing/storage`), `currentUser` (`$lib/account/current-user.svelte`), `/api/account/profile`, `better-auth.ts` (only line 108 seen through grep), `deletion.ts` (only line 166 seen through grep), `src/lib/server/db/columns.ts`.
- The plan and policy record formats (`sfhousing:plan:v1`, `sfhousing:sim:v2`): the game layer treats them as opaque text and so did this survey.
- `docs/dev/auth.md`, `docs/dev/sim-page.md`, `docs/dev/timeline-ui.md` and every other doc.
- The hosted code graph was not queried; the census is by a parsing script and grep over `src`, `e2e`, `scripts`, `pipeline`. Root config files were grepped for `lib/game`, `api/game`, `game-`, `helpers/game` with no hit; `.github` likewise.
