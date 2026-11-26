# Survey: the /sim page, the timeline, fzp and dock as they are today

Read-only survey of the worktree at `/Users/mindlace/Projects/sfhousing/.claude/worktrees/incremental-feel`, 2026-11-24. Mechanical extraction; no design proposals.

**Marks.** `V` = verified at a file:line I read. `I` = inferred (arithmetic, a chain through a file I did not read, or a reading of intent). Docs are testimony: where a doc and the code disagree both are given (section K).

**Path legend** (all under `src/lib/` unless a full path is given):

| Short | File |
| --- | --- |
| SR | `sim-page/SimRoute.svelte` |
| SP | `sim-page/SimPage.svelte` |
| PS | `sim-page/policy-store.svelte.ts` |
| TM | `timeline/TimelineMode.svelte` |
| TL | `timeline/Timeline.svelte` |
| PH | `timeline/Playhead.svelte` |
| ph | `timeline/playhead.ts` |
| pb | `fzp/playback.ts` |
| SS | `timeline/session.svelte.ts` |
| fill | `timeline/fill.ts` |
| sync | `timeline/policy-sync.svelte.ts` |
| rev | `timeline/reveal.ts` |
| res | `timeline/results.ts` |
| out | `timeline/outcome.ts` |
| HS | `timeline/TimelineHeaderScore.svelte` |
| SA | `timeline/SimActivity.svelte` |
| SD | `timeline/SimDetails.svelte` |
| INS | `timeline/Inspector.svelte` |
| KR | `timeline/KindRow.svelte` |

## Headline findings

