# Survey: the Paint opening as it exists today

Worktree: `/Users/mindlace/Projects/sfhousing/.claude/worktrees/incremental-feel`, HEAD `7bb0efbc` (`docs: bought levers can be switched off; design approved`). Read-only extraction; no design proposals.

Markers: **V** = verified at a file:line I read. **I** = inferred (follows from code read, or from a doc, or from a grep with no direct line). Paths are relative to the worktree root. `P` below abbreviates `src/routes/+page.svelte`; `BE` abbreviates `src/lib/brush/BrushEditor.svelte`; `BC` abbreviates `src/lib/brush/BrushController.svelte.ts`.

Context read first: `docs/superpowers/specs/2026-11-24-incremental-feel-design.html` (skimmed as text). Its statements about Paint: one page, a new game opens with the brush and the 82,069 room goal, meeting it starts the first run, the brush does not come back, "what was painted never enters the simulation" (testimony, P5/P11).

---

## (a) How the Paint page is composed

### Load (`src/routes/+page.ts`)

- V: `load` takes `datasetVersion` from the parent layout and returns `{ plan, manifest, fellBack, manifestError }`; the plan is always `emptyPlan(datasetVersion)` because the autosaved plan is restored client-side in `onMount` (`src/routes/+page.ts:8-25`, comment at 12-13).
- V: an invalid dataset version is `error(500, 'Invalid dataset version')` (`+page.ts:15-17`); a manifest failure returns `manifest: null, manifestError: true` without throwing (`+page.ts:21-24`).
- V: `fellBack` is returned but nothing under `src/routes` or `src/lib/brush` reads it (grep: only `+page.ts:19-23`, `p/[id]/+page.ts:8-16`, `sim/+page.ts:11`).

### Components mounted by `+page.svelte`

| Component | Where | How |
| --- | --- | --- |
| `BrushEditor` (`$lib/brush/BrushEditor.svelte`) | P:305-323 | the page body, inside `<div id="map-region" class="relative h-full">` |
| `TimelineHeaderScore` (`$lib/timeline/`) | P:243-255 | snippet `scoreBar`, the header's **pinned** item |
| `PaintDetails` (`$lib/paint/`) | P:257-259 | snippet `results`, handed to BrushEditor as the dock's Results/Details face |
| `NoticeStack` (`$lib/sharing/`) | P:261-262 | snippet `noticeStack`, handed to BrushEditor as `notices` |
| `WinCard` (`$lib/game/`) | P:263-273 | inside the same `noticeStack` snippet, after NoticeStack, only while `cardOpen` |
| `LayerSwitches` (`$lib/view/`) | P:276-278 | snippet `layerSwitches`, handed as `layers` only when `mapManifest?.transit` (P:317) |
| `PublishButton` (`$lib/sharing/`) | P:280-290 | snippet `headerActions`, the header's **actions**, only once `editor` exists |
| `SaveIndicator` (`$lib/sharing/`) | P:292-294 | snippet `saveState`, the header's **status** cell |

- V: also `<svelte:head><title>SF Housing Simulator</title>` (P:296), an sr-only `<h1>SF Housing Simulator</h1>` (P:303), and `<svelte:window>` pointerdown/pointerup/pointercancel handlers (P:297-301).

### What BrushEditor itself mounts (it is the map editor of `/` and the read-only view of `/p/:id`, BE:1-20)

- V: `NoticePills` holding the brush status `Message` (with a Retry button when `brush.phase === 'failed'`) and then the page's `notices` snippet (BE:583-598).
- V: `SimMap` when there is a manifest, else an empty frame div `data-testid="brush-frame"` (BE:601-612).
- V: the stroke chip, a polite status over the map's top (`data-testid="brush-announcement"`, `Message shape="chip"`) (BE:620-631).
- V: `MapKeyControl` with `PaintKey` as its key and the page's `layers` snippet (BE:550-558, 638-644).
- V: a crosshair SVG while the map canvas has keyboard focus and the brush can paint (BE:646-661; `BC:342-356`).
- V: `Dock` with one tab `{ id: 'paint', label: 'Paint' }`, panel = `PaintTab` plus `ShortcutsButton` (fine primary pointer, not read-only), `top` = `HistoryButtons` only when `pointer.touch && !editor.readOnly`, `results` = the page's snippet, `flipLabel="Paint"` (BE:537-548, 560-575, 663-682).
- V: `PaletteStrip` while `stripShown` (not read-only, below md, sheet closed, tool not Move) (BE:157-159, 683-700).
- V: `/` passes no `rows` to `PaintTab`: "`/` has no painted-areas list (that is `/sim`'s)" (BE:9, 562-570; `src/lib/paint/PaintTab.svelte:28-29`).
- V: `PaintTab`'s `intro` is `MSG.readOnly` when read-only, `MSG.start` ("Pick a height, then paint the map.") when the plan has no ops, else null (BE:568; `src/lib/brush/messages.ts:10-11`).

### State objects the page creates

- V: `autosave = new Autosave({ currentVersion: data.datasetVersion })` (P:56).
- V: `editor = $state.raw<Editor>()`, set by `onEditor` from BrushEditor's `oneditor`; the same callback registers the e2e debug hook (P:57, 61-64).
- V: `notices = $state<Notice[]>([])` (P:58).
- V: `game = useGame()` (P:59).
- V: `wide = new MediaQuery('(min-width: 768px)')`, `dockId`, `dock = new DockState({ tab: 'paint' })`, `dockFocus` (P:110-115).
- V: `view = $state<ViewPrefs>(readViewPrefs())`, `mapManifest` (P:126-127).
- V: `brushEditor` (the `bind:this` ref, used for `retryChunks()`), `latestScore = frameLatest({ score: null, complete: true })`, `chunkState`, derived `scoreStatus`, `shown`, `scoreView` (P:135-155).
- V: `goalAmount = $state(GOAL_BASE.amount)`, derived `goal`, derived `headText`, `systemTheme` (P:157-160).
- V: win state: `mounted`, `completeNet`, `held`, `offered`, derived `locked`, derived `won`, writable deriveds `kept` and `cardOpen`, `lockedBefore`, `statusBefore` (P:164-183, 227, 235).

State BrushEditor creates (so a host of BrushEditor gets these implicitly):

- V: `editor = createEditor(plan, { readOnly })` (in-memory plan plus undo/redo stacks), `brush = new BrushState()` (BE:145-146; `src/lib/brush/editor.svelte.ts:43-48`; `src/lib/brush/state.svelte.ts:40-47`).
- V: its own `DockState` only when the page passes none (BE:152).
- V: `HeightLots` (the map key's counts), `SimClient` over a spawned sim worker (`spawnSimWorker`), an overlay mux per map handle, and a `BrushController` per map (BE:453, 503, 359-382).

### How the page uses the map component

The page never touches `SimMap` directly; BrushEditor does.

- V: props the page passes to BrushEditor: `manifest`, `manifestError`, `plan`, `currentVersion`, `reloadManifest`, `oneditor`, `onscore`, `onchunks`, `view`, `onmanifest`, `layers`, `dock`, `dockId`, `dockFocus`, `results`, `notices` (P:305-323). It does not pass `readOnly`, `createWorker` or `ondockclose`.
- V: `currentVersion` is declared but unused inside BrushEditor ("nothing here consumes it yet", eslint-disable) (BE:71-73, 122).
- V: callbacks the page handles: `oneditor` (P:61-64), `onscore` → `onScore` (P:193-198), `onchunks` → `chunkState` (P:314), `onmanifest` → `mapManifest` (P:316).
- V: props BrushEditor passes to `SimMap`: `manifest`, `requestParcelSummary` (the worker's `parcelSummary`), `onRetryChunks` (the worker's `retryChunks`), `onready`, `view`; plus `bind:this` (BE:602-609).
- V: `SimMap` component method used before `onready`: `setBottomInset(px)` (BE:340-343).
- V: `SimMapHandle` methods BrushEditor uses: `applyGenerated`, `setChunkStatus`, `setPanEnabled`, `setOverlayLayers` (through `createOverlayMux`, slots `ring` and `outline`), `getMap`, `onResyncNeeded`, `collapseCredit` (BE:224-238, 351-398, 404, 483). The interface is `src/lib/map/types.ts:118-146`.
- V: worker events BrushEditor handles: `onReady` (loads `editor.plan`), `onDiff` (renders, stats, score), `onChunks`, `onError`, `onCrash` (BE:250-288).

### What the page puts in the header

- V: one call: `useHeaderActions(headerActions, { pinned: scoreBar, status: saveState })` (P:104). Signature and slot meanings: `src/lib/shell/header-actions.svelte.ts:36-56`.
- V: **actions**: `PublishButton` with `codec={PLAN_CODEC}`, `doc={editor.plan}`, `lastPublished={autosave.lastPublished}`, `onpublished={onPublished}` (P:280-290). No Undo/Redo in the header on `/` (they sit above the Paint tab on a coarse pointer and in the phone strip: BE:6-8, 669, 693-696).
- V: **pinned**: `TimelineHeaderScore` with `text={headText}`, `busy` and `quiet` = `scoreView.updating`, `stale={false}`, `expanded` = dock shows Results and is visible, `controls={dockId}`, `onclick={pressScore}`, `live={headlineSpoken(headText)}` (P:243-255). `pressScore` sets `dockFocus` and calls `dock.toggleResults(wide.current)` (P:118-121; `src/lib/dock/dock-state.svelte.ts:47-50`).
- V: **status**: `SaveIndicator status={autosave.status} align="start"` (P:292-294). It shows "Saving…" while saving, the "Autosave off" button when off, nothing visible when saved (`src/lib/sharing/SaveIndicator.svelte:62-101`).
- V: the map's layer switches are not header actions; they go through BrushEditor's `layers` into `MapKeyControl` (P:276-278, 317; BE:638-644).

---

## (b) The win

### Where `paintWon` is called and what it is

- V: `paintWon(net, amount)` is `net >= amount` (`src/lib/game/levels.ts:28-31`).
- V: its only non-test caller is `P:173`: `won = locked && completeNet !== null && paintWon(completeNet, goal.amount)` (grep over `src` and `e2e`).
- V: `locked = mounted && !game.open && simLocked(game.progress)` (P:172); `simLocked(p)` is `p.level === 1` (`src/lib/game/allowed.ts:75-78`). So the win exists only at level 1 of a real (not "open") game, after mount.
- V: at level 2 and above the same page renders with no card and no offer (follows from P:172-173; spec title "at level 2 no card shows and no offer is set", `src/routes/page.game.svelte.spec.ts:277`). The page has no redirect away from `/` at level 2+; its only navigation is P:230.

### What counts as a complete score

- V: `onScore(s, meta)` pushes every score to `latestScore`, and only when `meta.complete` sets `completeNet = s.netUnits` and calls `maybeOpen()` (P:193-198). It is judged before `frameLatest` coalesces "so no complete score is lost to a frame" (P:192).
- V: `meta.complete` is the worker diff's `complete` flag; BrushEditor forwards it for **every** diff, including preview diffs and stale previews (`onscore?.(d.score, { complete: d.complete })`, BE:255-265).
- V: in the worker host `complete(st)` is true when every chunk cell needed by the plan's ops, plus the preview op if one exists, is loaded (`src/lib/sim/host.ts:137-147`); every diff phase (`load`, `preview`, `cancel`, `commit`, `undo`, `chunk`) carries `complete: () => complete(st)` (`host.ts:195-199, 273-277, 308-312, 319-323, 380-385, 401-405`), evaluated when the batch is posted (`src/lib/sim/display.ts:126-137`).
- V: the score in a diff is the display accumulator's snapshot, and the display reflects committed plus preview envelopes (`host.ts:123-126` `envFor`; `display.ts:145-215`). So a preview diff's score includes the stroke in progress.
- **Doc vs code.** The page comment says "A score that is not complete (a stroke, the worker filling) leaves the won state as it is" (P:162-163). The code's `complete` is chunk readiness only; a preview diff over loaded cells is `complete: true` and its net (including the unfinished stroke) is written to `completeNet` (V: `host.ts:144-147, 295-313`; P:193-198). What defers the card during a stroke is the `held` flag, not `complete` (V: P:167-168, 186-190, 200-203, 297-301). The e2e scoreboard test also notes "A change before pointer-up (a preview diff)" moving the header score (`e2e/scoreboard.spec.ts:83`).
- V: a failed cell keeps the worker's `complete` false "for good" (`src/lib/scoreboard/view.ts:73-74`), so while a needed cell has failed no complete score arrives and the win cannot be seen.
- I: a restored plan already at or over the goal wins on load, once its load diffs are complete, with no stroke (follows from P:193-198 and `host.ts:260-278`; not traced in a test).

### How the card and the offer are driven

- V: `maybeOpen()` opens the card when `won && !kept && !cardOpen && !held`: sets `cardOpen = true` and calls `game.won()` (P:186-190). `game.won()` sets `firstWinAt` the first time only (`src/lib/game/store.svelte.ts:594-600`).
- V: `held` is true between window `pointerdown` and `pointerup`/`pointercancel`; `release()` clears it and calls `maybeOpen()` (P:167-168, 200-203, 297-301).
- V: `kept` and `cardOpen` are writable `$derived.by` values that reset to false whenever `won` changes (P:174-183).
- V: `keep()` ("Keep playing" or Escape): `kept = true`, `cardOpen = false`, then focus moves to `[data-testid="score-bar"]` (P:205-210).
- V: the card is `<WinCard title={roomFor(goal.amount)} unlocks={unlockText(2)} onlevelup={() => game.levelUp()} onkeep={keep} />` inside `<div data-testid="paint-win" class="pointer-events-auto">` (P:263-273). `unlockText(2)` is "The simulation" (`src/lib/game/copy.ts:14-26`). `roomFor(82069)` is "Room for 82,069 homes" (`src/lib/paint/headline.ts:14-16`).
- V: `WinCard` is a non-modal dialog with "Level up" and "Keep playing", renders nothing when `game.open`, focuses "Level up" on mount, treats Escape as keep, and mounts `AccountOffer` under the buttons (`src/lib/game/WinCard.svelte:23-64`).
- V: the offer follows `won` alone (not `kept`, `cardOpen` or `held`): while `won`, `game.setOffer({ on: null, datasetVersion: data.datasetVersion })`; when `won` ends, or on destroy, `game.setOffer(null)` (P:212-224).

### What happens on "Level up"

- V: the card's button calls `game.levelUp()` (P:269). With an offer whose `on` is null, `banked` is null and the pure `levelUp` at level 1 returns `{ ...p, level: 2 }`; the save is written and the offer cleared; a refused write keeps the offer and the level (`store.svelte.ts:605-617`; `src/lib/game/progress.ts:37-43`).
- V: navigation is an effect in the page: when `locked` goes from true to false, `goto('/sim')` (SvelteKit client navigation) (P:226-232). The comment names both callers: "the card's or the level panel's Level up" (P:226).
- I: the level panel's "Level up" reaches the same effect (it changes `game.progress`); `LevelPanel.svelte` was not read.
- V: nothing about the painted plan is passed to `/sim` at this navigation: the call is `goto('/sim')` with no state (P:230).

---

## (c) Where the painted plan is stored, and how it relates to saved games

### Keys

| Key | Holds | Source |
| --- | --- | --- |
| `sfhousing:plan:v1` | the working plan record | V: `src/lib/sharing/doc-codec.ts:56`; `src/lib/sharing/storage.ts:4` |
| `sfhousing:plan:corrupt:<ISO>` | an unreadable or future-schema record, kept aside | V: `doc-codec.ts:57`; `storage.ts:87-99` |
| `sfhousing:brush` | brush settings `{ stories, radiusM }` (defaults 6 and 30) | V: `src/lib/brush/settings.ts:8-9, 36-45` |
| `sfhousing:view` | map layer prefs | V: `src/lib/view/prefs.ts:14` (file otherwise not read) |
| `sfhousing:saves:v1`, `sfhousing:save:<id>` | saved-game index and each saved game | V: `src/lib/game/saves.ts:26-27` |
| `sfhousing:e2e:game`, `sfhousing:e2e:goal` | e2e seams | V: `src/lib/game/e2e.ts:1-2` |

- V: the record's shape is `LocalPlanRecord { v: 1; savedAt; plan: string (serializePlan output); lastPublished?: { id, hash } }` (`storage.ts:7-12`; written at `src/lib/sharing/autosave.svelte.ts:239-241`).
- V: the plan itself is `Plan { schema: 1; datasetVersion; ops: PlanOp[]; title? }`, an op being a paint or erase stroke with `radiusM`, `path` and `id` (`src/lib/plan/types.ts:7-24`). Limits: 5,000 ops, 262,144 bytes, 2,000 points per path, stories 1 to 80, radius 5 to 500 m, title 120 chars (`src/lib/plan/constants.ts:3-10`).
- V: undo and redo stacks live in memory only and are rebuilt from the plan's ops on every load (`src/lib/brush/editor.svelte.ts:37-48, 73-78`).

### Autosave

- V: restore runs in the page's `onMount`: `autosave.restore()` then `editor.load(r.plan)`; notices N1 (corrupt), N2 (future), N3 (rebased) are pushed (P:68-77). The restore cases are in `autosave.svelte.ts:74-147`.
- V: every change of `editor.plan` calls `autosave.schedule(plan)` (P:89-93). Writes are debounced 500 ms (`autosave.svelte.ts:63, 150-176`) and flushed on `visibilitychange → hidden`, on `pagehide`, and when the listeners are detached (`autosave.svelte.ts:196-209`; attached at P:78).
- V: `editor.plan` changes only on commit, undo, redo, load and `setTitle`; stroke previews never touch it (`editor.svelte.ts:60-140`; BE:84-94).
- V: when storage is unavailable or a write throws, `status` is `'off'` and editing continues (`autosave.svelte.ts:102-108, 225-248`).
- V: the Autosave uses `getStorage()` (window.localStorage) directly, independent of the game store's storage (`autosave.svelte.ts:62`; `storage.ts:15-22`). So under the "open" game (SSR, or an e2e build without the game key) the plan is still autosaved to `sfhousing:plan:v1` while the game store writes nothing (I, from `store.svelte.ts:249-252, 466`).

### Relation to saved games

- V: a `GameSave` carries `plan: string | null`, "the plan record's text as `sfhousing:plan:v1` holds it", beside `policy` and `progress` (`saves.ts:5-19`).
- V: `sfhousing:plan:v1` always holds the **current** game's working plan. The store reads it as `PLAN_RECORD` (`store.svelte.ts:28-29, 126-132`).
- V: when another game becomes current (`newGame`, `switchTo`, `remix`, `remove` of the current game, `adopt` of the current id), the store copies the two record keys into the leaving game's save and writes the target game's `plan` and `policy` into the two keys (`store.svelte.ts:495-546`).
- V: the page registers `game.beforeLeave(() => autosave.flush())` so the debounced plan is written before that copy (P:79-80; `store.svelte.ts:555-564, 623-631`).
- V: after each autosave write (`status` going `'saving'` → `'saved'`) the page calls `game.touched()`, which rewrites the current save with the records copied in and the index (P:234-240; `store.svelte.ts:479-489, 618-622`).
- V: the first game of a browser is made from whatever the two record keys already hold (`store.svelte.ts:289-295, 306-313`).
- V: no file under `src/lib/sim-page`, `src/lib/timeline` or `src/lib/sim` references `PLAN_CODEC`, `PLAN_KEY` or `'sfhousing:plan'` (grep over non-spec `src`: hits only in `sharing/`, `server/sharing/`, `game/store.svelte.ts`, `game/saves.ts`, `shell/test/seeded-game.ts`, and the `/`, `/p`, `/api/plans` routes). I: so the painted plan record is not read by the simulation today.
- Not examined: how saved games (including their `plan` text) sync to an account (`src/lib/game/save-sync.svelte.ts`, `/api/game`).

---

## (d) Publish for plans, Remix, and the read-only view

### Publish (on `/`)

- V: `PublishButton` hashes `codec.serialize(codec.publishable(doc))` with SHA-256 on every document change (`src/lib/sharing/PublishButton.svelte:32-42`).
- V: it reads "Share link" when the plan is not empty and its hash equals `lastPublished.hash`, else "Publish" (`PublishButton.svelte:44-48, 85`).
- V: while the plan is empty (`ops.length === 0`, `doc-codec.ts:66`) the button is `aria-disabled`, a press only focuses it, and the hint is "Paint something first." (`PublishButton.svelte:56-66, 73-89`; `src/lib/sharing/copy.ts:9`).
- V: a press opens `PublishDialog` in `form` mode, or in `success` mode when already published (`PublishButton.svelte:64-65, 91-100`).
- V: the dialog has a Title field (max 120), the body copy "Published plans are public and permanent…", a size line, and an oversize preflight above `MAX_PLAN_BYTES` (`src/lib/sharing/PublishDialog.svelte:226-253`; `copy.ts:10-12, 29-31`).
- V: Publish POSTs `codec.serialize(doc)` to `codec.api` (`/api/plans`) as JSON with a 15 s timeout (`src/lib/sharing/publish-client.ts:11, 50-82`; `doc-codec.ts:54`).
- V: on success the dialog hashes the sent payload, shows the link `${origin}${codec.path(id)}` = `/p/<id>` with Copy link, Share… (when `navigator.share` exists), Open and Done, and calls `onpublished({ id, hash, plan: sent })` (`PublishDialog.svelte:80-81, 132-151, 200-224`; `src/lib/sharing/api.ts:46`).
- V: failures: `too_large` blocks Publish until the plan or title changes; `rate_limited` starts a countdown (default 60 s); other codes map to copy (`PublishDialog.svelte:76-79, 152-154`; `publish-client.ts:84-111`).
- V: the page's `onPublished` merges only the title into the current plan (`applyTitle`) and calls `autosave.setLastPublished({ id, hash }, editor.plan)`, which writes the record at once (P:95-102; `src/lib/sharing/title.ts:19-22`; `autosave.svelte.ts:185-194`).
- V: the API routes are thin wrappers: `POST /api/plans` → `handlePublish(event, PLAN_CODEC)`; `GET /api/plans/:id` → `handleGetPlan(event, PLAN_CODEC)` (`src/routes/api/plans/+server.ts:1-5`; `src/routes/api/plans/[id]/+server.ts:1-5`).
- Testimony only (handlers not read): the nine ordered POST checks, dedupe by `content_hash`, the 10-per-60-s rate limit, `GET` caching (`docs/dev/plan-sharing.md:54-92`).

### The read-only view `/p/<id>`

- V: `+page.server.ts` calls `loadSharedPlan({ id, platform, current })` and sets `cache-control: private, max-age=300` on success only (`src/routes/p/[id]/+page.server.ts:4-12`).
- V: `loadSharedPlan` returns `{ id, plan, createdAt, currentDatasetVersion, datasetNotice }`; it 404s a bad id or missing row, 308-redirects a row of the other kind to its page, and 500s a body the codec cannot load (`src/lib/server/sharing/shared-page.ts:30-93`).
- V: `+page.ts` loads the manifest for the plan's own dataset version, falling back to the current one (`src/routes/p/[id]/+page.ts:6-18`).
- V: `+page.svelte` mounts `SharedBanner` and, keyed by `data.id`, `BrushEditor` with `readOnly`, `plan={data.plan}`, its own `DockState`, `results` (rendering `PaintDetails`), `view` and `layers`; it passes no `oneditor` and no `notices` (`src/routes/p/[id]/+page.svelte:163-200`).
- V: header: `useHeaderActions(null, { pinned: scoreBar })`: no actions, no status cell, the pinned `TimelineHeaderScore` fed by `paintHeadline(shown.netUnits)` (`p/[id]/+page.svelte:91, 129, 137-149`).
- V: no Autosave, no WinCard, no PublishButton, no SaveIndicator on this page (imports at `p/[id]/+page.svelte:8-31`).
- V: read-only effects inside BrushEditor: the tool is forced to Move, `PaintTab` drops the tools and shows a summary line (`paintedSummary`), no HistoryButtons, no ShortcutsButton, no PaletteStrip (BE:157-159, 175, 445-446, 560-575, 669; `src/lib/paint/summary.ts:29-33`).
- V: head tags: title "{plan title or 'Shared plan'} · SF Housing Simulator", `og:title`, `og:description` from the op count, `og:url` `https://sfhousing.mindlace.net/p/{id}` (`p/[id]/+page.svelte:38, 155-160`).
- V: error page: 404 "Plan not found" with "Start your own plan" linking `/` and `noindex`; 500 with the unparsable copy (`src/routes/p/[id]/+error.svelte:5-32`).

### Remix

- V: the banner shows Remix (primary) and "Your game" (a link to `gamePath(level)`: `/` at level 1, `/sim` above) (`src/lib/sharing/SharedBanner.svelte:64-77`; `p/[id]/+page.svelte:61`; `src/lib/game/navigate.ts:3-6`).
- V: Remix state on `/p`: absent under the open game, `'full'` at `MAX_SAVES` (12) saved games, else `'ready'` with no note; `'locked'` is never produced here (`p/[id]/+page.svelte:54-60`; `saves.ts:28`).
- V: `remix()` builds a `LocalPlanRecord` JSON holding the plan rebased to the current dataset and calls `game.remix({ kind: 'plan', record, title })` (`p/[id]/+page.svelte:63-74`).
- V: `game.remix` makes a new saved game named "Remix of {title}" with the **current game's progress cloned**, the record as its plan and the current game's policy record, and makes it current (`store.svelte.ts:651-671`; `saves.ts:112-117`).
- V: on success the page does `loadPage(remixPath('plan'))`, a full load of `/` (`p/[id]/+page.svelte:75-78`; `navigate.ts:8-16`). On a `'storage'` refusal it shows `STORAGE_TEXT` (`p/[id]/+page.svelte:79`).
- V: the dataset notices N5/N6 in the banner carry an "Open with current data" button that runs the same Remix (`SharedBanner.svelte:44-50, 86-95`).
- V: `src/lib/sharing/remix.ts` (`remixToLocal`, `localOpCount`, `localDoc`) has no importer outside its own spec (grep). `remixConfirm` has no caller outside `copy.ts`. I: these are leftovers of an earlier Remix that wrote the local record directly.

### `docs/dev/plan-sharing.md` against the code

- Agrees: key and record shape (doc 96-105 vs `storage.ts:7-12`); debounce and flush (doc 107 vs `autosave.svelte.ts:63, 196-209`); restore cases (doc 108 vs `autosave.svelte.ts:110-146`); `/p/:id` composition and Remix (doc 132-134 vs the lines above); page caching (doc 140 vs `+page.server.ts:10`).
- Differs (minor): doc line 96 lists the store copying the plan into the saved game "on a switch, a new game, a remix or a delete"; the code also does it on every autosave write through `touched()` and on `adopt`/`rekey` (`store.svelte.ts:479-489, 618-622, 718-776`).
- Stale comment (I: the schema 4 codec was not read): `doc-codec.ts:28` gives the sim storage key as `'sfhousing:sim:v1'`; the store and the doc give the policy record as `sfhousing:sim:v2` (`store.svelte.ts:30-33`; doc 204).

---

## (e) What the brush needs from the map, and the building preview

### API the brush uses

`BrushController` takes its dependencies by interface (`BC:27-44`):

- V: from the map handle: `setPanEnabled(boolean)` and `setOverlayLayers(layers)` only (`BC:28`). BrushEditor gives it the mux's `ring` slot as `setOverlayLayers` (BE:370-372).
- V: from the MapLibre map (`ControllerMap`): `getCanvas()`, `getCanvasContainer()`, `unproject([x, y])`, `getCenter()`, `getZoom()`, `getBounds()`, `on`/`off` for `'move' | 'moveend' | 'zoom'` (`BC:15-25`).
- V: from the client: `commit`, `undo`, `prefetch`, `datasetVersion`, and optionally `preview` and `cancelPreview` (`BC:30-35`).
- V: from the editor: `commit`, `undo`, `redo`, `readOnly` (`BC:36`); plus `BrushState`, the deck.gl layer constructors (`ScatterplotLayer`, `PathLayer`, loaded by `import('@deck.gl/layers')`, BE:506-513), `raf`/`cancelRaf`, and optional `dark`, `win`, `onCrosshair` (`BC:37-43`).
- V: what it does with them: capture-phase pointer listeners on the canvas container, focus/blur on the canvas, window keydown/keyup/blur, the three map events (`BC:135-158`); it sets the canvas `aria-label`, the container's `cursor` and `touch-action: none` while painting (`BC:140, 289-306`); it turns map panning off while a paint tool is active and Space is not held (`BC:289-296`); it draws the ring (a 2 px circle for Paint, a dashed circle for Erase, minimum 4 px) (`src/lib/brush/overlay.ts:63-107`); on `moveend` at zoom ≥ 14 it asks the worker to prefetch the viewport's parcel chunks (`BC:61, 672-677`).
- V: pan gating rule: the brush paints only when the city phase is `'ready'`, the plan is editable and the tool is not Move (`src/lib/brush/shortcuts.ts:36-41`).
- V: beyond the controller, BrushEditor needs from the map handle `applyGenerated`, `setChunkStatus`, `onResyncNeeded`, `getMap`, `collapseCredit`, and from the component `setBottomInset` (see (a)).

### How the preview of generated buildings works on `/`

- V: during a stroke the controller samples points through a radial filter (spacing `clamp(radius / 2, 2, 50)` m) (`src/lib/brush/sampler.ts:13-16, 24-70`) and sends `client.preview(op)` at most once per animation frame with at most one in flight; a newer path waits as `dirty` until the reply (`BC:480-501, 203-230`).
- V: on pointer-up a last preview is forced past both limits if the path changed, then the op is committed (`BC:430-450`). A path reaching 2,000 points is committed and continued (`BC:452-461`; `constants.ts:7`).
- V: the worker's `preview` computes an envelope for every eligible loaded lot the op covers, asks the chunk loader for the op's cells, and updates the display for the touched lots with phase `'preview'` (`host.ts:295-313`).
- V: the display builds each changed lot's building through `build()`, which memoises `generate(rec, env, fnv1a32(rec.id), mode)` by `parcelId|maxStories`, packs the changed cells, and posts a `diff` with `render`, `complete` and the full `score` (`host.ts:149-166`; `display.ts:145-215, 120-137`).
- V: BrushEditor applies each diff's `render` with `handle.applyGenerated` (queued until the map is ready) and forwards the score (BE:224-231, 255-265).
- V: commit after a matching preview needs no special path: "the rendered envelopes already equal the committed ones, so the commit diff is empty" (`host.ts:370-371`).
- V: on `/` the preview stays after release "because on `/` it is the plan" (BE:19). Escape, a second touch, a window blur or a tool change cancels the stroke and sends `cancelPreview` (`BC:185-189, 216-221, 505-516, 589-593, 649-651`).
- V: no stroke swath is drawn; the ring and the live buildings are the only in-stroke feedback (`BC:81-86`; `overlay.ts:65-68`).
- V: what `generate` is: `generate(parcel, env, seed, mode)` returning a `GeneratedBuilding | null`, routing sites of `DISTRICT_MIN_M2` (20,000 m²) or more to district massing (`src/lib/generator/generate.ts:205-222`; `src/lib/generator/constants.ts:74`).

### What it costs: timings found in code and docs

| Statement | Source | Kind |
| --- | --- | --- |
| Pointer-up to the commit diff applied ≤ 150 ms on fixture-0 (desktop stroke) | `e2e/perf/brush-commit.perf.spec.ts:18-20, 59` | V, budget in a perf test (not in signoff) |
| Loaded 500-parcel pointer-up reaches display ≤ 150 ms | `e2e/perf/loaded-500.perf.spec.ts:8, 47` | V, budget |
| Header score settles ≤ 150 ms after pointer-up | `e2e/scoreboard.spec.ts:51, 83-86` | V, asserted in the regular e2e spec |
| Commit diff for a ≈500-parcel stamp ≤ 100 ms (Node, real generator) | `src/lib/sim/host.bench.spec.ts:130, 168` | V, budget |
| Whole-city load: final batch ≤ 5,000 ms | `src/lib/sim/host.bench.spec.ts:171, 208` | V, budget |
| `generate`: 150k synthetic parcels ≤ 2,500 ms; 500 parcels ≤ 30 ms (median of 5) | `src/lib/generator/generator.perf.spec.ts:7, 20, 23, 35` | V, budget |
| `generate` on a 265 ha district at 8 stories ≤ 500 ms, "the plan's call for the paint brush" | `src/lib/generator/district.perf.spec.ts:8-9, 62-66` | V, budget |
| `resolveEnvelopes` 150k parcels, 40 strokes ≤ 1,000 ms; appending one ≈500-parcel op ≤ 10 ms | `src/lib/plan/resolve.bench.spec.ts:66, 76, 79, 98` | V, budget |
| Generate memo cap 160,000 entries, ≈0.8 to 1.0 KB each, worst case ≈160 MB | `src/lib/sim/host.ts:57-66` | V, comment |
| Diffs are batched at 5,000 parcels | `host.ts:48, 113`; `display.ts:172` | V |
| Chunk retries after 1 s, 4 s, 16 s; 4 concurrent fetches | `host.ts:47, 68, 112` | V |
| Measured: 500-parcel pointer-up-to-visible-frame 106 ms desktop, 111 ms at 375 px emulated, against 150 ms | `docs/dev/map-perf.md:167` | doc testimony |
| Measured: 150,000-case generation 2,208 ms | `docs/dev/map-perf.md:165` | doc testimony |
| The app's `sfh-brush-commit` measure misses about 25 ms of event queue time on an idle machine | `docs/dev/testing.md:82` | doc testimony |
| "At most one preview in flight", "no more than once per animation frame"; the 150 ms budget is met by promoting the matching preview | `docs/superpowers/specs/2026-10-10-brush-tool-design.md:177, 182` | spec testimony (grep only) |

- V: the app sets `performance.mark('sfh-brush-pointerup')` at commit and measures `sfh-brush-commit` when the commit diff is applied, in DEV or `VITE_E2E` builds only (`BC:60, 409-415`; BE:22, 240-248, 260).
- V (for the files examined): no per-preview millisecond budget exists in the code read; every timing budget is for commit, load or generation.

Other UI timings: stroke chip 4,000 ms, "too large" 6,000 ms (`messages.ts:17-18`); toast notices 8,000 ms (`src/lib/sharing/NoticeStack.svelte:19`); header live region speaks 1,000 ms after the text settles (`src/lib/timeline/TimelineHeaderScore.svelte:43-54`).

---

## (f) Import census: importers from outside the four directories

Method: grep over `src`, `e2e`, `scripts`, `pipeline` and root `*.ts` for `from '…/(paint|brush|plan|scoreboard)…'`, excluding files inside the four directories. Non-test importers are listed in full; test importers are summarised at the end. One false positive was dropped: `src/lib/server/db/schema/index.ts:1` (`./plan` is the D1 table). All rows are V (grep hit at that line).

### `src/lib/brush`

| Module | Outside importers |
| --- | --- |
| `BrushEditor.svelte` | `src/routes/+page.svelte:11`; `src/routes/p/[id]/+page.svelte:10`; test host `src/lib/sharing/test/NoticeStackHost.svelte:6` |
| `debug` | `src/routes/+page.svelte:12`; type only: `e2e/helpers/sharing.ts:13`, `e2e/bench/map-pan.bench.ts:4`, `e2e/bench/map-timeline.bench.ts:7` |
| `editor.svelte` (type `Editor`) | `src/routes/+page.svelte:13`; `src/lib/sharing/title.ts:1` |
| `BrushController.svelte` | `src/lib/sim-page/SimPage.svelte:28`; type: `src/lib/sim-page/stroke-adapter.ts:11` |
| `messages` (`ANNOUNCE_MS`) | `src/lib/sim-page/SimPage.svelte:29` |
| `overlay` (type `OverlayCtors`) | `src/lib/sim-page/SimPage.svelte:30` |
| `shortcuts` | `src/lib/sim-page/SimPage.svelte:31` (`actionForKey`, `canPaint`); `src/lib/timeline/shortcuts.ts:2` (`isEditableTarget`, `SPACE_NATIVE`); `src/lib/about/AboutUsing.svelte:9` (`SHORTCUTS`) |
| `state.svelte` (`BrushState`) | `src/lib/sim-page/SimPage.svelte:32`; type: `src/lib/sim-page/brush-tools.svelte.ts:7` |
| `sampler` (type `BrushTool`) | `src/lib/sim-page/brush-tools.svelte.ts:6` |
| `ids` (`newOpId`) | `src/lib/sim-page/stroke-adapter.ts:12`; `src/lib/sim-page/transit-edit.ts:7` |
| `test/fake-editor-worker` | `src/routes/test/page-worker.ts:9` |
| No outside importer | `height-lots.svelte.ts`, `radius.ts`, `RadiusPopover.svelte`, `settings.ts` (used only inside `brush/` and `paint/`) |

### `src/lib/paint`

| Module | Outside importers |
| --- | --- |
| `headline` | `src/routes/+page.svelte:23`; `src/routes/p/[id]/+page.svelte:17` |
| `PaintDetails.svelte` | `src/routes/+page.svelte:24`; `src/routes/p/[id]/+page.svelte:18` |
| `details` (`ROOM_MEANS`) | `src/lib/about/copy.ts:8` |
| `HistoryButtons.svelte` | `src/lib/sim-page/SimPage.svelte:47`; test host `src/lib/shell/test/SimRowHeader.svelte:6` |
| `outline-layers` | `src/lib/sim-page/SimPage.svelte:48` |
| `PaintTab.svelte` | `src/lib/sim-page/SimPage.svelte:49` |
| `PaletteStrip.svelte` | `src/lib/sim-page/SimPage.svelte:50` |
| `pointer.svelte` | `src/lib/sim-page/SimPage.svelte:51` |
| `rows` | `src/lib/sim-page/SimPage.svelte:52`; `src/lib/sim-page/brush-summary.ts:8`; `src/lib/timeline/TimelineMode.svelte:25`; test host `src/lib/sim-page/test/TransitLayerRowHost.svelte:7` |
| No outside importer | `PaintKey.svelte`, `HeightPalette.svelte`, `ShortcutsButton.svelte`, `heights.ts`, `history.ts`, `place-popover.ts`, `summary.ts`, `tools.ts` (reached only through `brush/BrushEditor.svelte` or other `paint/` files) |

### `src/lib/plan`

| Importer | Line(s) | What |
| --- | --- | --- |
| `src/routes/+page.ts` | 4 | `emptyPlan`, `Plan` |
| `src/lib/sharing/*` | `api.ts:1`, `autosave.svelte.ts:1`, `copy.ts:1`, `doc-codec.ts:1`, `publish-client.ts:1`, `PublishDialog.svelte:5`, `remix.ts:1`, `storage.ts:1`, `title.ts:2`, `test/NoticeStackHost.svelte:7` | types, codec functions, limits |
| `src/lib/server/sharing/*` | `publish.ts:3`, `respond.ts:3`, `shared-page.ts:4` | `MAX_PLAN_BYTES`, `PlanError`, `Plan` |
| `src/lib/sim/*` | `client.ts:5`, `host.ts:23`, `protocol.ts:6`, `display.ts:8`, `scenario-client.ts:6`, `timeline-client.ts:6`, `test/harness.ts:10`, `levers/brushes.ts:11`, `scenario/scenario-host.ts:91`, `world/runner/lookups.ts:35`, `fixtures/build-fixture-1.ts:8` | types; `geometry` (`project`, `segDist2`, `segmentBoxes`, metre constants); resolution |
| `src/lib/sim-page/*` | `policy.ts:23`, `sim-doc.ts:21`, `stroke-adapter.ts:13`, `stroke-preview.ts:11`, `lid-request.ts:9`, `transit-edit.ts:8` | `PlanOp`, limits, geometry constants |
| `src/lib/timeline/*` | `server-codec.ts:8`, `sim-doc4.ts:21` | error types, limits |
| `src/lib/map/*` | `camera.ts:1`, `types.ts:5`, `dash.ts:5`, `height/city.ts:13`, `height/labels.ts:1`, `height/lids.ts:15`, `height/limits-layer.ts:21`, `height/raster.ts:1`, `height/test/fixtures.ts:6`, `test/synthetic-limits.ts:6` | `BBox`, `geometry` constants and `project` |
| `src/lib/generator/*` | `cache.ts:2`, `district.ts:2`, `generate.ts:2` | type `Envelope` |
| `src/lib/data/scenario-codec.ts` | 10 | type `Envelope` |
| `src/lib/transit/grid.ts` | 12 | geometry |
| `pipeline/steps/transit.ts` | 6 | `project`, `segDist2` |

### `src/lib/scoreboard`

| Module | Outside importers |
| --- | --- |
| `format` (`formatCount`, `formatPercent`, `formatCompactCount`) | `src/lib/about/copy.ts:9`; `src/lib/fzp/card.ts:7`, `market-view.ts:2`, `money-view.ts:19`, `MoneyResults.svelte:9`, `ProjectTooltip.svelte:9`, `provenance.ts:7`, `score-view.ts:6`; `src/lib/goal/goal.ts:8`, `GoalRow.svelte:7`; `src/lib/sim-page/funding-copy.ts:4`, `funding-view.ts:37`, `policy.ts:12`; `src/lib/timeline/activity-view.ts:10`, `chart-model.ts:4`, `copy.ts:9`, `game-copy.ts:4`, `money-copy.ts:4`, `outcome.ts:5`, `results.ts:9`, `SimActivity.svelte:13`, `SimDetails.svelte:15`, `SimKey.svelte:21` |
| `targets` (`M1_TARGETS`, `RHNA_TIER_TARGETS`) | `src/lib/about/copy.ts:12`; `src/lib/fzp/provenance.ts:25`, `fixtures/timeline-score.ts:30`; `src/lib/goal/goal.ts:9`; `src/lib/sim/host.ts:24`, `scenario/score.ts:5`, `scenario/finance-score.ts:13`, `test/harness.ts:11`; `src/routes/+page.svelte:2`; `src/routes/p/[id]/+page.svelte:2`; `src/routes/test/page-worker.ts:7`; test host `src/lib/shell/test/HeaderScoreHeader.svelte:7` |
| types (`Score`, `Target`, `TargetProgress`) | `src/lib/fzp/types.ts:1`; `src/lib/sim/protocol.ts:7`, `display.ts:9`, `host.ts:24`, `scenario/score.ts:4`, `scenario/types.ts:10` |
| `accumulator` (`createScoreAccumulator`, `score`) | `src/lib/sim/display.ts:9`; `src/lib/sim/test/harness.ts:11`; `src/routes/+page.svelte:2`; `src/routes/p/[id]/+page.svelte:2`; `src/routes/test/page-worker.ts:5` |
| `view` and `latest` (`viewState`, `ScoreStatus`, `frameLatest`) | `src/routes/+page.svelte:25`; `src/routes/p/[id]/+page.svelte:19`; `src/lib/goal/GoalRow.svelte:8` (`fillPercent`, `remainderText`, `tickPercent`) |
| `score-fixtures` | `src/routes/test/page-worker.ts:6` |
| `HeaderScore.svelte` | only the test host `src/lib/shell/test/HeaderScoreHeader.svelte:6` |
| `ScoreboardPanel.svelte`, `TargetRow.svelte` | no importer outside `scoreboard/` (`TargetRow` only from `ScoreboardPanel.svelte:9`) |
| `NeighborhoodList.svelte` | no importer outside the four dirs; inside them, `src/lib/paint/PaintDetails.svelte:13` |

### Reading the census

- V: used only by `/` and `/p/:id` (Paint-only): `brush/BrushEditor.svelte`, `brush/debug`, `brush/editor.svelte` (also a type in `sharing/title.ts`), `paint/headline`, `paint/PaintDetails.svelte`, `scoreboard` `viewState`/`frameLatest`/`score` as the pages use them; and, through BrushEditor only, `brush/height-lots`, `paint/PaintKey`, `paint/ShortcutsButton`, `paint/summary`.
- V: shared with `/sim` (imported by `sim-page/SimPage.svelte` or its helpers): `brush/BrushController`, `brush/state` (`BrushState`), `brush/shortcuts`, `brush/messages`, `brush/overlay`, `brush/ids`, `brush/sampler` (type); `paint/PaintTab`, `paint/PaletteStrip`, `paint/HistoryButtons`, `paint/outline-layers`, `paint/pointer`, `paint/rows`.
- V: on `/sim` the controller runs over a different client: a committed stroke becomes a policy-store change, and `preview` goes to `StrokePreview` when present (`src/lib/sim-page/stroke-adapter.ts:1-9`; `src/lib/sim-page/stroke-preview.ts:1-8`; `BC:30-35`).
- V: shared infrastructure, not Paint-specific: all of `plan/` (types, limits, geometry, resolution, schema) and `scoreboard/format`, `scoreboard/targets`, `scoreboard` types and accumulator.
- **Doc vs code (stale header comments).** `scoreboard/ScoreboardPanel.svelte:1-5` says it is "the dock's Results face on `/` and on shared plans"; `scoreboard/HeaderScore.svelte:1-13` says it is "the header score of `/`, `/p/:id`, `/sim` and `/s/<id>`". Neither is mounted by any page today: the pages mount `PaintDetails` and `TimelineHeaderScore` (P:24, 37; `p/[id]/+page.svelte:18, 27`), and the only importer of `HeaderScore` is a test host (grep).

### Test importers (summary, V by grep)

Spec files outside the four directories that import from them: `e2e/about.spec.ts:2`, `e2e/brush.spec.ts:6-8`, `e2e/chrome-dark.spec.ts:6`, `e2e/fzp.spec.ts:13`, `e2e/layout.spec.ts:9`, `e2e/map.spec.ts:6`; the page specs under `src/routes/` (`page.*.spec.ts`, `p/[id]/page.*.spec.ts`, `api/plans/**/server.spec.ts`, `s/[id]/page.view.svelte.spec.ts:18`); and specs under `src/lib/about`, `fzp`, `goal`, `map`, `server/sharing`, `sharing`, `sim`, `sim-page`, `timeline`, `transit`. The full list is the second grep of this survey; lines were not individually re-read.

---

## (g) The goal on Paint

### Where 82,069 comes from

- V: the literal is `units: 82069` on the `rhna` target ("RHNA 2023–2031", source "SF Planning, RHNA Primer") in `M1_TARGETS` (`src/lib/scoreboard/targets.ts:3-12`).
- V: `RHNA_UNITS = M1_TARGETS.find((t) => t.id === 'rhna')!.units` (`src/lib/goal/goal.ts:48`), and `GOAL_BASE.amount = RHNA_UNITS` with `name: 'Goal'`, measure `homesCompleted` (unit "homes"), `countsFrom` 30 Jun 2022 (`goal.ts:53-60`).
- V: the page starts with `goalAmount = GOAL_BASE.amount` and on mount sets `goalAmount = e2eGoalAmount(getStorage()) ?? GOAL_BASE.amount`; `goal = { ...GOAL_BASE, amount: goalAmount }` (P:70, 157-158).
- V: `e2eGoalAmount` returns the whole number under `sfhousing:e2e:goal` only in a `VITE_E2E=1` build, else null (`src/lib/game/e2e.ts:15-27`).
- V: the same `goal.amount` feeds the win test (P:173) and the card title (P:267).
- V: `/p/<id>` uses the default goal with no seam: `paintHeadline(shown.netUnits)` (`p/[id]/+page.svelte:129`).
- V: `PaintDetails` also ignores the page's goal: its rows are `capacityRows(score.netUnits)` with the default `GOAL_BASE` (`src/lib/paint/PaintDetails.svelte:31`; `goal.ts:233`). So under the e2e seam the header reads the seam's amount and Details reads 82,069.
- Testimony: "`fixture-0` cannot reach the goal's 82,069 homes" (`docs/dev/developing.md:55`).

### The number N

- V: N is `Score.netUnits = grossUnits − demolishedUnits`; a building contributes its `units` to gross and, when it replaces the existing building, the lot's `existingUnits` to demolished (`src/lib/scoreboard/accumulator.ts:22-29, 36-53`).
- V: the score is computed in the sim worker (the display's accumulator over `M1_TARGETS`) and arrives with every diff (`host.ts:110, 231-238`; `display.ts:126-137`; `src/lib/sim/protocol.ts:40-48`).
- V: before the worker's first diff the page shows `EMPTY = computeScore([], M1_TARGETS)` (net 0) (P:1-5, 154).
- V: the shown score is the latest pushed score, coalesced to one commit per animation frame (`src/lib/scoreboard/latest.svelte.ts:6-35`; P:137-140, 154), and includes preview diffs (see (b)).

### "Room for N homes" and "N% of the goal"

- V: `paintHeadline(net, goal)` returns `{ main: roomFor(net), effect: null, goal: capacityGoalText(net, goal), goalName: goalAmountName(goal) }` (`src/lib/paint/headline.ts:27-35`).
- V: line 1, `roomFor(net)`: `Room for ${…} homes`, using `formatCount` below 1,000,000 and `formatCompactCount` from 1,000,000 ("Room for 1.2M homes") (`headline.ts:10-16`).
- V: `formatCount` is en-US grouping with U+2212 for negatives; `formatCompactCount` is compact notation with at most one decimal (`src/lib/scoreboard/format.ts:3-15, 38-41`).
- V: line 2, `capacityGoalText(net, goal)`: "Goal reached" when `net >= goal.amount`, else `${formatPercent(net / goal.amount)} of the goal`; null when the measure is not `homesCompleted` (`headline.ts:18-25`).
- V: `formatPercent` floors (never shows 100% before the target is met): one decimal when |p| < 10, an integer otherwise, exactly 0 → "0%" (`format.ts:17-36`).
- V: `goalName` is `Goal: 82,069 homes` (`goalAmountName`, `goal.ts:112-115`); `TimelineHeaderScore` shows it as the explanation under the box on hover or focus (`TimelineHeaderScore.svelte:96-103`).
- V: in `TimelineHeaderScore` line 1 is the button's text, line 2 is its description and is hidden below sm (`max-sm:hidden`); with `effect: null` the goal part never drops (`TimelineHeaderScore.svelte:34-41, 66-92`).
- V: screen readers get `headlineSpoken(headText)` (main and goal joined by ", ") 1,000 ms after it settles, and not while `scoreView.updating` (P:252-253; `src/lib/timeline/results.ts:190-193`; `TimelineHeaderScore.svelte:43-54`).
- V: `updating` is `pendingChunks > 0 || (!complete && failedChunks === 0)` (`src/lib/scoreboard/view.ts:70-78`).

### Details face

- V: `PaintDetails` shows, in order: "Updating…" while updating; the failed-areas line with Retry; "Paint a height on the map to add homes." when empty; two `GoalRow`s from `capacityRows` ("Goal" at 82,069 and "Goal + 15%" at `floor(82,069 × 1.15)` = 94,379); `paintCounts` ("… built · … replaced · … lots changed"); "By neighborhood"; "What room for homes means" (`ROOM_MEANS`); the old-plan note; a link to About (`PaintDetails.svelte:35-105`; `goal.ts:136-142, 179-188, 233-241`; `src/lib/paint/details.ts:7-20`).

---

## E2E specs that cover Paint (names only)

Named in the brief:

- `e2e/brush.spec.ts`: desktop: paint a drag; undo and redo by keyboard; stamps by click and Enter; failed chunk and Retry; stroke chip over a failure chip; "a published plan, then a stroke: the button reads Publish again"; restored plan undo/redo over its load; a parent loads a plan through `oneditor`; axe with the shortcuts list. Mobile: Move pans, Paint paints, second finger; stroke chip over failure; axe with the radius popover.
- `e2e/scoreboard.spec.ts`: header score nonzero within 150 ms of pointer-up; Details goal rows and neighbourhood list, erase to empty; busy while parcels load; share link with an absent dataset shows "recalculated"; blocked chunk warning and Retry; axe (desktop Details, mobile sheet); 375 px score opens Details and Paint flips back.
- `e2e/share-roundtrip.spec.ts`: publish, open in a fresh browser, same score, Remix.
- `e2e/share-states.spec.ts`: unknown id 404; rate-limited publish; empty plan Publish disabled (desktop, phone); reload restores the autosaved plan; Remix over a non-empty local plan; N6; unparsable stored plan 500.
- `e2e/share-notices.spec.ts`: N3 placement at several desktop sizes; folded dock; after Remix Paint opens the published plan; 375×812 N3.
- `e2e/share-a11y.spec.ts`: axe on `/p/:id`, the not-found page, the Publish dialog (success, rate limited).
- `e2e/targets.spec.ts`: "/: at rest, the Menu, the Paint sheet, the palette strip"; "/: the palette strip at 320 px, Undo, Redo and Done as its check" (the rest are `/sim`, `/about` and sweep self-tests).

Others that drive the Paint page (matched by grep for `gotoEditor`, `paintOnce`, `paint-win`, `seedGoalAmount`, `__sfhBrush`, `chooseTool`; titles not all read): `e2e/game-shell.spec.ts` (Paint's win and Level up onto `/sim`, `paint-win` at lines 71-76; `/p/<id>` Remix at level 1, lines 105-127), `e2e/game-journey.spec.ts` (a new visitor wins Paint, lines 65-100), `e2e/game-core.spec.ts`, `e2e/game-helpers.spec.ts`, `e2e/game-save.spec.ts`, `e2e/game-sim.spec.ts`, `e2e/map-key.spec.ts`, `e2e/map.spec.ts`, `e2e/compositions.spec.ts`, `e2e/layout.spec.ts`, `e2e/chrome-dark.spec.ts`, `e2e/headers.spec.ts`, `e2e/pages-a11y.spec.ts`, `e2e/about.spec.ts`, `e2e/fzp.spec.ts`, `e2e/transit.spec.ts`, `e2e/sim-citywide.spec.ts`, `e2e/timelapse-render.spec.ts`; perf: `e2e/perf/brush-commit.perf.spec.ts`, `e2e/perf/loaded-500.perf.spec.ts`; bench: `e2e/bench/map-pan.bench.ts`, `e2e/bench/map-timeline.bench.ts`. Helpers: `e2e/helpers/sharing.ts` (`gotoEditor`, `paintOnce`, `chooseTool`, `headerScore`, `PLAN_KEY`, `seedPlanRow`), `e2e/helpers/game.ts` (`seedGame`, `newVisitor`, `seedGoalAmount`).

Client specs of the page itself: `src/routes/page.game.svelte.spec.ts` (Paint's win: 15 `it` blocks, one of them inside a loop), `page.svelte.spec.ts`, `page.header.svelte.spec.ts`, `page.view.svelte.spec.ts`, `page.undo.svelte.spec.ts`, `page.rest-text.svelte.spec.ts`, `page.spec.ts`; `src/routes/p/[id]/page.view.svelte.spec.ts`, `page.server.spec.ts`.

---

## Doc and code disagreements found (collected)

1. P:162-163 (comment) says a stroke's score is "not complete"; `complete` is chunk readiness only, and preview diffs over loaded cells are complete (`host.ts:144-147, 308-312`). The card is held back by the pointer-held flag (P:186-190).
2. `scoreboard/ScoreboardPanel.svelte:1-5` and `scoreboard/HeaderScore.svelte:1-13` describe themselves as mounted on the pages; no page imports them (grep). `ScoreboardPanel.svelte:105-106` also hard-codes "82,069" and "94,379" in prose.
3. `docs/dev/plan-sharing.md:96` lists four store events that copy the plan into the saved game; the code also copies on each autosave write (`touched()`) and on `adopt`/`rekey`.
4. `sharing/doc-codec.ts:28` names the sim storage key as `sfhousing:sim:v1`; the store's policy record is `sfhousing:sim:v2` (`store.svelte.ts:30-33`).
5. `sharing/remix.ts` and `copy.ts` `remixConfirm` describe a Remix that overwrites the local plan after a confirm; `/p/:id`'s Remix today makes a new saved game through `game.remix` with no confirm (`p/[id]/+page.svelte:63-80`).
6. `SharedBanner` supports a `'locked'` Remix state (`SharedBanner.svelte:2-3, 52, 72`); `/p/:id` never produces it (`p/[id]/+page.svelte:54-60`).
7. BE:71-73: the `currentVersion` prop is documented as part of a contract but consumed by nothing in the component.

---

## Appendix

### Files read in full

- `src/routes/+page.svelte`, `src/routes/+page.ts`, `src/routes/+layout.svelte`, `src/routes/page.spec.ts`
- `src/routes/test/PageHost.svelte`, `PaintHeaderHost.svelte`, `page-worker.ts`
- `src/routes/p/[id]/+page.server.ts`, `+page.ts`, `+page.svelte`, `+error.svelte`, `test/PageHost.svelte`
- `src/routes/api/plans/+server.ts`, `src/routes/api/plans/[id]/+server.ts`
- `src/lib/brush/`: `BrushEditor.svelte`, `BrushController.svelte.ts`, `editor.svelte.ts`, `state.svelte.ts`, `debug.ts`, `height-lots.svelte.ts`, `ids.ts`, `messages.ts`, `overlay.ts`, `radius.ts`, `sampler.ts`, `settings.ts`, `shortcuts.ts`, `RadiusPopover.svelte`
- `src/lib/paint/`: `details.ts`, `headline.ts`, `heights.ts`, `history.ts`, `outline-layers.ts`, `place-popover.ts`, `pointer.svelte.ts`, `rows.ts`, `summary.ts`, `tools.ts`, `PaintDetails.svelte`, `HistoryButtons.svelte`, `PaintTab.svelte`, `HeightPalette.svelte`, `PaintKey.svelte`, `ShortcutsButton.svelte`, `PaletteStrip.svelte`
- `src/lib/plan/`: `index.ts`, `constants.ts`, `types.ts`, `geometry.ts`, `parcel-index.ts`, `resolve.ts`, `schema.ts`, `resolve.bench.spec.ts`
- `src/lib/scoreboard/`: `index.ts`, `types.ts`, `targets.ts`, `format.ts`, `latest.svelte.ts`, `view.ts`, `accumulator.ts`, `score-fixtures.ts`, `HeaderScore.svelte`, `ScoreboardPanel.svelte`, `TargetRow.svelte`, `NeighborhoodList.svelte`
- `src/lib/sharing/`: `autosave.svelte.ts`, `storage.ts`, `doc-codec.ts`, `api.ts`, `hash.ts`, `ids.ts`, `publish-client.ts`, `remix.ts`, `title.ts`, `copy.ts`, `PublishButton.svelte`, `PublishDialog.svelte`, `SaveIndicator.svelte`, `SharedBanner.svelte`, `NoticeStack.svelte`, `fixtures/memory-storage.ts`
- `src/lib/generator/`: `index.ts`, `types.ts`, `composition-types.ts`, `cache.ts`, `generator.perf.spec.ts`, `district.perf.spec.ts`, `units.perf.spec.ts`
- Outside the brief's scope but read to answer it: `src/lib/game/store.svelte.ts`, `levels.ts`, `e2e.ts`, `allowed.ts`, `copy.ts`, `WinCard.svelte`, `saves.ts`, `navigate.ts`, `progress.ts`, `standing.ts`; `src/lib/goal/goal.ts`; `src/lib/sim/client.ts`, `protocol.ts`; `src/lib/server/sharing/shared-page.ts`; `src/lib/shell/header-actions.svelte.ts`, `layout.ts`; `src/lib/dock/dock-state.svelte.ts`; `src/lib/timeline/TimelineHeaderScore.svelte`; `e2e/perf/brush-commit.perf.spec.ts`
- `docs/dev/plan-sharing.md`

### Files read in part

- `docs/superpowers/specs/2026-11-24-incremental-feel-design.html` (text skim, first ~260 lines of stripped text, which reached the Sources section)
- `src/lib/sim/host.ts` (lines 36-435 of 530), `src/lib/sim/display.ts` (lines 96-215), `src/lib/sim/host.bench.spec.ts` (grep of budgets)
- `src/lib/map/types.ts` (lines 118-211), `src/lib/map/SimMap.svelte` (grep of exports and props), `src/lib/map/overlay-mux.ts` (first 28 lines, the whole logic)
- `src/lib/generator/generate.ts` (185-222), `district.ts` (86-135), `units.ts` (320-345), `select.ts` (1-30); every other generator module only through a grep of its `export` lines
- `src/lib/timeline/results.ts` (174-193), `src/lib/shell/SiteHeader.svelte` (grep), `src/lib/view/prefs.ts` (grep for the key), `src/lib/sim/manifest.ts` (grep), `src/lib/sim-page/stroke-adapter.ts` (1-40), `src/lib/sim-page/stroke-preview.ts` (1-30)
- `e2e/scoreboard.spec.ts` (51-88 plus titles), `e2e/perf/loaded-500.perf.spec.ts` (1-47), `e2e/helpers/game.ts` (70-99 plus exports), `e2e/helpers/sharing.ts` (exports only); titles only of `e2e/brush.spec.ts`, `share-roundtrip`, `share-states`, `share-notices`, `share-a11y`, `targets`, and of the `src/routes` page specs; grep lines of `e2e/game-shell.spec.ts`, `game-journey.spec.ts`, `game-core.spec.ts`
- `docs/dev/game.md` (184-300 plus grep), `docs/dev/testing.md` (78-86), `docs/dev/map-perf.md` (160-170), `docs/dev/developing.md` (grep lines 55, 80), `docs/superpowers/specs/2026-10-10-brush-tool-design.md` (grep of timing lines)

### Directories listed

`src/routes`, `src/routes/p`, `src/routes/api/plans`, `src/routes/test`, `src/routes/sim`, `src/routes/s`, `src/lib`, `src/lib/paint` (+ `test`), `src/lib/brush` (+ `test`), `src/lib/plan` (+ `fixtures`, `fixtures/plans`, `fixtures/golden`), `src/lib/scoreboard`, `src/lib/generator`, `src/lib/sharing` (+ `fixtures`, `fixtures/plans`, `test`), `src/lib/game`, `src/lib/goal`, `src/lib/dock`, `src/lib/view`, `e2e` (to depth 3, fixture data excluded), repo root, `docs/superpowers/specs` (filtered listing).

### In scope and NOT examined

- **Spec files inside the scope directories** (`*.spec.ts`, `*.svelte.spec.ts` under `src/lib/paint`, `brush`, `plan`, `scoreboard`, `generator`, `sharing`, and the route specs): bodies not read, except `plan/resolve.bench.spec.ts` and the three generator perf specs. Only titles were listed for the route specs.
- **Test hosts and fixtures in scope**: `src/lib/brush/test/*` (`BrushEditorHost.svelte`, `fake-editor-worker.ts`, `sim-map-stub.ts`, `SimMapStub.svelte`), `src/lib/paint/test/*`, `src/lib/sharing/test/NoticeStackHost.svelte`, `src/lib/sharing/fixtures/plans/*`, `src/lib/plan/fixtures/*`, `src/lib/generator/fixtures/*`.
- **Generator internals** (by instruction, exports only): `assemble.ts`, `bands.ts`, `compositions.ts`, `composition-variety.ts`, `constants.ts`, `district-layout.ts`, `domain.ts`, `geo.ts`, `massing.ts`, `physical.ts`, `poly.ts`, `roof.ts`, `seed.ts`, `serialize.ts`, `site.ts`, `variety.ts`, and the bodies of `generate.ts`, `district.ts`, `units.ts`, `select.ts` beyond the lines listed above.
- **e2e spec bodies** for brush, scoreboard, share-\*, targets (names only, as the brief asked), and every other e2e spec named above.
- **Server handlers behind the plan routes**: `src/lib/server/sharing/publish.ts`, `get-plan.ts`, `store.ts`, `codecs.ts`, `respond.ts`, `e2e-seed.ts`, the rate limiter, and the D1 `plan` table schema. Their behaviour above is quoted from `docs/dev/plan-sharing.md`, not verified.
- **Components the Paint page reaches but that sit outside the scope**: `src/lib/dock/Dock.svelte`, `src/lib/map/SimMap.svelte` (body), `src/lib/map/key/MapKeyControl.svelte`, `src/lib/shell/NoticePills.svelte`, `Message.svelte`, `SiteHeader.svelte` (body), `LevelCell.svelte`, `src/lib/game/LevelPanel.svelte`, `AccountOffer.svelte`, `save-sync.svelte.ts`, `src/lib/goal/GoalRow.svelte`, `src/lib/view/LayerSwitches.svelte`, `src/lib/timeline/Explain.svelte`, `src/lib/sim/worker.ts`, the chunk loader, `src/lib/sim/display.ts` outside lines 96-215.
- **`/sim`'s use of the shared brush and paint parts** (`src/lib/sim-page/SimPage.svelte` and helpers): only the import lines and two header comments were read.
- **`/s/<id>`** (`src/routes/s/**`) and `/api/policies`: not read; whether `/s` produces the banner's `'locked'` state was not checked.
- **Earlier specs** (`docs/superpowers/specs/2026-10-10-plan-sharing-design.md`, `-scoreboard-design.md`, `2026-11-02-sim-ux-design.md`, the `2026-11-22-game-*` designs) and `docs/dev/developing.md`, `game.md`, `testing.md` beyond the cited lines.
- **Import census limits**: a single-line `from '…'` regex; a dynamic `import()` or a re-export through an unrelated barrel would not appear. `vi.mock` dynamic imports in specs were seen but not listed individually.