1. **Playback has one exported method**, `Playhead.toggle()` (PH:179). Everything else is done by writing the bound `day`, `playing` and `speed`, which `TimelineMode` owns (TM:384-386, TM:1674-1676). V
2. **There are two speeds and they are fixed rates of simulated time**: 12 and 36 model months per wall second (pb:6-9). No speed is defined as "the window in N seconds". V
3. **Nothing fires on a month crossing as such.** There is one callback per day change (`onday`, PH:126-130 → TM:1218-1224); month-grained things are `$derived` values keyed on the calendar month index, plus a view-month message to the worker gated to one per 250 ms. No `onend`, no per-project event. V
4. **Playback stops where `end >= last` is reached** (PH:146-164). `TimelineMode` derives both from the data (TM:422, TM:431-437) and has no prop to set either. V
5. **A "seen result" does not depend on playing.** It is derived from the furthest day reached, which a drag or the End key moves as playback does (rev:36-40, TM:1218-1219, TM:619-672). The code keeps no record of whether a month was played or dragged. V
6. **The game store is read in three files only**: `SimRoute` (the locked page, which game to pass), `SimPage` (`allowed`, the playable document, the brush lock, level-up reaction, touch and leave hooks) and `TimelineMode` (seen result, standing, offer, win card, bar, level-up clock reset). Below those it is plain props: `allowed`, `level`, `locked`, `isLocked`, `note`, `bar`, `barDay`. Pure game functions are imported lower down: `runs` and `lockedLane` in `Timeline.svelte`, `isGiven` in `Inspector.svelte` and `add.ts`, `ALL_ALLOWED` as a default in `AddMenu.svelte`, `add.ts` and `activity-view.ts`. V (grep of `lib/game/` imports, section G)
7. **`src/lib/dock/` is not used on `/sim` or `/s/<id>`.** Its only importers are `brush/BrushEditor.svelte`, `routes/+page.svelte` and `routes/p/[id]/+page.svelte`. V (grep of `src/`)
8. **One CSS transition exists in scope** (the kind toggle's chevron, 0.1 s, KR:229), and one JS fade (the paint preview, 1,500 ms, guarded by reduced motion). No `@keyframes`, no Svelte `transition:`/`animate:`, no Tailwind transition or animate classes. V (grep, section J)

---

## A. The component tree of `/sim`

### A.1 Routes to `SimRoute`

- `src/routes/sim/+page.svelte:14`: `<SimRoute {data} mode="edit" persist="restore" />`. V
- `src/routes/s/[id]/+page.svelte:82-103`: `SharedBanner` (Remix, "Your game"), then `<SimRoute {data} mode="view" persist="off" initialText opened upgradedFrom />`. V

### A.2 `SimRoute` (SR)

- Reads the store: `const store = useGame()` (SR:54). `game = mode === 'edit' && !store.open ? store : null` (SR:56). V
- View mode renders `simPage(null)` at once (SR:100-101). Edit mode renders nothing inside `#map-region` until mounted (SR:102), then: V
  - `game && simLocked(game.progress)` → the locked page, `data-testid="sim-locked"`: one paragraph `lockedSim(amount, GOAL_BASE.measure.unit)` and a link "Go to Paint" to `/` (SR:103-110). `simLocked` is `level === 1` (`game/allowed.ts:76-78`). `amount` is `e2eGoalAmount(storage()) ?? GOAL_BASE.amount`, read on mount (SR:59-63).
  - else `simPage(game)` (SR:112).
- `simPage` is `{#key data}<SimPage … game={g} />` (SR:77-97): `SimPage` remounts only on a new load result. V
- `afterNavigate` drops `?seed=` with `replaceState` (SR:66-74). V

### A.3 `SimPage` (SP) mounts

| What | Where | Game-state props |
| --- | --- | --- |
| `<svelte:window onkeydown={onWindowKey}>` (Ctrl+Z fallback) | SP:1249 | none |
| `TimelineMode` | SP:1251-1308 | `policy={store.policy}` (whole document), `run` (playable document), `game`, `goalAmount`, `readonly`, `spacePlays={!canPaint(brush, readonly \|\| zoningLocked)}`, `onundoto={(p) => store.undoTo(wholeOf.get(p) ?? p, …)}`, `onstarter={readonly ? undefined : addStarter}` |
| `PaletteStrip` (phone, a stroke tool chosen) | SP:1309-1318 | shown only when `!readonly && !zoningLocked && !wide.current && tools.tool !== 'move'` |
| `<p role="status">` brush announcements (also level-up words) | SP:1319 | none |

Snippets `SimPage` hands to `TimelineMode`: V

- `actions` (SP:1162-1189): "Stop painting"/"Stop erasing" (`toolOff`), `HistoryButtons` only while `pointer.touch`, `PublishButton` with `doc={publishDoc}`.
- `layers` (SP:1158-1160): `LayerSwitches`.
- `status` (SP:1191-1195): `SaveIndicator`, given `covered`; passed as `status={readonly ? undefined : saveState}` (SP:1267).
- `notices` (SP:1197-1199): `SimNotices`.
- `inspector` (SP:1215-1247): `details()` when `panel === 'details'`, `activity()` when `panel === 'activity'`, else `Inspector` with `{store, sync, calibration, catalog, drafts, selected, onselect, playheadDay, asOf, readonly, allowed, announce, onclose, paint, bind:adding}`.
- `paintPart` (SP:1201-1213): `PaintTab`, given to `Inspector` as `paint`.

### A.4 `TimelineMode` (TM) mounts

- **Header**, through `useHeaderActions(headerActions, { pinned: scoreBar, status: statusSlot })` (TM:1506): V
  - `scoreBar` → `TimelineHeaderScore` (TM:1596-1609), only `{#if session && calibration}`.
  - `statusSlot` → the page's `status` snippet in one cell and "Updating" inside `Explain` (TM:1561-1594).
  - `headerActions` → the page's `actions` unless `noScenario` (TM:1545-1549).
- `<svelte:window onkeydown onkeyup onblur>` for Space (TM:1665). V
- Root `div[data-testid=tl-mode]` (TM:1704-1965): V
  - status live region `tl-status-live` (TM:1712).
  - `NoticePills` (TM:1718-1819): the no-scenario and failed `Message`s; the page's `notices` (TM:1744); the goal notice region `tl-goal` with a `Message` (TM:1747-1751); **`WinCard`** in `tl-win` when `g && cardOn !== null` (TM:1752-1764) with `title={winTitle(cardOn)}`, `unlocks={roundComplete(g.progress) ? null : unlockText(level + 1)}`, `onlevelup={() => g.levelUp()}`, `onkeep={keep}`; the loading `Message`; session notices and alerts (TM:1771-1817).
  - `SimMap` (TM:1826-1834).
  - `MapKeyControl` with `SimKey {tally} inForce={keyMarks}` and the page's `layers` (TM:1844-1854).
  - `ProjectCardPanel` and `ProjectTooltip` (TM:1857-1875).
  - `AboutDialog` (TM:1877-1886); its `onopen` sets `playing = false` (TM:1884).
  - The bottom pane `tl-dock` (TM:1896-1963): `Timeline` (TM:1917-1940) and the detail column `aside[data-testid=tl-inspector]` (TM:1947-1961), which renders the page's `inspector({ activity, details, day })` while `inspectorOpen`, else `activity()` (TM:1956-1960).
- Snippets `TimelineMode` builds: `details` → `SimDetails` (TM:1611-1638, with `bar={bar?.on ?? null}`); `activity` → `SimActivity` (TM:1640-1663, with `{starters}`); `playheadPart` → `Playhead` (TM:1667-1683, with `barDay={bar?.on ?? null}`); `chartPart` → `ChartRow` (TM:1685-1700). V

`Timeline` receives (TM:1917-1940): `policy` (the whole document, not `run`), `readonly`, `selected`, `onselect`, `onedit`, `onadd`, `playhead`, `chart`, `goalShown`, `inForce`, `lens`, `playheadMonth`, `playheadDay`, `levels`, `reached`, `stale`, `bind:pinHeight`, `pinned`, **`allowed`**, **`level={g?.progress.level ?? null}`**. V

### A.5 Below `Timeline`

- `Timeline` (TL:258-385): the `playhead` snippet; `ChartLegend` (from md) or the words "Homes completed"; `Lane` + the `chart` snippet; one `KindRow` per kind with `locked={lockOf(kind)}` and `isLocked={lockedIn(kind)}` (TL:286-307); "The world" heading and a `FixedRow` for Market conditions (TL:310-321); below md a `role="dialog"` sheet with one `KindRow` (TL:332-384). V
- `KindRow` (KR:94-198): toggle, count, "+" (KR:113-123); in the lane the lock words, or the empty-lane button, or the miniatures (KR:125-160); when open a `FixedRow` and one `PolicyRow` per policy with `locked={pLocked}` and `note` (KR:161-197). V
- `PolicyRow` (`timeline/PolicyRow.svelte:60-97`): label, optional note, one `SpanBar` per span with `{locked}`. V
- `SpanBar` (`timeline/SpanBar.svelte:154-193`): a `div.bar.locked[data-locked]` when locked, else a `button.bar`, with `LevelFill` inside for a pool. V
- `Inspector` (INS:371-495): `AddMenu` (INS:393, `{allowed}`), or the pool draft's `FundingPoolRow` (INS:397-409), or a fixed row's text, or for a policy: the On switch, Move up, Move down, Remove policy (INS:421-444), `WhatEditor part="policy"` (INS:445-459), `WhenEditor` (INS:461-471), `WhatEditor part="span"` (INS:474-488). V
- `WhatEditor` (`timeline/WhatEditor.svelte:122-181`): `PolicySummary` when read-only; else `TransitLayerRow`, the `paint` snippet, `ProtectionsSection`, `PermittingSection`, or `FundingTab`. V
- `SimDetails` (SD:144-299): `GoalRow`s, `Explain`, `MoneyResults` twice, the year table. V

### A.6 Where each piece of game state enters

| State | Source | Carried as | Reaches |
| --- | --- | --- | --- |
| The store | `useGame()` SR:54 | `game` prop SR:93 → SP:154 → TM:326 | TM `g` = `game && !game.open ? game : null` (TM:411) |
| Level | `g.progress.level` | `level` (TM:1939 → TL:106) | `lockedLane(kind, level!)` (TL:110-111); `standing(level, …)` (TM:681); `unlockText(level + 1)` (TM:1759) |
| Allowed | `game?.allowed ?? ALL_ALLOWED` (SP:207; TM:415) | `allowed` to `Inspector` (SP:1240) and `Timeline` (TM:1938) | `AddMenu` (INS:393), `WhatEditor` read-only rule (INS:484), `KindRow.locked`/`isLocked` (TL:305-306) |
| Locks | derived | `locked: string \| null`, `isLocked(p)` on `KindRow`; `locked: boolean`, `note` on `PolicyRow`; `locked` on `SpanBar` | KR:84, 113, 126, 177-180; PolicyRow:64, 69, 86; SpanBar:78, 155, 194 |
| Bar | `barOf(g.progress)` (TM:679) | `barDay` (TM:1680), `bar` (TM:1634) | `Playhead` flag and description (PH:107-123, 314-322); `SimDetails` "To beat" line (SD:180-182) |
| Offer | set by TM | `g.setOffer(…)` (TM:774, 1532) | not a prop in this scope; the level cell reads it elsewhere (I, from docs) |
| Playable document | `playable(store.policy, allowed)` (SP:211-216) | `run` (SP:1271 → TM:325) | the session (TM:1307-1310, 1326-1338, 1386), starters (TM:600-604), `keyMarks` (TM:465), Publish (SP:241) |
| Goal amount seam | `e2eGoalAmount(storage())` (SP:219) | `goalAmount` (SP:1273) | TM `goal` (TM:406-409) |

---

## B. Playback

### B.1 Who owns the playhead

- `day`, `playing`, `speed` are `$state` in `TimelineMode` (TM:384-386) and bound into `Playhead` (`bind:day bind:playing bind:speed`, TM:1674-1676). `Playhead` declares them `$bindable` (PH:59-61). V
- `day` starts at `initialCalibration?.asOf ?? 0`; `playing` starts `false`; `speed` starts `DEFAULT_SPEED` = `'year'` (TM:384-386; pb:11). Nothing plays on mount. V
- `SimPage` keeps its own copy, `day`, written by `onday={(d) => (day = d)}` (SP:379, SP:1286) and used for adds and map selection (SP:475, 621, 964). V
- The playhead is not written to storage, the address or the document anywhere in the files read. V (no write found) / I (absence)

### B.2 The API

`Playhead` props (PH:24-52): `asOf`, `windowEnd`, `last?` (default `windowEnd`), `end`, `day` (bindable), `playing?` (bindable), `speed?` (bindable), `reached`, `playFrom?`, `goalDeadline?`, `barDay?`, `onday?`, and the test seams `raf?`, `cancelRaf?`. V

| Action | Mechanism | Where |
| --- | --- | --- |
| Start / pause | `toggle()`, the only exported function: if playing, `playing = false`; else if `playFrom !== null`, `setDay(clampDay(playFrom, asOf, end))`; else if `atLast`, `setDay(asOf)`; then `playing = true` | PH:179-187 |
| Play button | `onclick={toggle}` | PH:233 |
| Space | `TimelineMode.onWindowKey` → `playhead.toggle()` when `spacePlays` and `isPlayKey` | TM:917-924 |
| Speed | the speed button flips `speed` between `'year'` and `'threeYears'`; it does not start playback | PH:245-252 |
| Jump (pauses) | `jump(to)`: `playing = false; setDay(to)`; used by keys, pointer down/move on the ruler, and Today | PH:173-176, 189-195, 216-225, 258 |
| Pause from outside | write `playing = false` on the bound state | TM:734, 761, 1335, 1535, 1884 |
| Seek from outside | write `day`, then call `handleDay` by hand (a parent write does not call `onday`) | TM:735-736 |
| Label | `playLabel`: "Pause" while playing; "Play from {year}" when `playFrom` is set; "Replay" at `last`; else "Play" | ph:73-77; `timeline/copy.ts:28` |

There is no exported `play()`, `pause()`, `seek()` or `setSpeed()`, and no `onend`/`onstop` callback in `Props` (PH:24-52). V

### B.3 The frame loop and the wall-clock mapping

- The loop is an `$effect` that runs only while `playing` (PH:132-171). Each frame: `dt = ts - prevTs` (0 on the first frame); if `day` was moved by something else, the clock continues from there (PH:142-145). V
- `advance(t, dtMs, speed, horizon)` (pb:26-37): `next = min(t + (min(max(dt, 0), FRAME_CLAMP_MS) / 1000) * SPEED_DAYS[speed], horizon)`; `day = min(floor(next), horizon)`; `done = next >= horizon`. V
- Constants: V
  - `SPEED_DAYS = { year: 12 * MONTH_DAYS, threeYears: 36 * MONTH_DAYS }` (pb:6-9).
  - `MONTH_DAYS = 30.436875` (`src/lib/timelapse/time.ts:10`, outside scope, read by grep).
  - `DEFAULT_SPEED = 'year'` (pb:11).
  - `SPEED_NAME = { year: '1 year per second', threeYears: '3 years per second' }` (pb:14-17).
  - `FRAME_CLAMP_MS = 100` (pb:20).
  - `WINDOW_MONTHS = 480` (`src/lib/sim/timeline-client.ts:29`, outside scope, read by grep).
- Arithmetic: `year` is 365.2425 simulated days per second; `threeYears` is 1,095.7275. A full 480-model-month window is 14,609.7 days, so about 40.0 s at 1× and 13.3 s at 3×. I
  - The design spec says "up to about 38 seconds of playback (about 13 at 3×; both estimates)" (`docs/superpowers/specs/2026-11-24-incremental-feel-design.html:68`). The playhead's last day is the last calendar month row's last day (TM:422), which the timeline doc says is "up to a month short of the window's end" (`docs/dev/timeline-ui.md:28`). I did not measure the real duration.
  - At 60 frames a second a calendar month is crossed about every 5 frames at 1× and every 1.7 frames at 3×. I

### B.4 The two edges: `end` and `last`

- `end` is the computed edge: `filledEnd` (TM:431-437) = `asOf` with no view; `lastDay` when `filledThrough >= lastIndex`; else `min(filledEndDay(months, filledThrough, asOf), windowEnd)`. V
- `last` is `lastDay` (TM:422) = `filledEndDay(months, months.length - 1, asOf)`, else `windowEnd` = `monthLastDay(asOf, WINDOW_MONTHS)` (TM:401). V
- In the loop (PH:146-164): V
  - `clock >= end` and `clock >= last` → `playing = false`.
  - `clock >= end` and `clock < last` → keep requesting frames with `playing` still true (the wait at the computed edge).
  - otherwise advance toward `end`; when `r.done && end >= last` → `playing = false`.
- Drags and keys clamp to `end`, not `last`: `dayAt` uses `clampDay(…, asOf, end)` (PH:211-215); `keyTarget(e.key, day, asOf, end)` (PH:191). `aria-valuemax={last}` (PH:276). `atLast = day >= last && !playing` (PH:78). V

**Can playback stop at a month other than the window's end?**

- As wired: no prop of `TimelineMode` sets `end` or `last`; both are derived (TM:422, 431-437, 1672-1673). V
- `Playhead` itself stops wherever `end >= last` is reached. Passing a smaller `last` alone does not stop playback earlier: the loop advances to `end` and stops there (PH:155-164). A smaller `end` would stop the clock there but, with `last` beyond it, the loop would wait instead of stopping (PH:146-153). So a stop day needs both to be that day, and drags and keys would then clamp to it too. I (reading of PH:146-164, 211-215)
- An outside pause at an arbitrary month already exists: in a game the win-card effect sets `playing = false` when the standing becomes `won` (TM:750-764), which happens in the month the goal is reached (section C). V

### B.5 What happens at the end of the window

- `playing` becomes `false` (PH:148-150, 161-163). The label becomes "Replay" (ph:76). A press then moves the day to `asOf` and plays (PH:185-186). V
- No callback fires. What follows is derived state: `reveal.reached` is at `lastDay`; `reachedMonth` (TM:619-621) is the last index; the outcome effect (TM:642-672) judges the goal, treating the last month as the window's last day (TM:653-660). V

### B.6 What fires when the playhead moves

Per day change, exactly once, `setDay` calls `onday` (PH:126-130), which is `TimelineMode.handleDay` (TM:1218-1224): V

1. `reveal = moved(reveal, d)`: `reached = max(reached, day)`; an offered `playFrom` is cleared (rev:36-40).
2. `session?.playhead(d)` (SS:323-327): stores the day; `#wantMonth()` computes the **model** month `viewMonthOf(asOf, day)` and, only when it differs from the last wanted, calls `MonthGate.want(m)` (SS:664-670); then `#afterView()` recomputes stale.
3. `handle?.setTime(d)`: the map's clock.
4. If a card is open and `monthStart(d) !== cardMonth`, `refreshCard()`.
5. `onday?.(d)` → `SimPage`'s `day`.

`MonthGate` (ph:88-133): sends `client.viewMonth(m)` at most once per `minMs`, default 250 ms (ph:107); the latest wanted month goes out when the gap ends. V

Month-grained values are deriveds, not events: V

- `index` = the playhead's **calendar** month (TM:420); `atToday` (TM:479).
- `shown = session.shown(index)` (TM:423); `at` (TM:448-452); `headline` (TM:489-496); `tally` (TM:503-509); `totals` (TM:515-525). The comments state each "changes at most once per month the playhead crosses".
- `reachedMonth` (TM:619-621) drives the outcome effect (TM:642-672).

Day-grained: `latest` (Activity's list) derives from `day` (TM:546-553); the ruler's zones, thumb and flag (PH:76-80); the chart's two clip rectangles (`timeline/ChartRow.svelte:136-137`). V

Two month counts coexist: the playhead reads calendar months (`indexOfDay`, ph:18-20), while `viewMonth`, span edges and adds use model months (`viewMonthOf`, ph:32-34; `monthOfDay`, `src/lib/sim/world/months.ts:20-28`). V

### B.7 What pauses playback

`jump` (ruler press, drag, keys, Today: PH:173-176); any edit (TM:1335); the win card opening (TM:761); a level up or round completion (TM:734); About opening (TM:1884); unmount (TM:1535). V

### B.8 The wait at the computed edge

`playWaits` (TM:804-808): set true once `playing && day >= filledEnd` while `filledEnd < lastDay`; set false when `!playing || filledEnd >= lastDay`. It feeds the status cell (section D). V

---

## C. The seen result, the win, and the standing

### C.1 The outcome and the seen result

- `outcome` and `seenResult` are `$state.raw<GoalOutcome | null>` in `TimelineMode` (TM:629, 641). `GoalOutcome` is `{ kind: 'reached'; on: Day } | { kind: 'missed'; short: number }` (out:10). V
- One effect sets both (TM:642-672). It reads `shown.view`, `reachedMonth`, `goal`, `inForce`, `stale || searching`, `session.provisional`, and `lotsFailed && lots === null`. Then: V
  - returns while `stale || searching` (TM:652);
  - picks the day for the month reached: `asOf` at `TODAY` or with no view; the window's last day (`filledEndDay(view.months, view.lastIndex, asOf)`) when `m >= view.lastIndex`; else `view.months[m]` (TM:655-660);
  - returns when `awaitsView(goal, view, day, asOf)` (TM:662; out:16-30);
  - `next = goalOutcome(goal, view, day, asOf)` (TM:663); `outcome` is replaced only when its key differs (TM:664-667; `outcomeKey`, out:76-78);
  - `outcomeInForce = f` (TM:668);
  - `if (!provisional && !failed) seenResult = outcome` (TM:670).
- `goalOutcome` (out:50-64): null with no view, no goal step, or `awaitsView`; reads `readGoal(goal, view, min(monthReached, deadlineIndex))`; `reached` when `reading.reachedOn !== null`; otherwise `missed` only once `passed` (the furthest day is after `goal.deadline`, or at or past the view's last day, out:33-35), with `short = goal.amount - goal.measure.valueAt(view, deadlineIndex)`. V (`readGoal` is in `src/lib/goal/goal.ts:91`, not read in full: I for what `reachedOn` holds)
- The default goal's deadline is `windowHorizon(asOf, WINDOW_MONTHS)` (`src/lib/goal/goal.ts:63-64`, by grep). V

### C.2 It follows the furthest day reached, not playback

- `reachedMonth` derives from `reveal.reached` (TM:619-621); `reveal.reached` is moved by `handleDay` on every day change (TM:1219; rev:36-40). The effect at TM:642-672 does not read `playing`. V
- So a drag on the ruler, the End key, or Page Up reaches the same result as playing. `Reveal` holds only `reached`, `finding` and `playFrom` (rev:15-25): nothing records how a month was reached. V
- The reach is clamped to the computed edge: drags and keys stop at `end` (PH:191, 211-215). V

### C.3 The standing

- `bar = g ? barOf(g.progress) : null` (TM:679). V
- `stand = g ? standing(g.progress.level, bar, seenResult) : { kind: 'playing' }` (TM:680-682). This is the only call of `standing` in scope. V (grep)
- `standing` (`src/lib/game/standing.ts:8-14`, outside scope, read): `playing` at level 1 or with nothing seen; at level 2 the bar is ignored and `reached` wins; otherwise `beats(seen, bar)`; `won` carries `on: seen.on`; anything else is `short` with `seen` and `bar`. `beats`: "a tie never beats, and a missed result never beats" (`src/lib/game/levels.ts:19-21`, comment read by grep). V

### C.4 What the standing drives

| Effect | Where | What |
| --- | --- | --- |
| Win card | TM:750-764 | standing not `won` → `cardOn = null` (focus to the ruler if it was in the card). `won` with `s.on !== kept` and `cardOn !== s.on` → `cardOn = s.on; playing = false; g?.won()` |
| Offer | TM:768-776 | `store?.setOffer(s.kind === 'won' ? { on: s.on, datasetVersion } : null)`; on unmount `offerStore?.setOffer(null)` (TM:1532) |
| Goal notice | TM:684, 702-710 | in a game `noticeOutcome = stand.kind === 'short' ? stand.seen : null`; without a game it is `outcome`. Words: `shortOfBar`, `missedBar`, `missed` (`timeline/game-copy.ts:8-20`) in a game, `outcomeText` (out:67-73) without. A dismissed key stays away (`dismissed`, TM:674, 693, 704) |
| "Keep playing", Escape | TM:778-783 | `kept = cardOn; cardOn = null`; focus to the ruler |
| "Level up" | TM:1760 | `g.levelUp()` |

`WinCard` itself (`src/lib/game/WinCard.svelte`, outside scope, read): props `title`, `unlocks`, `onlevelup`, `onkeep`; renders only `{#if !game.open}`; focuses "Level up" (else "Keep playing") on mount; Escape calls `onkeep`. V

### C.5 What an edit does to them

An edit is a new `runDoc` object. The effect at TM:1326-1338: V

- `heldDoc = hold(session)`; `session.edited()`; `reveal = editedReveal(reveal, seen)`; `playing = false`; **`seenResult = null`**.
- With `seenResult` null the standing is `playing` (standing.ts:9), so the card closes (TM:753-757) and the offer is set to null (TM:774). `outcome` is not cleared by an edit: it is held while `stale || searching` (TM:652) and replaced when the next read differs (TM:664-667).
- A new seen result needs the numbers current, no search under way, the open not provisional, the lots not failed, and the view covering the months read (TM:652, 662, 670).
- Where the scan (section D.5) finds the first changed month at or before the furthest date, `reached` is pulled back to `max(day, months[k])` (rev:75-79), so the months after it are unseen and must be reached again. V

### C.6 What a level up does

The pre-effect at TM:725-746 watches `g.progress.level` and `roundComplete(g.progress)`. When the level rises or completion turns true: `playing = false; day = asOf; handleDay(asOf); reveal = revealOpen(asOf); seenResult = null; outcome = null; dismissed.clear(); kept = null; cardOn = null` (focus to the ruler if it was in the card). V

`SimPage`'s own level-up effect (SP:528-549): from md opens the kinds the new `allowed` adds (`openKind`, after a `tick`) and announces `levelledUp(level, complete ? null : unlockText(level))`. V

### C.7 Other game hooks in `SimPage`

- Each autosave status step `saving` → `saved` calls `game?.touched()` (SP:333-337). V
- On mount `game?.beforeLeave(leave)`; `leave` schedules the current document and flushes the autosave (SP:344-349, 1123). V

---

## D. The stale rules

### D.1 From an edit to the worker

1. An editor calls `store.apply(change, label, coalesce?)` (PS:59-74). `normalize` runs inside it: `redateMoved`, then `reconcilePolicy4` (SP:189-200, 202). V
2. `run` re-derives: `playable(store.policy, allowed)` (SP:211-216). V
3. `SimPage`'s effect hands the new `run` to `PolicySync.update(p)` (SP:309-316). V
4. `TimelineMode`'s effect sees the new `runDoc` and marks the edit at once (TM:1326-1338, section C.5). `session.edited()` sets `#dirty` and `EditState.pending`, holding the current view (SS:282-285; fill:21-23). V
5. `PolicySync` asks the worker for unknown brush queries, then arms a timer: `lots` is null while a query is unresolved or the timer is armed, and a new `lots` object appears `debounceMs` after the last change (sync:182-205, 214-226). Default `debounceMs` is **250** (sync:53). `open()` (a load) settles with no debounce (sync:95-98, 194-197). V
6. `TimelineMode`'s effect on `lots` calls `session.send(runDoc, l)` (TM:1379-1390), which posts `client.setPolicy` unless the pair equals what the worker runs (SS:302-320, 448-471). V

### D.2 What "stale" is

- `shownAt(s, current, i)` (fill:46-56): stale when an edit is in play and (`pending`, or no current view, or `current.filledThrough < i`, or `current.filledThrough < floor`). While stale the view shown is the held one. V
- `session.shown(i)` forces `stale: true` while `provisional` (SS:258-261). V
- `pending` ends when a `refill` arrives at or past the edit's rev: `#refill` → `#recomputePending` → `settled` (SS:517-547, 621-625; fill:26-28). `compiled` does not settle it (fill:8). V
- After settling, stale lasts until the fill reaches the playhead's month (`afterView`, fill:59-66; SS:648-653). V
- A rejected edit (`bad-request`): `rejected` sets `floor` to the held view's `filledThrough` (fill:41-43; SS:574-587), the store is undone to the newest kept document not rejected (`undoTo`, SS:584 → SP:1279), and the `not-applied` notice shows (`CHANGE_NOT_APPLIED`, `timeline/copy.ts:16`). V
- A failed brush query: `session.dropUnsent()` ends the unsent edit's stale state (TM:1367-1373; SS:292-296) and the "Couldn't find lots" notice offers Retry (TM:1808-1815). V

### D.3 What the person sees

- `stale = shown.stale` (TM:425). `resultsDoc = (stale ? heldDoc : null) ?? session?.accepted ?? runDoc` (TM:458); `inForce = !nothingInForce(resultsDoc)` (TM:460). So wording and numbers come from one document. V
- Status cell: `statusWanted = !session ? null : stale ? 'stale' : playWaits && !halted ? 'waiting' : null` (TM:814-816). Both show `UPDATING` = "Updating" (`timeline/copy.ts:17`); the explanation is `STALE_NOTE` "From before your latest change." or `WAITING_NOTE` "Working out the months ahead." (`timeline/copy.ts:19-21`; TM:1588). V
- `covered = !saveOff && shownStatus !== null` (TM:822): "Updating" covers the save state in one cell; with autosave off it sits in a second cell (TM:1562-1593). V
- The live region `tl-status-live` changes at most once per `statusMs`, default **1000** ms (TM:358, 826-843, 1712). V
- Dimming: the header score's box takes `data-stale` (HS:63, 109-116); the map canvas goes to opacity 0.6 (TM:1982-1984); Details and the card take muted ink and svg opacity 0.6 (TM:1987-1999); Activity's body only (SA:87-91); the chart draws everything in the seen styling (`timeline/ChartRow.svelte:146-149, 273`); pool levels (`timeline/LevelFill.svelte:77-83`); the map key gets `{stale}` (TM:1848). V
- `aria-busy={busy}` on the header button, with `busy={stale}` (HS:71; TM:1600). `SimDetails` gets `pending={stale}` (TM:1629). V

### D.4 Play is not held back

`Playhead` has no prop that disables Play (PH:24-52), and the Play button has no disabled state (PH:233-243). An edit pauses (TM:1335); a press afterwards plays on the held numbers. V

### D.5 "Play from"

- `editedReveal` starts a search: `finding = { before, next: 0 }`, keeping an earlier `before` if one is under way (rev:46-49). V
- The scan runs in an effect on `current` and `waiting` (TM:1345-1356), where `waiting = !session || session.pending || session.provisional`. It calls `scanned(reveal, now, { day, playing, asOf })`. V
- `scanned` (rev:64-89): compares months `next..limit`, `limit = min(now.filledThrough, before.filledThrough, m)` with `m` the month of `reached` (−1 at today). The first month where `monthChanged` is true ends the search with `reached = max(day, months[k])` and `playFrom = playing ? null : k`. No change through `m` ends it with nothing pulled back. Months past `before.filledThrough` count as changed once the new view has filled past them. V
- `monthChanged` (rev:144-173): every row field including `inProgress`, the current-law homes and approvals, tiers, and money. V
- `playFromDay = clampDay(months[reveal.playFrom], asOf, filledEnd)` (TM:1361-1363) is `Playhead`'s `playFrom` (TM:1678). The label reads `Play from ${year}` (`timeline/copy.ts:28`). V
- Pressed: `setDay(clampDay(playFrom, asOf, end))`, then `playing = true` (PH:184-186). V
- It goes when the playhead moves for any reason (`moved`, rev:36-40) or another edit starts a search (rev:48). V

### D.6 Debounce and timing constants in scope

| Constant | Value | Where |
| --- | --- | --- |
| `PolicySync` debounce | 250 ms | sync:53 |
| `MonthGate` gap | 250 ms | ph:107 |
| Status live region gap (`statusMs`) | 1000 ms | TM:358 |
| Header score live region delay | 1000 ms | HS:49-52 |
| `FRAME_CLAMP_MS` | 100 ms | pb:20 |
| `FEEDBACK_FADE_MS` (paint preview) | 1500 ms | `sim-page/feedback.ts:11` |
| `TOAST_MS` | 8000 ms | `sim-page/SimNotices.svelte:23` |
| `LIVE_DELAY_MS` | 100 ms | `sim-page/SimNotices.svelte:25` |
| Autosave debounce | 500 ms default; `SimPage` passes none | `src/lib/sharing/autosave.svelte.ts:63` (outside scope, grep); SP:288-294 |
| `ACTIVITY_LIMIT` | 6 | `timeline/activity.ts:26` |

How long "Updating" lasts is not a constant in the code. The spec says "2 to 4 seconds" (spec:68); the timeline doc's measurements table gives 1.83 s to first results and 3.21 s for the whole window on an open (`docs/dev/timeline-ui.md:131`). Not measured here.

---

## E. The header on `/sim`

### E.1 The component and its inputs

`TimelineHeaderScore` is rendered in the pinned slot (TM:1596-1609) with: `text={headText}`, `busy={stale}`, `{stale}`, `expanded={narrow.current ? scoreExpanded : undefined}`, `controls`, `onclick={() => onscore?.()}`, `live={headText ? headlineSpoken(headText) : ''}`, `quiet={playing}`. V

`headText = headline ? headlineText(headline, goal) : null` (TM:497); `headline = headlineAt(shown.view, { index, atToday }, { provisional, inForce }, goal)` (TM:489-496). V

### E.2 Line 1

- Markup: the button's text, `text ? text.main : CALCULATING` (HS:76). `CALCULATING` is "calculating…" (`fzp/copy.ts:2`). V
- `main = homesBy(h.homes, h.at)` (res:183) = `${formatCount(n)} homes by ${byWhen(at)}`, "today" when `at` is null (`timeline/copy.ts:85-90`). V
- `homes`: 0 at today (res:118-124); else `view.rows[i].completedNet` with `at = view.months[i]` (res:128-130). V
- Null (so "calculating…") with no view, while `provisional`, or when `view.filledThrough < i` (res:117, 127). V

### E.3 Line 2

- Markup: `[effectText, goalText]` joined by " · " (HS:39-41, 81-90); an `sr-only` copy is the button's description (HS:72, 91). V
- **Effect** (`planEffect`): `effect = opts.inForce ? view.planEffect[i].completedNetNew : null`, 0 at today with a policy in force (res:122, 131). Text: `fromPolicyText(n)` = `${n < 0 ? '' : '+'}${formatCount(n)} from your policy` (`fzp/score-view.ts:50-52`; res:184). V
  - **Hidden when** `inForce` is false, that is when `nothingInForce(resultsDoc)`: no policy that is on has a span (`timeline/policy4.ts:94-98`; TM:460). `resultsDoc` is the held document while stale (TM:458). V
  - `view.compare` is not read for this (res:99-103, comment). V
  - The doc says the figure leaves out a policy's effect on projects already in today's pipeline (`docs/dev/timeline-ui.md:35`); the field name `completedNetNew` is consistent with that, and the worker's computation is outside scope. I
- **Goal**: `goal = readGoal(goal, view, i)`, `TODAY` at today (res:123, 132); text `goalText(reading)`; the hover and focus name is `goalName(goal)` (res:185-186; `src/lib/goal/goal.ts:106, 118`, outside scope). Doc examples: "68% of the goal", "Goal reached, Mar 2029" (`docs/dev/timeline-ui.md:34`). I for the exact strings
- **Dropped at widths**: line 2 has `max-sm:hidden` (HS:82); the goal part and its separator take `lg:max-xl:hidden` while the effect shows (HS:38, 86-88). The goal's tooltip is hidden below 40 rem and when there is no goal (HS:119-131). V

### E.4 Other header behaviour

- Stale: `data-stale` turns the box's text to muted ink (HS:63, 109-116). V
- The live region speaks a new `live` text 1000 ms after it settles, never while `quiet` (playing), and never the text present at mount (HS:43-55, 105). V
- A press: `SimPage.pressScore` (SP:430-436): from md `showDetails()`; below md it toggles `panel` between `'details'` and null. V
- The status slot (section D.3) and the actions (A.3) are the header's other two parts on this page. The steps, level cell, account and About entries belong to the shell (`src/lib/shell/`, outside scope). Not examined.

---

## F. Activity and Details

### F.1 Activity (`SimActivity`)

Inputs (TM:1649-1661): `goal`, `totals`, `atToday`, `starters`, `onstarter`, `refusal`, `ondismissrefusal`, `fallbackfocus`, `ondetails`, `stale`, `events={latestItems}`. V

**At today** (SA:92-121): V

- `goalName(goal)` (SA:93).
- If `starters.length > 0`: "Try one:" and one button per starter (SA:94-109). Otherwise "Press Play to see what gets built." (SA:110-112; `timeline/activity-view.ts:111`).
- A `role="status"` region for a refused starter's words (SA:115-121).
- `starters` (TM:600-604): `onstarter && calibration && nothingInForce(runDoc) ? startersFor(calibration, runDoc, allowed) : []`. The three candidates are "Taller near transit", "SB 423 approval clock", "A housing bond", each kept only when `addChoices(kind, cal, doc, allowed)` offers it (`timeline/activity-view.ts:76-105`).

**After today, with totals** (SA:122-167): V

- "Latest": an `ol` of at most `ACTIVITY_LIMIT` = 6 items, or "No stage changes yet." Each line: a "◆" with sr-only "Under your policy" when `e.policy`, the stage word, "N homes", the place, the month (SA:123-145; `timeline/activity-view.ts:148-158`).
- Totals `dl` (SA:148-167), from `activityTotals` (`timeline/activity-view.ts:38-60`):

| Row | Value | Shown when |
| --- | --- | --- |
| Approved in new projects | `rows[i].entitledNew` | always |
| Completed | `rows[i].completedNet` | always |
| Stopped | `rows[i].exitedUnits` | always |
| Affordable | `tiers[i].veryLow + low + moderate + unrecorded` | `view.tiers` exists |
| From your policy | `planEffect[i].completedNetNew`, signed | `inForce` |
| All public money spent | `money.publicSpent[i]` | `moneyInForce(resultsDoc)` and `view.money` |
| Per added home | `moneyFigureAt(money, i).perAddedHome.all`, or "no homes added yet" | same |

- `activityTotals` returns null at today, while provisional, or when the month is not filled (`timeline/activity-view.ts:43-45`); then the body reads "calculating…" (SA:168-170). V
- `moneyInForce(doc)`: a money policy that is on with a span (`timeline/activity-view.ts:63-65`). V

**The Latest list's data source** (TM:526-595; `timeline/activity.ts`): V

- `activityIndex = new ActivityIndex()` (TM:530), fed in `applyRender` from the same `TimelineUpdate`s the map gets: `if (u.revision === 0 || u.city) { activityIndex.apply(u); cityVersion++ }` (TM:1113-1122).
- `latest = activityIndex.recent(asOf, day, ACTIVITY_LIMIT)` (TM:546-553), keeping the same array while the events are equal.
- `ActivityEvent` (`timeline/activity.ts:16-24`): `row`, `kind: 'approved' | 'started' | 'completed'`, `day`, `homes`, `lngLat`, `policy` (the row's flags are non-zero, `timeline/activity.ts:103`).
- `recent(after, through, limit)` returns the newest `limit` events with `after < day <= through`, newest first (`timeline/activity.ts:65-92`). The `CityStore` is private (`#store`, `timeline/activity.ts:37`); the class exposes only `apply`, `recent` and `sorts`.
- `CityStore` and `CITY_DAY` are in `src/lib/map/` (outside scope). What `homes` counts (net, gross, by tier) was not examined.
- Place names: `neighborhoods.geojson` fetched once per manifest when the list first has an item (TM:554-568), matched by `placeOf` and memoised by row (TM:569-581).

### F.2 Details (`SimDetails`)

Inputs (TM:1620-1636): `score`, `at`, `view`, `playhead={{ index, atToday }}`, `reachedMonth`, `asOf`, `copy`, `capacity`, `pending={stale}`, `terms`, `inForce`, `goal`, `onactivity`, `bar`, `bind:lens`. `stale` is **not** passed (K.7). V

Data: `score = scoreOfView(shownView, tierBaseline)` (TM:445; res:19-42); `at = resultsAt(shown.view, tierBaseline, index, score)`, passed through `todayAt` at today (TM:448-452; res:48-71); `scoreAt` (`fzp/score-view.ts:28-47`). V

Rows, top to bottom (SD:144-299): V

1. h2 "Details" and the Activity button (SD:145-150).
2. The Chart switch: radios Homes, By source, and From your policy only while `inForce` (SD:94-96, 157-173). A choice no longer offered returns to Homes (SD:99-101); unmounting returns to Homes (SD:103-105).
3. `builtTowardGoalText(score.baseline)` (SD:176), then one `GoalRow` per `goalRows(goal, view, playhead, reachedMonth)` (SD:125, 177-179), then "To beat: {month}" when `bar !== null` (SD:180-182).
4. "What {copy.plan} added": the comparison line, "Homes completed because of …" (`at.planCompleted`), "Homes approved because of …" (`at.planEntitled`), and the protection line when `capacity.protectedLots > 0` (SD:185-214).
5. "From today's pipeline" (`at.pipeline`) and "New projects" (`at.fresh`) (SD:216-225).
6. "Proposed homes in projects that stopped since {month}" (`at.exitedUnits`) (SD:227-230).
7. `MoneyResults part="money"` and `part="tiers"`, not at today (SD:233-251). They show "Public money" only with `score.money` and "Who the homes are for" only with `score.tiers` (`fzp/MoneyResults.svelte:75, 177`).
8. The year table inside `<details>` "Show as table" (SD:253-289), from `yearRows(view, playhead.index, inForce)` (`timeline/details.ts:28-51`): one row per calendar year whose December is filled and at or before the playhead's month, then the playhead's own month; columns `YEAR_COLUMNS`, the last only while `inForce` (`timeline/details.ts:54-60`). Empty at today (SD:130).
9. The link "How this is worked out" to `/about#…` (SD:292-298).

`copy` is `scoreCopy(…)` chosen from `!inForce` (TM:75-77, 477). V

---

## G. Where the game's `allowed` rules or level touch the timeline, "+" and the editors

`Allowed` is `{ kinds: ReadonlySet<PolicyKind>; money: 'given' | 'all' }` (`src/lib/game/allowed.ts:5-10`, outside scope, read). `ALL_ALLOWED` is every kind and `'all'`. By level: 2 no kinds; 3 permitting; 4 + zoning; 5 + money, with `money: 'given'` at every level (allowed.ts:18-24). `runs(kind, p, a)` = the kind is allowed and (not money, or `'all'`, or `isGiven(p)`) (allowed.ts:45-47). V

### G.1 Which document runs

- `allowed = game?.allowed ?? ALL_ALLOWED` (SP:207). V
- `run = playable(store.policy, allowed)`; a playable document that differs is mapped back to its whole one in `wholeOf` (SP:209-216). V
- The worker, `PolicySync` and Publish take `run` (SP:256-258, 309-316, 241, 1271); the rows, the Inspector, autosave and undo keep `store.policy` (SP:235-239, 1230, 1270). V
- A worker rejection undoes to the whole document: `store.undoTo(wholeOf.get(p) ?? p, 'Reverted a change')` (SP:1279). V

### G.2 Selection and "+" in `SimPage`

- `locked(ref, doc, a)`: not a fixed row and `!runs(ref.kind, p, a)` (SP:401-405). V
- `select` returns early for a locked ref (SP:408). V
- `startAdd` returns early when `!allowed.kinds.has(kind)` (SP:420). V
- An effect closes a selection that stops running or an open "+" whose kind locks (SP:507-520). V
- `addStarter` and the stroke store's implicit "add a painted policy" call `addPolicy` without `allowed` (SP:473-477, 618-622); starters are filtered earlier by `startersFor(…, allowed)` (TM:600-604), and strokes need the brush (G.6). V

### G.3 The timeline rows

- `lockOf(kind)`: null when the kind is allowed, else `lockedLane(kind, level!)` (TL:110-111). `lockedIn(kind)`: `(p) => !runs(kind, p, allowed)` (TL:112). Passed to both `KindRow`s (TL:305-306, 373-374). V
- `KindRow`: V
  - the empty-lane words only when `locked === null` (KR:84);
  - no "+" when `readonly` or locked (KR:113);
  - the lane shows the lock words in `tl-locked-lane`, in place of the empty-lane button and the miniatures (KR:126-127);
  - the toggle's `aria-describedby` adds the lane's id (KR:105);
  - every policy row is locked when the kind is, else when `isLocked(p)`; the note `LATER_ROUND` ("Unlocks in a later round") only for a locked policy in an unlocked kind (KR:177-180; `timeline/game-copy.ts:37`).
- `PolicyRow`: `data-locked` (PolicyRow:64), the note line (PolicyRow:69), `{locked}` to each `SpanBar` (PolicyRow:86). V
- `SpanBar`: no pool level when locked (SpanBar:78); a `div` with `data-locked`, no click, no keys (SpanBar:155-160); no drag edges (SpanBar:194). V

### G.4 The "+" menu and the editors

- `Inspector` takes `allowed` (INS:97) and passes it to `AddMenu` (INS:393). V
- `AddMenu`: `choices = addChoices(kind, calibration, doc, allowed)` (`timeline/AddMenu.svelte:25`). V
- `addChoices` (`timeline/add.ts:68-116`): returns `[]` when the kind is not allowed (add.ts:74); for money returns only the available funding presets when `allowed.money === 'given'`, leaving out "Your own pool", "City funding scale" and "Market terms" (add.ts:107-113). V
- A given measure's span editor is read-only: `readonly={readonly || (allowed.money === 'given' && isGiven(policy))}` on `WhatEditor part="span"` (INS:484), which then renders `PolicySummary` (`timeline/WhatEditor.svelte:122-125`). Its switch, order, Remove and When stay editable (INS:421-471). V
- `redateMoved` re-dates a given measure whose first start moved (`timeline/add.ts:265-276`, using `isGiven`); `dateMeasure` in `sim-page/funding-presets.ts:536` also tests `isGiven` (by grep; file not read). V / I

### G.5 Starters

`startersFor(calibration, runDoc, allowed)` (TM:600-604; `timeline/activity-view.ts:92-105`). At level 2 no kind is allowed, so none is offered. V

### G.6 The brush and Space

- `zoningLocked = !allowed.kinds.has('zoning')` (SP:217). V
- `attachController` returns before creating a `BrushController` while `readonly || zoningLocked` (SP:679); an effect attaches it when zoning unlocks (SP:700-702). V
- `spacePlays={!canPaint(brush, readonly || zoningLocked)}` (SP:1262). V
- No `PaletteStrip` while `zoningLocked` (SP:1309). V
- Ctrl+Z goes through the page's own handler while no controller is attached (SP:761-781). V

### G.7 The bar and level on the ruler and in Details

- `Playhead`: a flag at `barDay`, "To beat", or one merged flag "Goal · To beat" at the deadline when the bar is fewer than 30 calendar months before it (PH:107-115, 314-330); the description adds `toBeatDescription(barDay)` (PH:116-123). V
- `SimDetails`: `toBeatLine(bar)` (SD:180-182). V

### G.8 Without a game

`game` null or `game.open` gives `g = null` (TM:411): `allowed` is `ALL_ALLOWED` (TM:415), the standing is `playing` (TM:681), the notice is today's `outcomeText` (TM:705), no card (TM:1752), `bar` null (TM:679), `level` null (TM:1939). V

---

## H. Autosave, the read-only view, Undo and Redo

### H.1 Autosave

- `persistMode = persist ?? (mode === 'view' ? 'off' : 'restore')` (SP:159). V
- `openDoc()` (SP:262-302), in order: the route's opened document; else `initialText` through `openShared`; else, when `persistMode === 'off'`, the store's default; else a new `Autosave<SimDoc4>` with `currentVersion`, `codec: createSimCodec4(d)`, `storage`, and `writable: (x) => simDoc4Problems(x).length === 0`, then `restoreSim4(storage(), a, d)`. V
- It runs before `TimelineMode` mounts when the calibration is known in the browser (SP:306), else on `oncalibration` (SP:360-364). V
- `load(p)` is `store.reset(p)` and `sync.open(run)`: not undoable, not debounced (SP:252-259). V
- Writes: an effect tracks `doc` and calls `a.schedule(d)` once `saving` is set (SP:320-327). `doc` holds `store.policy`, the whole document, plus the title (SP:235-239). V
- The key is `SIM_KEY4 = 'sfhousing:sim:v2'` (`timeline/sim-doc4.ts:36`); the schema 3 key is `SIM_KEY = 'sfhousing:sim:v1'` (`sim-page/sim-doc.ts:42`). `restoreSim4` migrates v1 to v2 first (`timeline/session4.ts:130-167`). V
- Debounce 500 ms is `Autosave`'s default (`src/lib/sharing/autosave.svelte.ts:63`, outside scope, grep); `SimPage` passes no `debounceMs` (SP:288-294). V
- Status: `SaveIndicator status={autosave.status} {covered}` (SP:1191-1195); `saveOff={autosave?.status === 'off'}` (SP:1268). V
- Publish: `PublishButton` with `doc={publishDoc}`, `lastPublished`, `onpublished` (SP:1179-1187). `publishDoc` is `doc` with `policy: run` when the playable document differs (SP:241). `onPublished` takes the title and records `lastPublished` against the current whole document (SP:353-358). V
- The `Autosave` class, `PublishButton` and `SaveIndicator` are in `src/lib/sharing/` (outside scope). Not examined.

### H.2 The read-only view (`/s/<id>`)

- `mode="view" persist="off"` (`src/routes/s/[id]/+page.svelte:96-103`); `SimRoute` passes `game = null` (SR:56, 101). V
- `readonly = mode === 'view'` (SP:160). What it changes: V
  - no `status` snippet (SP:1267) and no autosave object (SP:284-287);
  - no Undo, Redo or Publish (SP:1168);
  - no starters: `onstarter` undefined (SP:1301);
  - `cards` always true (SP:1261);
  - no brush controller (SP:679), no palette strip (SP:1309), no Ctrl+Z handler (SP:762);
  - `Timeline` and `KindRow` with `readonly`: no "+" (KR:113), no empty-lane words (KR:84); `SpanBar` ignores keys (SpanBar:107) and has no drag edges (SpanBar:194), but stays selectable (SpanBar:174);
  - `Inspector`: the menu is null (INS:202); no On, Move or Remove (INS:421); `WhenEditor` read-only (INS:461-471); `WhatEditor` renders `PolicySummary` for the span part and nothing for the policy part (`timeline/WhatEditor.svelte:122-125`);
  - the catalog is never fetched (SP:1091-1098).
- `PolicySummary` (`sim-page/PolicySummary.svelte`): sections Transit layers, Painted areas, Protections, Permitting timelines (with a "Shares and changed stages" disclosure), then Public money (the coverage line and `summaryRows`). When `moneyOnly(policy)` it shows only Public money (PolicySummary:81, 106-157). It takes a schema 3 `SimPolicy`, the span's projection. V
- An unparsable shared text gives one alert notice (SP:279). V
- Remix, the banner and the level note are in `src/routes/s/[id]/+page.svelte:38-70` and `SharedBanner` (outside scope beyond the route file read).

### H.3 Undo and Redo

- `PolicyStore<P>` (PS:14-121): `apply(change, label, coalesce?)`, `reset(p)`, `undo()`, `redo()`, `undoTo(p, label)`, and the getters `policy`, `canUndo`, `canRedo`, `undoLabel`, `redoLabel`. V
  - `apply`: a change that returns the same object is no change; `normalize(next, prev)` runs before recording; a change with the same `coalesce` key as the latest entry, with no undo or redo between, merges into it; redo is cleared (PS:59-74).
  - `undo`/`redo` do not run `normalize` (PS:88-107).
  - `undoTo`: undoes until `policy === p` if `p` is in the past, else records one change back to `p` (PS:113-120).
  - History is in memory only: `#past` and `#future` (PS:17-19); `reset` clears both (PS:80-85).
- `SimPage.undo`/`redo` go through the controller when attached, else `adapter.editor` (SP:746-753). V
- Header buttons: `HistoryButtons` only while `pointer.touch` (SP:1169-1178). V
- Keys: `onWindowKey` handles undo and redo only while no controller is attached and not read-only, through `actionForKey` (SP:761-781). Once attached, the `BrushController`'s own listener takes them (`src/lib/brush/`, outside scope). Not examined.
- An undo or redo is an edit like any other: a new `store.policy` → new `run` → section D. V
- A funding draft is outside the store, so autosave and undo never see it (SP:382-383). V

---

## I. Keyboard shortcuts

### I.1 `timeline/shortcuts.ts`

`TIMELINE_SHORTCUTS` (shortcuts.ts:8-17), the rows About's Timeline table lists: V

| Keys | Action (as written) |
| --- | --- |
| Space | Play or pause (not while painting) |
| ← / → | A month back or on (date slider) |
| Page Down / Page Up | A year back or on (date slider) |
| Home / End | Today / the last month (date slider) |
| ← / → | Move a bar's edge nearest the playhead a month (Shift: a year; Alt: the whole bar) |

`isPlayKey(e, modalOpen)` (shortcuts.ts:24-30): key `' '`, type `keydown`, not a repeat, not `defaultPrevented`, no Alt, Ctrl, Meta or Shift, no modal open, target not editable (`isEditableTarget`) and not inside `SPACE_NATIVE`. V

### I.2 Where the keys are handled

| Key | Handler | Where |
| --- | --- | --- |
| Space | `onWindowKey`: needs `spacePlays` and a `playhead`; `preventDefault`; `playhead.toggle()`; repeats are swallowed until keyup or window blur. `overlayOpen()` tests `dialog:modal, :popover-open` | TM:902-928, 1665 |
| ArrowLeft, ArrowDown | previous month | ph:43-45 |
| ArrowRight, ArrowUp | next month, clamped to `end` | ph:46-48 |
| PageDown / PageUp | a year back / on | ph:49-52 |
| Home / End | `asOf` / `end` (the computed edge) | ph:53-56 |
| (ruler) Alt, Ctrl, Meta held | ignored | PH:190 |
| ArrowLeft / ArrowRight on a bar | nearer edge by a month; Shift 12; Alt the whole span; ignored when read-only or with Ctrl or Meta | `timeline/spans.ts:238-248`; SpanBar:106-115 |
| ArrowLeft / ArrowRight on the chart overlay | move the readout a month | `timeline/ChartRow.svelte:172-181` |
| Escape in the Inspector | close the editor, unless an explanation is open | INS:224-230 |
| Escape with a kind sheet open | close the sheet | TL:234-240 |
| Tab in a kind sheet | wraps inside it | TL:217-232 |
| Escape on the card | close it, unless a modal dialog is open | `fzp/ProjectCardPanel.svelte:121-126` |
| Escape on an explanation | close it | `timeline/Explain.svelte:80-103` |
| Ctrl+Z / Ctrl+Shift+Z | the page's fallback before the controller attaches | SP:761-781 |

`TIMELINE_SHORTCUTS` names ← / → for the slider; `keyTarget` also takes ArrowUp and ArrowDown (K.4). The brush's own keys are in `src/lib/brush/shortcuts.ts` (outside scope). Not examined.

---

## J. CSS transitions, animation and reduced motion

Method: `grep -E "transition|animation|animate|@keyframes|prefers-reduced-motion|reducedMotion|motion-safe|motion-reduce|scroll-behavior|behavior:|requestAnimationFrame|raf\("` over every `.svelte` and non-spec `.ts` file under `src/lib/sim-page`, `src/lib/timeline`, `src/lib/fzp`, `src/lib/dock` (test folders left out), plus a second grep for `svelte/motion`, `svelte/easing`, `tweened`, `Tween`, `Spring`, `transition:`, `animate:`, `in:`, `out:`. V

### J.1 What exists

| Thing | Where | Reduced-motion handling |
| --- | --- | --- |
| CSS `transition: transform 0.1s` on the kind toggle's chevron (rotates 90° when open) | KR:227-233 | none |
| The paint preview's fade: linear to 0 over `FEEDBACK_FADE_MS` = 1500 ms, by `requestAnimationFrame` re-setting a deck layer's opacity | `sim-page/feedback.ts:11, 63-72, 90-105` | `release()` clears at once when `reducedMotion()` is true (feedback.ts:65-68) |
| The reduced-motion query | SP:1026: `new MediaQuery('(prefers-reduced-motion: reduce)')`, passed as `reducedMotion: () => reducedMotion.current` (SP:1041) | this is the only one in scope |
| Playback's frame loop | PH:132-171 | none; it moves the day, the ruler's zones, thumb and flag, the chart's clips and the map's clock |
| The card following its building: one `requestAnimationFrame` per map `move` | TM:1027-1045 | none |
| `watchCardArea`: reports coalesced to one frame | `fzp/card-area-watch.ts:27-32` | none |
| The brush controller's `raf` | SP:693-694 | outside scope |
| `scrollIntoView({ block: 'start', behavior: 'instant' })` | TM:1496; TL:205 | explicitly instant |

### J.2 What does not exist in scope

- No `@keyframes`, no CSS `animation`, no Svelte `transition:`, `in:`, `out:` or `animate:` directive, no `svelte/motion`, no Tailwind `transition-*`, `animate-*`, `motion-safe` or `motion-reduce` class. V (grep; the only hits are those in J.1 and unrelated words such as `cal.transitions`)
- No `@media (prefers-reduced-motion)` block in any component in scope. V (grep)
- Comments that state it: "Nothing animates" (`timeline/LevelFill.svelte:11`); the ruler doc says nothing on it has a CSS transition (`docs/dev/timeline-ui.md:27`), and `Playhead.svelte`'s style block has none (PH:338-550). V

### J.3 Adjacent files checked by grep only

`src/routes/layout.css`, `src/lib/game/WinCard.svelte`, `src/lib/shell/Message.svelte`, `src/lib/shell/NoticePills.svelte`, `src/lib/map/key/MapKeyControl.svelte`, `src/lib/timeline/SimKey.svelte`: no match for `transition`, `animation`, `@keyframes`, `prefers-reduced-motion` or `scroll-behavior`. V (grep)

Across `src/`, the files that mention reduced motion are `sim-page/feedback.ts`, `sim-page/SimPage.svelte`, `map/SimMap.svelte`, `map/generated-controller.ts` and two map test helpers. The two map files are outside scope. Not examined.

---

## K. Where a doc and the code disagree

1. **Rest face from md.** `docs/dev/fzp-mode.md:119`: "Details shows at rest from md". `SimPage.svelte`'s header comment says the same (SP:6-8). Code: with the inspector closed the column renders `activity()` (TM:1956-1960); `docs/dev/timeline-ui.md:36` agrees with the code.
2. **`cards`.** `docs/dev/fzp-mode.md:30`: "`/sim` always passes true"; `docs/dev/sim-page.md:63`: "`cards` is always on". Code: `cards={readonly || tools.tool === 'move'}` (SP:1261), and an effect closes an open card when `cards` turns false (TM:1063-1065).
3. **"Faster".** `docs/dev/fzp-mode.md:21`, `fzp/types.ts:7` and `fzp/debug.ts:14` speak of "Play" and "Faster". Code: one button that flips between "1×" and "3×" (PH:245-252).
4. **Slider keys.** `TIMELINE_SHORTCUTS` lists "← / →" for a month (`timeline/shortcuts.ts:10`). `keyTarget` also handles ArrowDown and ArrowUp (ph:43-48), as `docs/dev/timeline-ui.md:28` says.
5. **Line references.** `docs/dev/timeline-ui.md:116-117` cites `session.svelte.ts` `:447`, `:546-552`, `:467-469`. The code is now at SS:462 (`early: !this.#sawCompile`), SS:561-566 (`#earlyRejected`, `#stop()`), SS:484 (`this.#rev += 1`).
6. **Transitions.** The design spec says "No sound, no transitions; numbers dim while updating" (`docs/superpowers/specs/2026-11-24-incremental-feel-design.html:110`) and "almost no motion" (spec:72). Code: one CSS transition (KR:229) and one JS fade (`sim-page/feedback.ts`).
7. **Details' stale line.** `docs/dev/fzp-mode.md:104-106`: "A failed edit keeps the old numbers under the existing stale line instead." `SimDetails` has the line, shown when its `stale` prop is true (SD:54, 82, 136-142). `TimelineMode` passes `pending={stale}` and no `stale` (TM:1620-1636), so the prop keeps its default `false` and the line does not render on `/sim`. The wrapper's `data-stale` dimming is what shows (TM:1617).
8. **Playback length.** Spec: "up to about 38 seconds (about 13 at 3×; both estimates)" (spec:68). From the constants a full 480-month window is 40.0 s and 13.3 s (B.3). Not measured.

Things the docs say that the code matches (spot checks): `MonthGate` "at most four a second" (ph:107); starters from `startersFor(calibration, run, allowed)` (TM:600-604); the level-up clock reset (TM:725-746); `select` and `startAdd` ignoring locked items (SP:408, 420); the offer following the standing (TM:768-776); Undo and Redo in the header only on a coarse pointer (SP:1169).

---

## Appendix

### Files read in full

In scope:

- `src/lib/sim-page/`: `SimPage.svelte`, `SimRoute.svelte`, `sim-session.ts`, `policy-store.svelte.ts`, `sim-doc.ts`, `load.ts`, `feedback.ts`, `SimNotices.svelte`, `PolicySummary.svelte`.
- `src/lib/timeline/`: `TimelineMode.svelte`, `Timeline.svelte`, `Playhead.svelte`, `playhead.ts`, `session.svelte.ts`, `session4.ts`, `fill.ts`, `chunk-log.ts`, `policy-sync.svelte.ts`, `reveal.ts`, `results.ts`, `outcome.ts`, `game-copy.ts`, `shortcuts.ts`, `copy.ts`, `TimelineHeaderScore.svelte`, `SimActivity.svelte`, `activity.ts`, `activity-view.ts`, `SimDetails.svelte`, `details.ts`, `chart-model.ts`, `ChartRow.svelte`, `LevelFill.svelte`, `Inspector.svelte`, `AddMenu.svelte`, `add.ts`, `KindRow.svelte`, `PolicyRow.svelte`, `WhatEditor.svelte`, `Explain.svelte`, `SimKey.svelte`, `key.ts`, `rows.ts`, `policy4.ts`.
- `src/lib/fzp/`: `playback.ts`, `time.ts`, `types.ts`, `copy.ts`, `load.ts`, `debug.ts`, `score-view.ts`, `card-area-watch.ts`, `MoneyResults.svelte`, `ProjectCardPanel.svelte`.
- `src/lib/dock/`: `Dock.svelte`, `dock-state.svelte.ts`, `icons.ts`.
- `docs/dev/sim-page.md`, `docs/dev/timeline-ui.md`, `docs/dev/fzp-mode.md`.
- `docs/superpowers/specs/2026-11-24-incremental-feel-design.html`.

Outside scope, read to interpret a call:

- `src/lib/game/standing.ts`, `src/lib/game/allowed.ts`, `src/lib/game/WinCard.svelte`, `src/lib/sim/world/months.ts`, `src/routes/sim/+page.svelte`, `src/routes/s/[id]/+page.svelte`.

### Files read in part

- `src/lib/timeline/SpanBar.svelte` (lines 1-200; the style block by grep only).
- `src/lib/timeline/WhenEditor.svelte` (lines 1-110).
- `src/lib/timeline/spans.ts` (lines 120-248; exports by grep).
- `src/lib/timeline/sim-doc4.ts` (lines 1-120; exports by grep).
- By grep only (single lines or export lists): `src/lib/timeline/lens.ts`, `axis.ts`, `address.ts`, `owner.ts`, `chart-lens.ts`, `pool-level.ts`, `places.ts`, `FixedRow.svelte`, `Lane.svelte`, `ChartLegend.svelte`; `src/lib/sim-page/funding-view.ts` (`moneyOnly`, lines 1056-1068), `funding-presets.ts` (line 536); `src/lib/goal/goal.ts`; `src/lib/game/levels.ts`; `src/lib/timelapse/time.ts`; `src/lib/sim/timeline-client.ts`; `src/lib/sharing/autosave.svelte.ts`; `src/routes/layout.css`; `src/lib/shell/Message.svelte`; `src/lib/shell/NoticePills.svelte`; `src/lib/map/key/MapKeyControl.svelte`.

### Directories listed

`src/lib/sim-page/` (with `test/`, `fixtures/`, `fixtures/schema2/`), `src/lib/timeline/` (with `test/`), `src/lib/fzp/` (with `test/`, `fixtures/`), `src/lib/dock/` (with `test/`), `src/routes/sim/`, `src/routes/s/[id]/`.

### In scope and NOT examined

- **Every `*.spec.ts` file** under the four directories (about 34,000 lines), including `TimelineMode.svelte.spec.ts`, `TimelineMode.game.svelte.spec.ts`, `Playhead.svelte.spec.ts`, `session.svelte.spec.ts`, `SimPage.svelte.spec.ts`. No behaviour in this report was checked against a test, and no test was run.
- **Test hosts and fixtures**: `src/lib/timeline/test/*`, `src/lib/sim-page/test/*`, `src/lib/fzp/test/*`, `src/lib/fzp/fixtures/*`, `src/lib/dock/test/*`, `src/lib/sim-page/fixtures/*`.
- **`src/lib/timeline/`, not read beyond grep**: `lens.ts` (the span lens that hosts the schema 3 editors), `reconcile4.ts`, `upgrade.ts`, `parse4.ts`, `server-codec.ts`, `pool-level.ts`, `places.ts`, `owner.ts`, `money-copy.ts`, `axis.ts`, `address.ts`, `chart-lens.ts`, `FixedRow.svelte`, `Lane.svelte`, `ChartLegend.svelte`; the rest of `SpanBar.svelte`, `WhenEditor.svelte`, `spans.ts` and `sim-doc4.ts`.
- **`src/lib/fzp/`, not read**: `card.ts`, `card-place.ts`, `chart.ts`, `format.ts`, `labels.ts`, `market-view.ts`, `money-view.ts`, `ProjectTooltip.svelte`, `provenance.ts`, `ProvenanceBody.svelte`, `summary-request.ts`.
- **`src/lib/sim-page/`, files the brief did not name, not read**: `AddMoney.svelte`, `brush-summary.ts`, `brush-tools.svelte.ts`, `debug.ts`, `funding-copy.ts`, `funding-drafts.svelte.ts`, `funding-edit.ts`, `funding-presets.ts`, `funding-reconcile.ts`, `funding-sources.ts`, `funding-view.ts`, `FundingGroupEditor.svelte`, `FundingPoolRow.svelte`, `FundingTab.svelte`, `lid-request.ts`, `MarketTerms.svelte`, `outline-request.ts`, `PermittingSection.svelte`, `policy.ts`, `ProgrammeEditor.svelte`, `ProgrammeList.svelte`, `ProtectionsSection.svelte`, `reconcile.ts`, `RouteTimeline.svelte`, `selection.ts`, `SourceList.svelte`, `stroke-adapter.ts`, `stroke-preview.ts`, `timing.ts`, `timing-sources.ts`, `transit-edit.ts`, `TransitLayerRow.svelte`, `TransitTab.svelte`. Whether any of these holds a transition was covered by the grep in section J; nothing else about them was examined.

### Outside scope, relied on but NOT examined

- The game store (`src/lib/game/store.svelte.ts`): what `won()`, `setOffer()`, `levelUp()`, `touched()`, `beforeLeave()`, `allowed`, `progress`, `open` do. Only their call sites were read.
- `barOf`, `roundComplete` (`src/lib/game/progress.ts`), `unlockText`, `lockedLane` (`src/lib/game/copy.ts`), `beats` beyond its comment (`src/lib/game/levels.ts`).
- `src/lib/goal/goal.ts` beyond the lines grep returned: `readGoal`, `goalText`, `goalRows`, `GOAL_BASE`.
- `src/lib/sharing/` (`Autosave`, `PublishButton`, `SaveIndicator`, `SharedBanner`, codec), `src/lib/shell/` (the header, `useHeaderActions`, `LevelCell`, `Message`, `NoticePills`, `more-below`), `src/lib/brush/` (`BrushController`, `actionForKey`, `canPaint`, `SPACE_NATIVE`), `src/lib/paint/`, `src/lib/about/`.
- `src/lib/map/` (`SimMap`, `CityStore`, `CITY_DAY`, the map's own clock, marks and bars, its reduced-motion handling).
- `src/lib/sim/` (the worker, `TimelineClient`, `TimelineView` and its fields, how `planEffect` and `completedNetNew` are computed).
- No server was started, no test was run, and nothing was measured.
