# S5 census: the `/sim` page and its timeline UI

Scope: `src/lib/{sim-page,timeline,dock}`, `src/routes/sim/**`, `src/routes/s/[id]/**`. Worktree `incremental-game`, HEAD `8125e557`. Mechanical survey, no judgement. `V` = verified in code at `path:line`; `I` = inferred (source named). All paths are relative to `src/` unless absolute.

Reading note: SimPage.svelte, TimelineMode.svelte and most of the priority-item files were read in full; many `*.spec.ts` and some pure-TS helper files were not opened (see appendix).

---

## 0. Headline facts a designer should know first

1. `/sim` is one component chain: `routes/sim/+page.svelte` -> `SimRoute` -> `SimPage` -> `TimelineMode` (V, sections 1.2). `/s/[id]` mounts the same chain with `mode="view"` (V `routes/s/[id]/+page.svelte:76-85`).
2. "Read-only" is a single boolean `readonly = untrack(() => mode === 'view')`, fixed for the component's life (V `lib/sim-page/SimPage.svelte:155`), threaded as a `readonly` prop to TimelineMode, Timeline, KindRow, PolicyRow, SpanBar, Inspector, WhatEditor, WhenEditor. There is no other lock/level/unlock concept anywhere in scope (grep counts, section 4).
3. The set of control groups is decided in three data-driven places, not by a per-group flag: `addChoices(kind, cal, doc)` (V `lib/timeline/add.ts:67`), `Timeline.kinds` (V `lib/timeline/Timeline.svelte:107-109`: Zoning, Permitting, plus Public money only when `hasMoney(calibration)`), and `WhatEditor`'s branch on `policy.where.tag` (V `lib/timeline/WhatEditor.svelte:122-176`).
4. Zoning on `/sim` DOES use the Paint brush machinery: `BrushController`, `BrushState`, `PaintTab`, `PaletteStrip`, `HistoryButtons` etc. are imported by `SimPage.svelte:29-48` (section 8).
5. The `dock/` directory is NOT mounted by anything in the `/sim` chain; its importers are `lib/brush/BrushEditor.svelte`, `routes/+page.svelte`, `routes/p/[id]/+page.svelte` (V grep, section 1.3).
6. Nothing in scope imports `$lib/members`, `$lib/sim-sync`, `$lib/sim-store`, `$lib/sim-log` or `$lib/account` (V grep, section 10). `/sim` is purely local-document + anonymous publish.
7. The goal is a standalone value (`GOAL_BASE`: 82,069 homes from 30 Jun 2022) with the deadline at the end of the 480-month window; the page has no way to change goal amount or deadline except a test seam prop `goal` (V `lib/goal/goal.ts:62-74`, `lib/timeline/TimelineMode.svelte:279,383`).
8. Funding editors hard-code a Dec 2066 last month while the window end is `asOf + 480 months` (V `lib/sim-page/FundingPoolRow.svelte:127`, `FundingGroupEditor.svelte:78`, `ProgrammeEditor.svelte:169`, `funding-copy.ts:164`; window: `lib/sim/timeline-client.ts:29`).

---

## 1. Inventory

### 1.1 Routes

| File | Lines | Role | Mounted by |
|---|---|---|---|
| `routes/sim/+page.svelte` | 14 | `/sim`: `<SimRoute mode="edit" persist="restore" remix={page.state.sfhSimRemix}>` (V :14) | SvelteKit |
| `routes/sim/+page.ts` | 17 | universal load: `loadSimScenario(datasetVersion, datasetVersion, fetch)` (V :11-16) | SvelteKit |
| `routes/s/[id]/+page.server.ts` | 19 | `loadSharedDoc(SIM_SERVER_CODEC4, ...)`, sets `cache-control: private, max-age=300` (V :8-18) | SvelteKit |
| `routes/s/[id]/+page.ts` | 32 | opens the shared doc with calibration, `openShared`, 500 on unparsable (V :15-31) | SvelteKit |
| `routes/s/[id]/+page.svelte` | 87 | banner (`SharedBanner`) + `SimRoute mode="view" persist="off"` (V :63-86) | SvelteKit |
| `routes/s/[id]/+error.svelte` | 33 | error page, "Start your own" link (V grep :5,:28) | SvelteKit |
| `routes/sim/test/SimPageHost.svelte` (17), `routes/s/[id]/test/PageHost.svelte` (21) | | test hosts (section 15) | specs |
| specs: `routes/sim/page.spec.ts` 134, `page.svelte.spec.ts` 124; `routes/s/[id]/page.spec.ts` 137, `page.server.spec.ts` 128, `page.view.svelte.spec.ts` 254 | | not opened | |

### 1.2 Mount tree from `routes/sim/+page.svelte` (V unless marked)

```
routes/sim/+page.svelte
 └ sim-page/SimRoute.svelte (73)                  {#key data} remount; drops ?seed= (afterNavigate, :40-49)
    └ sim-page/SimPage.svelte (1219)              the document owner; props `mode`, `persist`, ...
       ├ timeline/TimelineMode.svelte (1846)      props: policy, readonly, onedit, inspector snippet, actions, status, layers, notices
       │  ├ shell/header-actions useHeaderActions(headerActions, {pinned: scoreBar, status: statusSlot})  (:1369)
       │  │   ├ headerActions -> SimPage `actions` snippet: "Stop painting/erasing", HistoryButtons (touch only), PublishButton (edit only)
       │  │   ├ scoreBar    -> timeline/TimelineHeaderScore (132)
       │  │   └ statusSlot  -> SimPage `saveState` (SaveIndicator, edit only) + "Updating" (Explain)
       │  ├ map/SimMap + MapKeyControl(openFromMd, {layers}) -> timeline/SimKey (76); LayerSwitches via SimPage `layerSwitches` snippet
       │  ├ fzp/ProjectCardPanel, fzp/ProjectTooltip, about/AboutDialog (outside scope)
       │  ├ shell/NoticePills -> SimPage `notices` snippet (sim-page/SimNotices 107) + goal notice (Message) + session notices
       │  └ bottom pane `tl-dock` (:1738-1818)
       │     ├ timeline/Timeline.svelte (570)     rows
       │     │   ├ playhead snippet -> timeline/Playhead.svelte (521)
       │     │   ├ chart snippet    -> timeline/ChartRow.svelte (452) (+ ChartLegend 101)
       │     │   ├ timeline/KindRow.svelte (304) x2-3 (zoning, permitting, money if hasMoney)
       │     │   │   ├ FixedRow (182)   "Current law" / "Current timelines" / "Current funding"
       │     │   │   ├ PolicyRow (107) -> SpanBar (306) -> LevelFill (123)
       │     │   │   └ Lane (31)
       │     │   └ FixedRow "Market conditions" (Timeline.svelte:299-302)
       │     └ detail column `<aside data-testid="tl-inspector">` -> SimPage `inspectorPart` snippet:
       │         panel==='details'  -> timeline/SimDetails (296)  [goal rows, chart lens, MoneyResults (fzp/, outside scope), year table]
       │         panel==='activity' -> timeline/SimActivity (172)  [goal name, starters, Latest, totals]
       │         else               -> timeline/Inspector (489)
       │                                ├ AddMenu (42)            "+" menu
       │                                ├ FundingPoolRow (912)    own-pool draft (sim-page/)
       │                                ├ WhenEditor (252)        spans' dates
       │                                └ WhatEditor (181)  -> TransitLayerRow | paint snippet (paint/PaintTab) | ProtectionsSection |
       │                                                       PermittingSection(->RouteTimeline) | FundingTab(->FundingGroupEditor, FundingPoolRow, ProgrammeList->ProgrammeEditor, AddMoney, MarketTerms) | PolicySummary (read-only)
       ├ paint/PaletteStrip (below md, non-move tool)  (SimPage.svelte:1209-1218)
       └ <p role=status> brush announcements
```

I: `Dock.svelte` is not in this tree (see 1.3).

### 1.3 `lib/sim-page` (non-test source; line counts from `wc -l`)

| File | Lines | Role (V if from code I read; I if name/props only) | Imported by (non-test) |
|---|---|---|---|
| `SimPage.svelte` | 1219 | page: store, autosave, PolicySync, brush controller, map overlays, header snippets (V) | `SimRoute` |
| `SimRoute.svelte` | 73 | route body shared by `/sim` and `/s/[id]` (V) | both routes |
| `load.ts` | 54 | `loadSimScenario`: manifest + `scenarios.fzp.calibration` (V) | both `+page.ts` |
| `policy.ts` | 598 | schema-3 `SimPolicy` ("the recipe"), parse, `queryKey`, `compileLevers`, `scoreCopy` (V :25-130,:561-598) | lens, policy4, many |
| `policy-store.svelte.ts` | 121 | `PolicyStore<P>`: current doc + undo/redo + `normalize` (V) | SimPage, Inspector |
| `sim-doc.ts` | 232 | schema-3 doc/codec, `SIM_KEY='sfhousing:sim:v1'` (V sim-doc.ts:42) | session4, sim-doc4 |
| `sim-session.ts` | 96 | `SimNotice` type + `TIMING_NOTICE_TEXT` (I; imported by session4) | session4 |
| `reconcile.ts` | 177 | schema-3 reconcile (I) | reconcile4 (I) |
| `selection.ts` | 75 | `limitsViewOf`, `selectionForLot` (V SimPage usage) | SimPage |
| `brush-tools.svelte.ts` | 35 | `SimBrushTools`, `ERASE_HINT`, `brushToolOf` (V use) | SimPage |
| `brush-summary.ts` | 142 | paint rows, lot status text (V use) | SimPage, WhatEditor, SimDetails |
| `stroke-adapter.ts` | 117 | bridges BrushController to a span's `custom` brushes (V header :1-14, use) | SimPage |
| `stroke-preview.ts` | 102 | live building preview while painting (V use) | SimPage |
| `feedback.ts` | 138 | `PaintFeedback` overlay, `lotsInView` (V use) | SimPage |
| `lid-request.ts` / `outline-request.ts` | 142 / 83 | height-lid and painted-outline requests to the worker (V use) | SimPage |
| `debug.ts` | 26 | `installSimDebug` (V use) | SimPage |
| `funding-copy.ts` | 474 | funding wording, `fundingNotices`, `limitAlert` (V :150-157,:328+) | many |
| `funding-edit.ts` | 994 | pure edits of `SimPolicy.funding` (pools, programmes, scales, terms, drafts) (V export list) | FundingTab, rows, Inspector |
| `funding-presets.ts` | 624 | `fundingPresets(cal)`, `addPreset` (V) | add.ts, FundingTab, Inspector |
| `funding-sources.ts` | 278 | cited constants for presets (I) | funding-presets |
| `funding-view.ts` | 1102 | coverage steps, baseline groups, previews, `fundingName` (V export list) | FundingTab, owner.ts |
| `funding-reconcile.ts` | 64 | I | reconcile4 (I) |
| `funding-drafts.svelte.ts` | 25 | `FundingDrafts` page memory (V full) | SimPage, Inspector, FundingTab |
| `FundingTab.svelte` | 694 | funding editors host (V :1-420) | WhatEditor |
| `FundingGroupEditor.svelte` | 384 | one baseline group (City/State/Federal) editor (V header) | FundingTab |
| `FundingPoolRow.svelte` | 912 | an added pool's row/editor, also the own-pool draft (V header) | FundingTab, Inspector |
| `ProgrammeList.svelte` / `ProgrammeEditor.svelte` | 187 / 912 | "What it pays for" rows (V header) | FundingTab/Group/Pool |
| `AddMoney.svelte` | 108 | "+ Add money" preset chooser (V) | FundingTab |
| `MarketTerms.svelte` | 194 | "Market terms you set" (V header) | FundingTab |
| `SourceList.svelte` | 24 | provenance list | many |
| `PermittingSection.svelte` | 216 | timing preset, shares, per-route timelines (V full) | WhatEditor |
| `RouteTimeline.svelte` | 459 | one route's stage bar + details editor (V header) | PermittingSection |
| `timing.ts` / `timing-sources.ts` | 564 / 252 | presets, `TimingSet`, floors (V exports) | many |
| `ProtectionsSection.svelte` | 152 | rent control / historic / newer-than-N protections (I; `store.apply` :41) | WhatEditor |
| `TransitLayerRow.svelte` | 263 | transit rule: stop types + bands (V WhatEditor use) | WhatEditor, TransitTab |
| `transit-edit.ts` | 119 | band edits (I) | TransitLayerRow |
| `TransitTab.svelte` | 165 | schema-3 transit tab; imported by NO non-test file (V grep; only mentioned in `selection.ts:4` comment) | none |
| `PolicySummary.svelte` | 172 | read-only text of a span's projection (V WhatEditor use) | WhatEditor |
| `SimNotices.svelte` | 107 | notice region in the stack (V header) | SimPage |
| `test/` + `fixtures/schema2/` | see 15 | | |

### 1.4 `lib/timeline` (non-test source)

| File | Lines | Role | Imported by |
|---|---|---|---|
| `TimelineMode.svelte` | 1846 | session host, map, playhead state, header slots, goal notice, detail column (V) | SimPage |
| `Timeline.svelte` | 570 | rows grid (V header, props) | TimelineMode |
| `Playhead.svelte` / `playhead.ts` | 521 / 133 | transport + ruler/slider, keys, `filledEndDay` (V) | TimelineMode |
| `KindRow` 304, `PolicyRow` 107, `SpanBar` 306, `FixedRow` 182, `Lane` 31, `LevelFill` 123 | | rows and bars (V headers) | Timeline chain |
| `ChartRow` 452, `ChartLegend` 101, `chart-model.ts` 139, `chart-lens.ts` 19 | | chart (V ChartRow header) | TimelineMode/Timeline |
| `Inspector` 489, `WhatEditor` 181, `WhenEditor` 252, `AddMenu` 42 | | detail-column editor (V full) | SimPage / Inspector |
| `SimDetails` 296, `SimActivity` 172, `SimKey` 76, `TimelineHeaderScore` 132, `Explain` 180 | | faces and header score (V) | TimelineMode etc. |
| `policy4.ts` 98 | | schema 4 types (V full) | everywhere |
| `sim-doc4.ts` 361, `parse4.ts` 383, `reconcile4.ts` 299, `upgrade.ts` 136, `server-codec.ts` 132 | | schema-4 doc, strict parse, reconcile, schema 2/3 -> 4 upgrade, server codec (V sim-doc4:1-120,:296-361; others I) | SimPage, s/[id] |
| `session.svelte.ts` 671, `session4.ts` 184, `fill.ts` 66, `chunk-log.ts` 136 | | `TimelineSession` (open/send/edited/stale), restore+notices, chunk log (V session partial, session4 full) | TimelineMode |
| `policy-sync.svelte.ts` 227 | | brush-query resolution, 250 ms debounce (V :1-60) | SimPage |
| `lens.ts` 342 | | schema 4 span <-> schema 3 `SimPolicy` (V :1-130,:211-342) | SimPage, Inspector |
| `add.ts` 247, `spans.ts` 248, `rows.ts` 194, `owner.ts` 51, `outcome.ts` 78, `results.ts` 193, `reveal.ts` 173, `pool-level.ts` 217, `activity.ts` 154, `activity-view.ts` 151, `details.ts` 60, `copy.ts`, `key.ts`, `address.ts`, `axis.ts`, `places.ts`, `shortcuts.ts` | | pure helpers (V those named in the sections below; others I) | |
| `test/` | | section 15 | |

### 1.5 `lib/dock`

| File | Lines | Role | Imported by |
|---|---|---|---|
| `Dock.svelte` | 403 | tabbed side panel/bottom sheet "on two faces" (V :1-60) | `lib/brush/BrushEditor.svelte`, `routes/+page.svelte`, `routes/p/[id]/+page.svelte` (V grep `lib/dock`; not the `/sim` chain) |
| `dock-state.svelte.ts` | 67 | `DockState` (V :1-30) | same |
| `icons.ts` | 45 | `DOCK_ICONS` | Dock |

Doc/code contradiction candidate: `lib/sim-page/SimPage.svelte` and `docs/dev/sim-page.md:3` say the dock is gone from `/sim` ("FzpMode, the Setup and Run phases, the dock ... are gone"). Consistent with code; but `dock/test/DockHost.svelte:2` comment still says "as /sim lays it out" (V), which is stale.

---

## 2. Control groups through which a person changes the simulation

All edits funnel into `PolicyStore<SimPolicy4>.apply(change, label, coalesce)` (V `lib/sim-page/policy-store.svelte.ts:56-75`; `SimPage.svelte:197` `store = new PolicyStore(DEFAULT_POLICY4, normalize)`). The store then:
1. `normalize` = `reconcilePolicy4` (drops programmes/scales without a source, shows funding notice) (V SimPage.svelte:180-192).
2. `$effect` in SimPage sends `store.policy` to `PolicySync.update(p)` (V SimPage.svelte:296-303), which resolves brush queries and settles `lots` after 250 ms (V policy-sync.svelte.ts:5,53).
3. TimelineMode takes `policy` + `lots` props; on a new `policy` object it marks the edit, pauses playback (V TimelineMode.svelte:1166-1181); when `lots` settle, `session.send(policy, lots)` (V :1213-1225) -> `TimelineClient.setPolicy(policy, lots)` posts `{type:'setPolicy', rev, policy, lots}` to the worker (V `sim/timeline-client.ts:127-134`). Open: `c.open(m,p,l)` (V TimelineMode.svelte:1124-1127).

So the worker receives the whole schema-4 `SimPolicy4` plus resolved lots; there is no per-control message. Exception: map-side requests (brush resolve, lot outlines, lids, preview, `lotAt`, `brushCatalog`) go through `TimelineClientApi` (V TimelineMode.svelte:1112-1119), but they do not change the simulation.

Edits are one of two shapes: (a) direct schema-4 operations (`setOn`, `movePolicy`, `removePolicy`, span ops, `addPolicy`), or (b) through the span lens (`project` -> schema-3 editors -> `writeBack`), which writes only the fields the selector projects (V lens.ts:1-9, 70-107, 211-243).

| Group | Component files | Document fields written | How it reaches the worker |
|---|---|---|---|
| **Add a policy ("+" menu, starters)** | `timeline/KindRow.svelte:97-107` ("+"), `AddMenu.svelte`, `Inspector.svelte:pick/add` (:297-345), `SimActivity.svelte` starters, `SimPage.addStarter` (:419-451), `timeline/add.ts` | appends a `Policy` to `doc.kinds[kind]`: id, label, preset, on, where, spans[{from=playhead month, to=null, what}] (`addPolicy` add.ts:223) | store.apply -> PolicySync -> setPolicy |
| **Policy on/off, order, remove** | `Inspector.svelte:toggleOn/move/removeThis` (:200-231), `timeline/spans.ts` `setOn` :212, `movePolicy` :224, `removePolicy` :218 | `Policy.on`; order of `kinds[kind]`; policy deletion | same |
| **Dates ("When"): spans** | `WhenEditor.svelte` (month/year selects; Add span, Split at playhead, Remove span), `SpanBar.svelte` (keys :102-112, drag edges :114-148), `spans.ts` `setFrom` :75 `setTo` :87 `moveEdge` :100 `moveSpan` :114 `splitSpan` :141 `addSpan` :171 `removeSpan` :201 | `Span.from`, `Span.to` (null = no end), `Policy.spans[]` | same (via `Inspector.whenEdit` :233-241 and Timeline `onedit`) |
| **Zoning: transit rule** (`where.tag='transit'`, `what.tag='bands'`) | `sim-page/TransitLayerRow.svelte` (stops in policy part, bands in span part), `transit-edit.ts`, hosted by `WhatEditor.svelte:123-146` | `where.stopTypes: StopType[]`; `what.bands: TransitBand[]` (`{maxM, stories}`); `on` (readBack lens.ts:211-225) | same |
| **Zoning: painted area** (`where.tag='painted'`, `what.tag='brushes'`) | map strokes: `SimPage` `strokeStore` (:507-540), `stroke-adapter.ts`, `BrushController`; list/erase: `paint/PaintTab` via SimPage `paintPart` snippet (:1110-1123) | `what.brushes: CustomBrush[]` (`{id,kind:'paint',strokes,stories}` or `{id,kind:'erase',strokes}`); a stroke with no painted policy selected creates one via `addPolicy(... what:'paint')` at the playhead month (SimPage.svelte:521-534) | same; needs lots from `api.resolveBrush` (PolicySync) |
| **Zoning: protections** (`where.tag='category'`, `what.tag='protect'`) | `sim-page/ProtectionsSection.svelte` (`store.apply` :41), `WhatEditor.svelte:149-150` | `where.category` in `rentControl|historic|newerThan`; `what.years: number|null`; `on` (lens.ts:226-234) | same |
| **Permitting timers** (`where.tag='routes'`, `what.tag='timing'`) | `sim-page/PermittingSection.svelte`, `RouteTimeline.svelte` (:192 `store.apply`), `timing.ts` | `what.set: TimingSet`: `preset`, `presetTimers`, `presetRouteShares`, `edits`, `routeShares`, `localProgramStreamlined` (timing.ts:175-186); label `timingLabel` | same (lens `readTiming` lens.ts:146) |
| **Funding: baseline scale** (`where.tag='baseline'`, `what.tag='scales'`) | `FundingTab` (groups) + `FundingGroupEditor` ("+ Change from a date"), `funding-edit.ts` `addScaleEdit :773` | `what.entries: {pool, from, scale}[]` | same |
| **Funding: own pool / preset pool and programmes** (`where.tag='fund'`, `what.tag='fund'`) | `FundingTab`, `FundingPoolRow`, `ProgrammeList`, `ProgrammeEditor`, `AddMoney`, `funding-presets.ts` | `where.pool: string`; `what.pool: Pool|null`, `what.programmes: Programme[]` (policy-4 types; Pool/Programme at `timelapse/types.ts:244-282`) | same |
| **Funding: market terms** (`where.tag='terms'`, `what.tag='terms'`) | `MarketTerms.svelte`, `FundingTab` | `what.terms: Partial<Record<TermKey,number>>` (grant/loan/guarantee-related: `constructionRate`, `constructionYears`, `requiredReturn`, `guaranteeRateCut`, `lossOnExit`; types.ts:288) | same |
| **Playhead / "Play from" / speed / Today** | `Playhead.svelte` | page state `day`, `playing`, `speed` (TimelineMode.svelte:262-264); NOT in the document, not saved, not sent as an edit | `session.playhead(d)` -> `viewMonth` (client) (V TimelineMode.svelte:1080-1086, session.svelte.ts `playhead`) |
| **Undo / Redo** | `HistoryButtons` (touch only, SimPage.svelte:1076-1084), Ctrl+Z via `BrushController` or `onWindowKey` (:660-686) | restores prior doc via `PolicyStore` | as any change |
| **"Reverted a change" (rule 34)** | `session.undoTo` -> `onundoto` -> `store.undoTo(p,'Reverted a change')` (SimPage.svelte:1181) | restores the last worker-accepted doc | as any change |
| **Map layer switches** | `view/LayerSwitches` via `layerSwitches` snippet (SimPage.svelte:1051-1053) | `ViewPrefs` only (not simulation) | none (display) |

Not found in scope (V grep): any "law switch" control, any seed control (`?seed=` is dropped, `SimRoute.svelte:40-49`), any dataset-version control. The twin/compare is fixed: `results.ts:96-98` says "view.compare is never read: it is 'plan' for every document"; `TimelineMode.svelte:73-77` builds `copy` with `scoreCopy(... {compare:'fzp'})` only to pick wording.

Fixed (not editable) rows: "Current law", "Current timelines", "Current funding" (`rows.ts:41-53`, Inspector shows text only, `Inspector.svelte:402-411`), and "Market conditions" (`rows.ts:61`, `Timeline.svelte:299-302`).

### 2.1 What each add offers (`add.ts:67-110`)

```ts
export type AddChoice =
  | { kind: 'zoning'; what: 'transit' }
  | { kind: 'zoning'; what: 'paint' }
  | { kind: 'zoning'; what: 'protect'; category: Category }
  | { kind: 'permitting'; what: 'preset'; preset: PresetId }
  | { kind: 'permitting'; what: 'custom' }
  | { kind: 'money'; what: 'preset'; preset: string }
  | { kind: 'money'; what: 'fund'; pool: Omit<Pool, 'id'> }
  | { kind: 'money'; what: 'baseline' }
  | { kind: 'money'; what: 'terms' };
```
(`lib/timeline/add.ts:25-35`.) Money offers return `[]` when `!hasMoney(cal)` (add.ts:100-101). Limits: `FINANCE_LIMITS` (pools 12, programmes 24, baseline scale entries 24 per `funding-copy.ts:150-155`), refused via `AddLimitError` (add.ts:48).

Starters (Activity at today, nothing in force, editable): "Taller near transit" (`zoning/transit`), "SB 423 approval clock" (`permitting/preset sb423Clock`), "A housing bond" (`money/preset housing-bond`) (V `activity-view.ts:74-84`).

---

## 3. The policy document as the page holds it

### 3.1 Schema versions

- Schema 4 is the live document: `SimDoc4`, `SimPolicy4` (below). Autosave key `SIM_KEY4 = 'sfhousing:sim:v2'` (V `timeline/sim-doc4.ts:36`).
- Schema 3 `SimPolicy` ("the /sim policy recipe", `sim-page/policy.ts:2`) is retained as the *editor projection* ("the recipe the editors project"): `lens.ts:1-9` ("today's editors edit one span of a schema 4 document through a `SimPolicy` that holds only that span's effect"). Old autosave `sfhousing:sim:v1` is migrated once to v2 (V sim-doc4.ts:338-360; session4.ts:123-146).
- Upgrades read from schema 2 and 3 (V `session4.ts:96-100` notices for `upgradedFrom` 2|3; `timeline/upgrade.ts` not opened).

### 3.2 Types (verbatim)

`lib/timeline/policy4.ts:15-51`:
```ts
export type Selector =
  | { tag: 'transit'; stopTypes: StopType[] }
  | { tag: 'painted' }
  | { tag: 'category'; category: 'rentControl' | 'historic' | 'newerThan' }
  | { tag: 'routes' }
  | { tag: 'baseline' }
  | { tag: 'fund'; pool: string }
  | { tag: 'terms' };

export type Effect =
  | { tag: 'bands'; bands: TransitBand[] }
  | { tag: 'brushes'; brushes: CustomBrush[] }
  | { tag: 'protect'; years: number | null }
  | { tag: 'timing'; set: TimingSet }
  | { tag: 'scales'; entries: { pool: string; from: Day; scale: number }[] }
  | { tag: 'fund'; pool: Pool | null; programmes: Programme[] }
  | { tag: 'terms'; terms: Partial<Record<TermKey, number>> };

export interface Span { from: Day; to: Day | null; what: Effect; }

export interface Policy {
  id: string; label: string; preset: string | null; on: boolean; where: Selector; spans: Span[];
}

export interface SimPolicy4 {
  schema: 4;
  kinds: { zoning: Policy[]; permitting: Policy[]; money: Policy[] };
}
```
`DEFAULT_POLICY4 = { schema: 4, kinds: { zoning: [], permitting: [], money: [] } }` (policy4.ts:56-59). `nothingInForce(doc)` = no policy that is `on` has a span (policy4.ts:93-97); used for `inForce`, starters, and "empty" for publish.

`lib/timeline/sim-doc4.ts:38-45`:
```ts
export interface SimDoc4 {
  schema: 4;
  kind: 'sim';
  datasetVersion: string;
  title?: string;
  policy: SimPolicy4;
}
```
`sim-page/policy.ts:58-73` (the schema-3 recipe the editors project):
```ts
export interface SimPolicy {
  schema: 3;
  rules: ZoningRule[];
  custom: CustomBrush[];
  protect: CategoryProtections;
  timing: SimTiming;
  funding: FinanceLevers;
}
```
```ts
export type CustomBrush =
  | { id: string; kind: 'paint'; strokes: Stroke[]; stories: number }
  | { id: string; kind: 'erase'; strokes: Stroke[] };
```
(`policy.ts:35-51`.) `FinanceLevers` (`sim/levers/types.ts:57-62`):
```ts
export interface FinanceLevers {
  baselineScale: { pool: string; from: Day; scale: number }[];
  pools: Pool[];
  programmes: Programme[];
  terms: Partial<Record<TermKey, number>>;
}
```
`TimingSet`, `SimTiming` at `sim-page/timing.ts:175-191` (fields listed in section 2).

### 3.3 Projection, write-back and cross-span rules

- `project(doc, ref)` returns `DEFAULT_POLICY` holding only the span's effect; an `off` policy projects as no rule / no protection (V lens.ts:70-107).
- `tryWriteBack` returns the same doc object when nothing changes; refuses an edit past `FINANCE_LIMITS` (pools, programmes, scales) with `limitAlert` text; a permitting preset is the policy's, so a preset change on a multi-span policy is refused with `PRESET_PER_POLICY` ("This policy has more than one span. Add a new policy for another preset.") (V lens.ts:21-24,:246-298; WhatEditor passes `presetLocked` :166-171). A fund's programme set is written to every span (lens.ts header :6-8).
- `spanLens` wraps `store.apply`, memoizes `policy` per (doc, ref), exposes `refused` (lens.ts:300-342).
- Inspector's `through` store keeps `on` for transit policies (the switch belongs to the Inspector) (V Inspector.svelte:114-138).

### 3.4 Drafts, Save/Revert, "edits in place on an offer"

- **Drafts** (`FundingDrafts`, V `sim-page/funding-drafts.svelte.ts:11-25`): one open `Draft = {kind:'pool', pool: PoolDraft} | {kind:'programme', prog: ProgrammeDraft}` (`funding-edit.ts:884`), page memory outside the store: autosave, undo, publish and the worker never see it (header comment :1-5). Completed by `completeDraft` (funding-edit.ts:952) into one store change. Discarded when selection changes to another policy, "+" opens, or the editor closes (`Inspector.svelte:166-186`, announced `DRAFT_DISCARDED`); lost on reload (copy `DRAFT_LINE`, funding-copy.ts:147).
- **Save / Revert on timers**: on `/sim` there is NO Save and no "Revert to saved". `WhatEditor` renders `PermittingSection ... snapshot={false}` (V WhatEditor.svelte:166-171; PermittingSection.svelte:144-148 hides Save when `snapshot` false). The remaining button reads "Revert to {preset name}" and is `disabled={target === null}` (PermittingSection.svelte:149-160); `revertTarget` returns the saved set if any else the preset's own set (timing.ts:366-378). `docs/dev/sim-timers.md:69-71` agrees. The schema-3 `timing.saved` field still exists in the type but `project` sets `saved: null` (lens.ts:97) and the schema-4 `Effect` carries only `set`.
- **"Edits in place on an offer"**: I (no literal phrase in code). Closest verified mechanism: the "+" menu entry `AddOffer` (`add.ts:42`) vs `AddChoice`: "Your own pool" is an offer that opens a pool draft instead of adding (Inspector.svelte:313-336); starters/menu picks add the policy at the playhead month and select it, after which its editor edits in place. Marked I: the owner's phrase probably refers to this and/or the "stored programme whose new instrument needs a value opens a draft" rule (ProgrammeEditor header, V :11-14).

### 3.5 Load/normalize

- `openDoc()` (SimPage.svelte:218-264): order of precedence: route-opened doc (`openedByRoute`) > `initialText` via `openShared` > persist 'off' (empty default) > autosave restore via `restoreSim4(storage(), autosave, ds, remix)` with writable guard `simDoc4Problems(x).length === 0`.
- Document limits: strokes (`OPS_MAX`, radius, path points, SF bbox) and canonical byte size `MAX_PLAN_BYTES` (V sim-doc4.ts:68-107).
- Notices vocabulary: `SimNotice4` id adds `'upgraded' | 'dates-moved' | 'unparsable'` (session4.ts:34-38).

---

## 4. Read-only view and lock-like patterns

### 4.1 Every check that makes the page or a control read-only

| Where | Check | Effect |
|---|---|---|
| `SimPage.svelte:155` | `const readonly = untrack(() => mode === 'view')` | source of truth; fixed at mount |
| `SimPage.svelte:154` | `persistMode = persist ?? (mode==='view'?'off':'restore')` | no autosave in view |
| :423 | `addStarter`: `if (readonly \|\| !c) return` | no starters |
| :587 | `attachController`: `if (readonly \|\| controller) return` | no BrushController, so no map painting |
| :639 | `toolOff = !readonly && wide && tool !== 'move' && !toolsShown` | "Stop painting" button hidden |
| :665 | `onWindowKey`: `controller \|\| readonly` -> no Ctrl+Z | |
| :908 | outlines effect: `readonly \|\| tools.tool !== 'erase'` | |
| :995 | catalog fetch skipped when `readonly` | |
| :1072 | header `actions`: `{#if !readonly}` wraps HistoryButtons and PublishButton | no Undo/Redo/Publish |
| :1143 | Inspector `{readonly}` | |
| :1164-1170 | TimelineMode `cards={readonly \|\| tool==='move'}`, `spacePlays={!canPaint(brush, readonly)}`, `status={readonly ? undefined : saveState}` | no save-state cell |
| :1177 | TimelineMode `{readonly}`; :1201 `onstarter={readonly ? undefined : addStarter}`; :1209 palette strip hidden | |
| `TimelineMode.svelte:216,1769` | prop `readonly` -> `Timeline` | |
| `Timeline.svelte:41,283,349` | passes to `KindRow`/`PolicyRow`/`FixedRow` | |
| `KindRow.svelte:74,97` | `words = ... && !readonly`; "+" button `{#if !readonly}` | no "+" in view |
| `SpanBar.svelte:103,182` | `if (readonly \|\| ...) return` on keys; edge handles `{#if !readonly}` | no keys/drag |
| `PolicyRow.svelte:28,72` | pass-through | |
| `Inspector.svelte:130-132,:239`: `poolDraft` null when readonly; `menu = readonly ? null : adding`; :392-396 on/move/remove and `WhatEditor part="policy"` only `{#if !readonly}`; error alert `{#if !readonly}` | |
| `WhatEditor.svelte:122-126` | `{#if readonly}` -> `PolicySummary` (span part only) instead of editors | read-only text |
| `WhenEditor.svelte:readonly prop` | spans as text (header :11) | |
| `routes/s/[id]/+page.svelte:76-85` | passes `mode="view" persist="off"` | the only producer of `readonly=true` |

### 4.2 Grep summary (scope: sim-page, timeline, dock, routes/sim, routes/s; non-test files; counts are lines)

| Pattern | Lines | Representative use |
|---|---|---|
| `readonly` (word, any case; includes the TS `readonly` modifier on arrays, which is most of the 115) | 115 | the page flag above (SimPage ~17 lines, Inspector 10, KindRow 5, SpanBar 4, WhenEditor 4, Timeline 4); the rest is TS `readonly T[]` (e.g. `timing.ts:83`, `policy.ts:81`) |
| `disabled` / `aria-disabled` | 64 | affordance rules, not mode: limit reached or draft open (`AddMoney.svelte:69,87,101`), last stop type (`TransitLayerRow.svelte:176`), band min/max (`TransitLayerRow.svelte:225,235,242,253`), Move up/down (`Inspector.svelte:424`), preset locked (`PermittingSection.svelte:128`), Revert (`:151`), Split / Remove span (`WhenEditor.svelte:240,246`), Publish when empty (`sharing/PublishButton.svelte:~75`), term in use (`MarketTerms.svelte:175`) |
| `locked` / `lock` | 17 / 4 | `TransitLayerRow.svelte:170-180` (last stop type), `MarketTerms.svelte:105-181` (term in use by a guarantee), `RouteTimeline.svelte:95` and `timing.ts:153,435` (stages "entitled"/"construction" shown locked), comment `stroke-adapter.ts:78` ("/sim has no run lock (rule 14)") |
| `canEdit` | 0 | none |
| `unlock` | 0 | none |
| `level` | 90 | all "pool level" (the share of money still free): `pool-level.ts`, `LevelFill.svelte`, `KindRow.svelte:40-70,151-160`, `PolicyRow.svelte:14-76`, `SpanBar.svelte`; plus `marketLevel`/`marketText` level `'all'|'private'` (`rows.ts:68`). NO game-level concept anywhere |

`dock/` has `readonly`-modifier hits only (`Dock.svelte` 3, `icons.ts` 1; V grep counts).

### 4.3 Gating hooks that already exist by data (I from reading)

- Which kinds appear: `Timeline.kinds` (`Timeline.svelte:107-109`). Which rows each has: `addChoices` (`add.ts:67`). Which editor a policy gets: `WhatEditor` branch on `where.tag` (`WhatEditor.svelte:122-176`). Funding hidden when `hasMoney(cal)` false (`rows.ts:64`, `WhatEditor.svelte:172`).
- No component takes a "which kinds are enabled" prop today (I; read props of Timeline, KindRow, Inspector, WhatEditor, AddMenu).

---

## 5. Goal and headline

### 5.1 Where the goal comes from

`import { TODAY, defaultGoal, goalStep, type Goal } from '$lib/goal/goal'` (V `TimelineMode.svelte:111`). Other goal imports in scope: `timeline/outcome.ts:4` (`TODAY, goalStep, readGoal, type Goal`), `timeline/results.ts:4` (`TODAY, goalName, goalText, readGoal`), `timeline/SimDetails.svelte` (`goalRows, goalTrackMax`, `GoalRow`), `timeline/SimActivity.svelte` (`goalName`). `src/lib/goal/goal.ts` (out of scope, read in full):

```ts
export interface Goal {
  id: string; name: string; measure: GoalMeasure; amount: number; deadline: Day; countsFrom: Day;
}
export const GOAL_BASE: GoalBase = {
  id: 'goal', name: 'Goal', measure: HOMES_COMPLETED, amount: RHNA_UNITS, countsFrom: dayFromUtc(2022, 6, 30)
};
export function defaultGoal(asOf: Day): Goal {
  return { ...GOAL_BASE, deadline: windowHorizon(asOf, WINDOW_MONTHS) };
}
```
(`goal.ts:47-72`.) Amount = `RHNA_UNITS` from `M1_TARGETS` (id `rhna`; 82,069 per `goal.ts` doc comment and `goalAmountName` example). Measure: `baseline.completedNet + rows[i].completedNet` (goal.ts:44-46). Deadline = `windowHorizon(asOf, 480)`: last whole calendar month whose last day is within `monthLastDay(asOf, 480)` (V `sim/world/months.ts:34-40`).

In the page: `const goal = $derived(goalSeam ?? defaultGoal(asOf))` (V `TimelineMode.svelte:383`); `goalSeam` is the test-seam prop `goal?: Goal` (:279). SimPage passes no goal. So amount/deadline cannot be changed by any control or route; the only seam is a prop.

### 5.2 "Homes from today to the playhead's month", "the effect", "the goal": compute and render

| Quantity | Computed | Rendered |
|---|---|---|
| homes (headline line 1) | `headlineAt` (`results.ts:136-157`): at today `homes: 0`; else `view.rows[i].completedNet`, `i` = playhead's calendar month row; null while `provisional` or `filledThrough < i` | `headlineText` -> `homesBy(h.homes, h.at)` (`results.ts:181-188`, `copy.ts`) -> `TimelineHeaderScore` button text `text.main` or `CALCULATING` (`TimelineHeaderScore.svelte:~66`) |
| the effect (line 2) | `effect: opts.inForce ? view.planEffect[i].completedNetNew : null` (0 at today when in force) (`results.ts:143-156`); `inForce = !nothingInForce(resultsDoc)` (TimelineMode.svelte:324) | `fromPolicyText(h.effect)` (results.ts:184) -> `[data-testid=score-delta]` (TimelineHeaderScore:~78) |
| the goal (line 2) | `goal: readGoal(goal, view, TODAY|i)` (results.ts:147,155); `readGoal` -> `{fraction, reachedOn}` (`goal.ts:93-110`) | `goalText(r)`: `"{pct} of the goal"` or `"Goal reached, {Mon YYYY}"` (`goal.ts:113-117`) -> `[data-testid=score-goal]`; name on hover: `goalName(goal)` = `"Goal: 82,069 homes by {Mon YYYY}"` (`goal.ts:125-127`) via `Explain` |

Header plumbing: `headline = headlineAt(shown.view, {index, atToday}, {provisional, inForce}, goal)` (TimelineMode.svelte:~351-358); `headText = headlineText(headline, goal)`; passed to `TimelineHeaderScore` in the `scoreBar` snippet (:1423-1436), pinned into the shell header via `useHeaderActions(..., {pinned: scoreBar, ...})` (:1369). `headline` reads `index`/`atToday`, never `day`, so it changes at most once per month (comment :349-352).

### 5.3 Anything that shows WHEN the goal is reached

- Header: `"Goal reached, {Mon YYYY}"` replaces the percentage once `reachedOn !== null` (V `goal.ts:113-117`; `reachedOn` = first month where `valueAt >= amount`, `goal.ts:100-107`), only for months the playhead has read (reads up to `min(i, deadline month)`, `readMonth` goal.ts:84-87).
- Goal notice (`tl-goal`, `Message`): `outcomeText` -> `"Goal reached in {Mon YYYY}, by the {deadline} deadline."` or `"Goal missed by N homes. Change the policy|Add a policy and play again."` (V `outcome.ts:66-73`). Judged on the months reached (`reachedMonth`, TimelineMode.svelte:~417-421) once the deadline is passed or the window end is reached (`passed`, outcome.ts:33-35); one notice per distinct outcome per visit, dismissible (`dismissed` SvelteSet, :~459, `dismissGoal` :~466-476).
- Details: `GoalRow`s with `note` `"by {deadline}"` / `"Held at {deadline}"` and `atDeadline` ("At the deadline: 74%") when the furthest date reached is at/past the deadline (`goal.ts:140-198`, `goal/GoalRow.svelte`, `SimDetails.svelte:~100-103,134-138`).
- Ruler: "Goal" flag at `goal.deadline` while the chart draws the goal's step (`goalDeadline` TimelineMode.svelte:~422; `Playhead.svelte` flag :~267-275); sr description "Goal deadline {date}" (`copy.ts:68-73`).
- Chart: dashed step "N more by {Mon YYYY}" (`goalNote`, `copy.ts:76-78`; `ChartRow.svelte:141-143,248-259`), drawn only on the Homes lens.
- Activity at today: `goalName(goal)` line (`SimActivity.svelte:~79`).

### 5.4 "Goal at the end of the window" (latest commit `8125e557`)

Verified in code: the deadline is `windowHorizon(asOf, WINDOW_MONTHS)` (`goal.ts:72`), `WINDOW_MONTHS = 480` ("40 years", `sim/timeline-client.ts:28-29`). The outcome is judged "passed" at `reached > goal.deadline || reached >= filledEndDay(view.months, view.lastIndex, asOf)` (`outcome.ts:33-35`), and TimelineMode substitutes the window's last filled day for "the last month" (`TimelineMode.svelte:~430-440`, comment "a goal due at the window's end is judged"). `GOAL_BASE` replaces `STATE_TARGET`/`GOAL` (commit message; grep for `STATE_TARGET|RHNA_DEADLINE` in the timeline/sim-page scope returns nothing in code).

Stale text found (comments/examples only, not behaviour): `timeline/copy.ts:68` ("Goal deadline January 2031"), `copy.ts:76` ('73,346 more by Jan 2031'), `outcome.ts:66` ("by the Jan 2031 deadline") still show the old RHNA date as examples. `docs/dev/timeline-ui.md:36` already says "Goal: 82,069 homes by Sep 2066".

---

## 6. Funding UI

| Piece | Component(s) | What it shows | Engine/doc fields read |
|---|---|---|---|
| **Funding editors per policy** | `WhatEditor.svelte:172-181` mounts `FundingTab` with `only` = `baseline | fund(pool) | terms` and `termsReadOnly` for fund | one policy's editor: baseline group scale lines, or one pool + its programmes, or the market terms | `store.policy.funding` (the schema-3 projection: `baselineScale`, `pools`, `programmes`, `terms`); `calibration.baselineFunding` (pools, programmes, provenance), `calibration.market.slope.perCostShare` (FundingTab.svelte:~323) |
| **Coverage line** ("Coverage over time") | `FundingTab.svelte` steps/`coverageSummaryText` | coverage sentences, announced on edit | `coverageSteps(f, baseline, priced, HORIZON)` (`funding-view.ts:221`), `HORIZON = 2066-12-31` (`fzp/time.ts:21`) |
| **Baseline groups** | `FundingGroupEditor` (City / State / Federal) | per-year amount, dated changes (`scaleLines`), baseline programmes read-only, added programmes | `baselineGroups`, `scaleLines` (funding-view.ts:277,333) |
| **Presets** | `AddMoney.svelte` + `funding-presets.ts` | four groups: City money, The public bank, State money, Federal money; each with `description`, `available`, `reason` | `fundingPresets(cal)`: `FundingPreset {id,label,description,group,baselineScale,pools,programmes,provenance,available,reason?}` (funding-presets.ts:44-55). Known preset ids in code: `housing-bond` (activity-view.ts:82), `revolving-fund`, `public-bank`, `federal-support` (funding-presets.ts:289,326,391; others not enumerated) |
| **Own pool / draft** | `FundingPoolRow` (draft when `id` null), `Inspector.svelte:poolDraft` | fields table 4.7: name, kind (`PoolKind`: goBond, cop, generalRevenue, dedicatedTax, state, federal, bank), inflows once/yearly, debt rate/years, bank leverage | `PoolDraft` type (funding-edit.ts:861-871) |
| **Programmes ("What it pays for")** | `ProgrammeList`, `ProgrammeEditor` | reach, instrument grant/loan/guarantee, share/costShare/rate/reserve, from/until, minHomes, income tiers | `Programme`, `Instrument` (types.ts:266-282) |
| **Market terms** | `MarketTerms.svelte` | typed `guaranteeRateCut` etc.; "Use the sourced value" | `termRows(f, [...])` (funding-view.ts:964); `resolveTerms(MARKET_TERMS, termsInForce(resultsDoc, day))` (TimelineMode.svelte:~474) |
| **Pools that drain (the bar's level)** | `timeline/pool-level.ts` `levelSet`/`poolLevel`, `LevelFill.svelte`, `SpanBar.svelte` (`levelLeft` text ", N% left"), `KindRow` (fixed "Current funding" level) | free share of money received so far, per month; "a pool paid every year refills at each payment, on purpose" (pool-level.ts:21-34) | `TimelineView.money.pools[].{received,committed,spent,out,lostCredit}`, `Pool.leverage`, `Pool.uncapped`; `levelSet(shownView, resultsDoc, calibration?.baselineFunding?.pools, asOf)` (TimelineMode.svelte:~314-316) |
| **Details' money rows** | `fzp/MoneyResults.svelte` (outside scope) used by `SimDetails.svelte:~210-228` with `part="money"` / `part="tiers"`; not shown at today | public money spent / per added home / tiers (rendering in `fzp/`; not opened) | `score.money`, `score.tiers` (`TimelineScore`), `terms`, `uncapped` set (`uncappedPoolIds`, TimelineMode.svelte:~478) |
| **Activity cost lines** | `SimActivity.svelte` | "All public money spent", "Per added home" while money is in force | `money.publicSpent[i]`, `perAddedHome` via `activityTotals` (activity-view.ts:31-58); `moneyInForce(doc)` = some money policy on with a span (activity-view.ts:60-62) |
| **Card "Funded by"** | `ProjectCardPanel` (fzp/) with `fundedBy={cardFundedBy}`, `affordable={cardFunded?.kind==='affordable'}` (TimelineMode.svelte:~1688-1696); name from `owner.ts:fundingName4` -> `funding-view.ts:fundingName` | name of pool/programme funding a project | `cardFunding(card)` (fzp), `fundsOf4(resultsDoc)` (owner.ts:30-41), baseline |
| **Notices** | `sim-page/funding-copy.ts:fundingNotices` (:328-), `session4.reportNotices`; `limitAlert` | `funding-added` (opened from schema 2), `funding-dropped` (programmes/scales with no source, with details), `funding-off` (data cannot simulate money); limit alerts "This would pass the limit of 12 added sources of money..." | `FundingLoadReport` (`droppedProgrammes`, `droppedScales`, `unusable`, `upgradedFrom`) from `reconcilePolicy4` (SimPage.svelte:180-192 shows them on every edit) |
| **Limits** | `FINANCE_LIMITS` (`sim/levers/finance`) | 12 pools, 24 programmes, 24 baseline scale entries, 12 inflows per pool (`INFLOW_LIMIT_DESC`) | |

Funding Dec-2066 coupling: `LAST_MONTH = dayOf(2066, 12, 1)` in FundingPoolRow:127, FundingGroupEditor:78, ProgrammeEditor:169; `max="2066"` FundingGroupEditor:234; `dateRangeError` "to December 2066" (funding-copy.ts:164).

---

## 7. Timers UI

- Hosted by `WhatEditor` for `where.tag === 'routes'` (V :166-171): `<PermittingSection store={edit} {calibration} snapshot={false} {announce} presetLocked={policy.spans.length > 1 ? PRESET_PER_POLICY : null} />`.
- **Presets** (V `sim-page/timing.ts:83-141`): `observed` ("SF as observed"), `sb423Clock` (available iff `SB423_SMALL_SHARE.value !== null`), `noDiscretionary`, `ceqaInfill` (iff `CEQA_FILED_RATIO.value !== null`), `benchmarkPermits` ("Permits at San Diego's pace"). Each carries `provenance` with tier; the select shows the weakest tier (`PermittingSection.svelte:~58`). In the add menu, observed is excluded ("the fixed row, not an addition"), plus a custom-timing entry (`add.ts:88-95`).
- **Floors**: `STAGE_FLOORS: Record<Pathway, Partial<Record<TimedStage, Evidence<number>>>>` (V `timing-sources.ts:217-251`), e.g. discretionary `filed` 20 days (Planning Code section 333, tier 2); others unsourced (`value: null`, `unsourced(reason)`), where the minimum is the numerical bound. Surfaced in `RouteTimeline` (`b.minBy === 'floor'`, RouteTimeline.svelte:~92-93) via `stageBounds` (timing.ts:467).
- **Evidence**: `Evidence<T>`/`Sourced`/`Unsourced` from `sim/finance/evidence`; "Sources and tiers" details at section end lists preset provenance and route-share source (PermittingSection.svelte:~191-214); each stage's own source in its details editor.
- **Route timelines**: three routes `PATHWAYS` (discretionary, streamlined, permitOnly); per-route share % input (committed on `change`, coalesced `share:{p}`), and `RouteTimeline` bar: segments, roving tabindex, "Typical months" input with - / +, drag handles (fine pointer only), editable stages `EDITABLE_STAGES = preApplication, filed, permitFiled, permitIssued`; `entitled` and `construction` shown locked (`timing.ts:154-171`). Each edit is one `store.apply` writing `timing.current` (RouteTimeline.svelte:192, PermittingSection.svelte:~64-100).
- "Local Program lots streamlined: yes/no" is shown as text only (PermittingSection.svelte:~178-186); `TimingSet.localProgramStreamlined` is not editable here (I: no handler found in the file).
- Save and Revert: section 3.4.

---

## 8. Zoning UI on `/sim`

Kinds a person can make (from `addChoices('zoning')`, `add.ts:70-84`): "Transit rule", "Painted area", and each of "Protect rent-controlled buildings", "Protect historic buildings", "Protect buildings newer than 30 years" (the last three only if not already present). Edits afterwards:

| Kind | Editor | Notes |
|---|---|---|
| Transit rule | `TransitLayerRow` (stop types in "policy" part, bands in "span" part) | bands `{maxM, stories}`; `bandProblem` rules (policy.ts:89-96: same distance, or outer taller); default `DEFAULT_BANDS` 402 m / 6 stories and 805 m / 4 (policy.ts:75-78) |
| Painted area | map Paint/Erase tools + `PaintTab` (a `paint` snippet from SimPage, rendered by `WhatEditor` for `where.tag==='painted'`) | strokes in the selected painted span; with no painted policy selected a stroke makes a new one |
| Protections | `ProtectionsSection only={category}` | |

**Uses Paint brush/plan modules: yes.** Non-test imports in scope (V `grep -E "from '\$lib/(paint|brush|plan)"`):

- `SimPage.svelte:29-33` `$lib/brush/{BrushController.svelte, messages, overlay, shortcuts, state.svelte}`; `:43-48` `$lib/paint/{HistoryButtons, outline-layers, PaintTab, PaletteStrip, pointer.svelte, rows}`.
- `sim-page/stroke-adapter.ts:11-13` (`BrushControllerDeps`, `newOpId` from `brush/ids`, `PlanOp` from `plan`); `stroke-preview.ts:11` (`PlanOp`); `brush-tools.svelte.ts:6-7` (`BrushTool` from `brush/sampler`, `BrushState`); `brush-summary.ts:8` (`paint/rows`); `policy.ts:23` (`plan/constants` `STORIES_MAX/MIN`); `lid-request.ts:9` (`plan/geometry`); `sim-doc.ts:21` and `timeline/sim-doc4.ts:17-30` (`$lib/plan`: `OPS_MAX, PATH_MAX_POINTS, RADIUS_*, SF_BBOX, quantize, MAX_PLAN_BYTES, FUTURE_SCHEMA_MESSAGE...`). Total `$lib/plan` import lines in scope (incl. tests) 10, `plan/constants` 3, `plan/geometry` 2 (grep counts; full file:line list for non-test files not exhaustively enumerated for `$lib/plan`).
- `/sim` creates a `BrushState({storage: null, fine: false})` so `/`'s saved brush settings are untouched (V SimPage.svelte:500).
- Stroke -> document: `createStrokeAdapter` (SimPage.svelte:557) turns BrushController stroke ops into `CustomBrush` strokes via `paintLens.apply` (the span lens), not into a plan op sent to a worker (stroke-adapter.ts:1-4 comment, :78 `readOnly: false`).
- A stroke's lots: `api.resolveBrush(query)` via PolicySync; preview `api.previewBuildings`, outlines `api.lotOutlines`, lids `api.heightLids`, selection `api.lotAt` (TimelineClientApi at TimelineMode.svelte:1112-1119).

Map interactions: Move tool tap opens a project card, a tap on a lot with none asks the worker which policy sets its limit and selects that policy's span (`selectAt`, SimPage.svelte:~866-880); `limitsViewOf` chooses `rule | fzp | paint` limit view (selection.ts, used SimPage:~736).

---

## 9. Publish from `/sim`, and `/s/[id]`

### 9.1 Steps (edit mode)
1. Header button `PublishButton` is built in SimPage `actions` snippet only `{#if !readonly}` and `{#if codec}` (codec exists once the calibration is known): props `{codec, doc, lastPublished: autosave?.lastPublished, onpublished, fetchFn}` (SimPage.svelte:1086-1094).
2. `PublishButton` (`sharing/PublishButton.svelte`): disabled-by-aria while the doc is empty (`codec.isEmpty(doc)` = `nothingInForce(d.policy)`, sim-doc4.ts:315); reads "Share link" when the SHA-256 of `serialize(publishable(doc))` equals `lastPublished.hash`, else "Publish" (:34-37,:72-86); opens `PublishDialog`.
3. `PublishDialog`: title field, `publishDoc(codec, payload, {fetchFn})` (`sharing/PublishDialog.svelte:141`).
4. API call: `fetch(codec.api, {method: 'POST', headers: {'content-type':'application/json'}, body: codec.serialize(doc), signal})` where `codec.api = '/api/policies'` for sim (V `sharing/publish-client.ts:66-71`, `timeline/sim-doc4.ts:301`). Server: `routes/api/policies/+server.ts:5` `POST = handlePublish(event, CODECS.sim)`; `server/sharing/publish.ts:64` rate-limited by IP (`PUBLISH_RL`), dedups by content hash (`findPlanByHash`, :109 -> 200 `{id}`), inserts new row (:123-125 -> 201 `{id}` + `Location: /s/<id>`). No account/user check (grep of publish.ts for `locals`/`user` returned nothing). Timeout/abort handling and error codes (`too_large`, `too_many_ops`, `unknown_dataset_version`, `invalid_plan`, `rate_limited` with countdown) in `publish-client.ts`/`PublishDialog`.
5. Success: dialog shows link `/s/<id>` (Copy link, Share), calls `onpublished({id, hash, plan})`; SimPage `onPublished` takes the title and calls `autosave.setLastPublished({id, hash}, codec.withTitle(doc, r.plan.title))` (SimPage.svelte:~322-329).

### 9.2 `/s/[id]` load and render
- Server: `loadSharedDoc(SIM_SERVER_CODEC4, {id, platform, current})` (`+page.server.ts:9-13`): bad id/missing -> 404, row of the other kind -> 308 redirect to `/p/<id>`, unparsable -> 500 (`server/sharing/shared-page.ts:46-64`, header comment); returns `{id, doc, createdAt, currentDatasetVersion, datasetNotice: 'none'|'remix'|'gone', upgradedFrom?}`; header `private, max-age=300`.
- Universal load: `loadSimScenario(data.doc.datasetVersion, data.currentDatasetVersion, fetch)` (falls back to current manifest if gone, I16); with calibration present `openShared(text, {asOf, calibration}, upgradedFrom)`; failure -> `error(500, copyFor('sim').unparsable)`; returns `{...data, ...scenario, datasetVersion, opened}` (`+page.ts:15-31`).
- Render: `<h1 class=sr-only>`, `SharedBanner` (title, id, createdAt, datasetNotice, planVersion, currentVersion, `kind="sim"`, `confirmText`, `onremix`), then `SimRoute mode="view" persist="off" initialText opened upgradedFrom` (`+page.svelte:63-86`). The view is the full timeline page with every edit control hidden (section 4); header score, Details, Activity, chart, playhead and map cards still work; no autosave, no Publish, no save-state, no Undo.

### 9.3 Opening a published policy for editing (Remix)
- `SharedBanner` shows "Remix" (`onclick={startRemix}`) and a link "Start your own" (`copy.startHref`); when the dataset notice is `'remix'`, "Open with current data" (V `sharing/SharedBanner.svelte:83,84,90`).
- `startRemix` first asks `confirmText()`: returns `SIM.remixConfirm(0)` only when a local document with something in force exists (`/s/[id]/+page.svelte:28-32`, `localDoc(getStorage(), SIM_SERVER_CODEC4)` + `isEmpty`).
- `remix()` (:37-56): with a calibration and `data.opened`, `remixToLocal(opened.doc, currentDatasetVersion, getStorage(), now, createSimCodec4(...))` writes the rebased doc to `sfhousing:sim:v2` (`sharing/remix.ts:28-45`; a corrupt/future local record is preserved first); the hand-off `{from, upgradedFrom}` (or with `doc: planText` if the write failed, or `doc: data.doc.text` with no calibration) goes via `goto('/sim', {state: {sfhSimRemix: handoff}})`.
- `/sim` reads `page.state.sfhSimRemix` (`routes/sim/+page.svelte:14`) -> `SimPage.remix` -> `restoreSim4(..., remix)` adds the Remix toast `SIM.remixedToast(from)` (session4.ts:~170-171); `dropHandoff` clears history state with `replaceState('', {})` after mount (SimPage.svelte:~211-217, :262-264, 1006-1010). Type in `app.d.ts:30`.

---

## 10. Members/accounts on the page

Grep of scope (including tests and hosts) for `from '$lib/(members|sim-sync|sim-store|sim-log|account)'` and `$lib/(members|...)`: no matches. (`lib/members/` contains only `copy.ts`, V `ls`; `lib/account/` exists and is not imported.) No roster, invite button, tab-claim notices, or role UI in scope. Closest identity-related things:

- `sim-page/test/SimPageHost.svelte:4-5,17`: `headerUser` prop signs the real `SiteHeader` in (the header's account entry is `lib/shell`, out of scope); route `routes/s/[id]/test/PageHost.svelte` uses `SiteHeader` too.
- Save state is a local-storage state (`SaveStatus = 'saved'|'saving'|'off'`, `sharing/autosave.svelte.ts:14`), not a sync state. `SaveIndicator` renders it (SimPage.svelte:1056-1059).
- Publish is anonymous and IP-rate-limited (section 9.1).
- I: `CLAUDE.md` says the `SIM` Durable Object, `sim-sync` etc. exist in the app; none is wired to `/sim` (no import found).

---

## 11. Autosave, save-state cell, "Autosave off", storage keys

- Autosave class: `sharing/autosave.svelte.ts` (`Autosave<D>`; `status = $state<SaveStatus>`; debounce 500 ms default :55, `writable` guard :41-50). SimPage constructs it only when `persistMode !== 'off'` and no shared doc, with `currentVersion: datasetVersion`, `codec: createSimCodec4(d)`, `storage`, `writable: x => simDoc4Problems(x).length === 0` (SimPage.svelte:242-250).
- Writes: `$effect` on `doc` calls `a.schedule(d)` once `saving` true (SimPage.svelte:309-317) (undo/redo and title included). `detach = a.attach()` on mount (:~989).
- Save-state cell: `saveState(covered)` snippet = `<SaveIndicator status={autosave.status} {covered} align="start">` only if `autosave` (SimPage.svelte:1056-1059), passed as TimelineMode `status` (undefined in view) -> header status slot (`TimelineMode.svelte:1380-1411` `statusSlot`). "Updating" (`UPDATING`, `STALE_NOTE`/`WAITING_NOTE` via `Explain`) shares one cell with it and covers it when `!saveOff && shownStatus !== null`; `saveOff = autosave?.status === 'off'` (SimPage.svelte:1171) puts "Updating" beside it instead (TimelineMode.svelte:~600-602,:1382-1385).
- "Autosave off": status `'off'` when a write fails or the doc is not `writable` (over stroke/size limits: such a change cancels the pending write, Autosave constructor comment :41-47); `SaveIndicator` announces `COPY.autosaveOff` / "Autosave on" and opens a popover when off (`SaveIndicator.svelte:14-39`).
- Storage keys used by scope (V):
  | Key | Where | Content |
  |---|---|---|
  | `sfhousing:sim:v2` | `timeline/sim-doc4.ts:36` | `LocalPlanRecord {v:1, savedAt, plan: string, lastPublished?: {id, hash}}` (`sharing/storage.ts:7-12`) |
  | `sfhousing:sim:v1` | `sim-page/sim-doc.ts:42` | schema-3 record; read once and migrated to v2; the v1 record is left in place (sim-doc4.ts:338-360) |
  | `sfhousing:sim:corrupt:<ISO>` | `sim-doc4.ts:304`, `server-codec.ts:100` | preserved copy of an unreadable/future record |
  | `sfhousing:view` | `lib/view/prefs.ts:14` (read/written by SimPage.svelte:711,721) | `{transitStops, transitAccess, heightLimits}`; default `heightLimits: true`, stops/access false |
  | `history.state.sfhSimRemix` | `app.d.ts:30` | Remix hand-off (cleared after load) |
- No `sessionStorage`/`indexedDB` use in scope (grep: none outside tests).

---

## 12. The timeline

### 12.1 Tracks (rows), top to bottom (V `Timeline.svelte` header :2-9, rows)
1. Playhead row (transport in the label column, ruler/slider in the lane column).
2. Chart row (`ChartRow`): homes-from-today line; with a policy in force a "current law" line and shaded gap; goal step (Homes lens only). Lenses `homes | source | effect` (`chart-lens.ts`; "effect" only while in force, SimDetails.svelte:~102-105).
3. Zoning, Permitting, Public money (only `hasMoney(cal)`), each a `KindRow`: its fixed baseline row ("Current law"/"Current timelines"/"Current funding") plus one `PolicyRow` per policy with a `SpanBar` per span; closed kinds show counts. "The world"/"Market conditions": a fixed row (`Timeline.svelte:299-302`).
4. From md kinds open in place; below md tapping a kind opens a sheet (Timeline.svelte header).

### 12.2 Ruler and the three zones (V Playhead.svelte:1-12,:226-264)
`zone shown` (today to the playhead's day), `zone seen` (day to `reached`), `zone unseen` (past `reached`), plus thumb, date flag, and (when `goalDeadline !== null`) the "Goal" flag. `reached` is the furthest date the playhead has reached under the current rules (`reveal.reached`, init `asOf`, `Reveal` type at `reveal.ts:12-22`). `moved(reveal, d)` = `max(reached, d)` and clears `playFrom` (reveal.ts:33-37).

### 12.3 Play / Play from / Replay
- Props: `end` = computed edge (`filledEnd`, the last day the forecast fills), `last` = last day of last calendar month row (`lastDay`), `playFrom: Day|null` (Playhead.svelte:25-41).
- `toggle()`: if playing -> pause; if `playFrom !== null` -> `setDay(clampDay(playFrom, asOf, end))`, else if `atLast` -> `setDay(asOf)` (Replay); then `playing = true` (V Playhead.svelte:139-147). Label from `playLabel({playing, playFrom, atLast})` (playhead.ts; "Play from {year}" per `playFromText`).
- Playback loop: rAF; at `end` before `last` waits (`playing` stays true) and continues when `end` grows; at `last`, `playing = false` (Playhead.svelte:105-135). Speed toggle 1x / 3x (`'year' | 'threeYears'`, `DEFAULT_SPEED` from `fzp/playback`). Today button jumps to `asOf`. Keys: Left/Right month, PageUp/Down year, Home = asOf, End = `end` (`playhead.ts:keyTarget`).
- Space plays/pauses anywhere unless in a field, modal, popover, or while a paint tool is chosen (`spacePlays`, `isPlayKey`, TimelineMode.svelte:~744-775).
- `playFromDay` = first changed month's start after an edit, clamped into today..`filledEnd` (TimelineMode.svelte:~1196-1200).

### 12.4 What an edit / "going again" does to state (V TimelineMode.svelte:1166-1181)
On a new `policy` object (not equal to `seenPolicy`): `heldDoc = hold(session)`; `session.edited()` (marks stale at once); `reveal = editedReveal(reveal, seen)` (starts searching for the first month the new view differs from what was seen); `playing = false`. The numbers on show stay the old view, dimmed ("stale", "Updating"), until the refill answers. `scanned(...)` runs once the edit is answered: sets `reached = max(day, months[k])` and `playFrom = playing ? null : k` for the first changed month `k` (reveal.ts:60-80); months the playhead never saw cannot be compared and count as changed. No rewind happens automatically: `day` is not reset by an edit (day only moves via `Playhead`, `retryLoad` resets it to `asOf` after a new calibration, :~1232-1240, `SimPage.onCalibration` :331-335). `reached` is never lowered except by `revealOpen` on `retryLoad`.
Provisional open: a restored doc with painted/transit zoning opens without them until lots resolve (`provisionalOf`, session.svelte.ts:113-119); headline null ("calculating") while provisional.

### 12.5 How far the timeline runs
`WINDOW_MONTHS = 480` model months ("40 years") from the dataset date: `windowEnd = monthLastDay(asOf, WINDOW_MONTHS)` (TimelineMode.svelte:~382; `sim/world/months.ts:19-21`). The ruler spans `[asOf, windowEnd]` (Playhead `span`, :69). Goal deadline is the last whole calendar month inside it (`windowHorizon`). The worker's `open` is called with `months: WINDOW_MONTHS` (`sim/timeline-client.ts:112-113`). Hard-coded 2066 in funding editors: section 6. For fixture-0 the goal reads "Sep 2066" (docs/dev/timeline-ui.md:36); whether `windowEnd` equals the funding editors' Dec 2066 for live data was not computed (I).

---

## 13. State that persists between visits

| What | Where | Written by |
|---|---|---|
| The working policy document (+ title, `lastPublished {id,hash}`) | `localStorage['sfhousing:sim:v2']` | `Autosave` (edit mode only) |
| Map layer toggles | `localStorage['sfhousing:view']` (shared with `/`) | `setView` -> `writeViewPrefs` (SimPage.svelte:719-722) |
| Legacy schema-3 record | `localStorage['sfhousing:sim:v1']` (left in place) | migration reads only |
| Corrupt-record copies | `localStorage['sfhousing:sim:corrupt:<ISO>']` | `preserveCorrupt` |
| Remix hand-off | `history.state.sfhSimRemix` (cleared after load) | `/s/[id]` `goto` |
Not persisted (page memory only, V): playhead `day`/`playing`/`speed`, `reveal.reached`, selection, open panel, funding drafts, goal notice dismissals, selected paint area, brush settings (`BrushState storage:null`). The goal is not stored. There is no level/progress state anywhere in scope.

---

## 14. Header actions registered

Only one call: `useHeaderActions(headerActions, { pinned: scoreBar, status: statusSlot })` at `timeline/TimelineMode.svelte:1369`. Registered during TimelineMode init; the shell's slot is `provideHeaderActions()` (V `shell/header-actions.svelte.ts:12-17,33-54`).

- `current` (actions) = `headerActions` snippet (TimelineMode:1373-1377): `{#if !noScenario} {@render actions?.()}` where `actions` is SimPage's snippet (SimPage.svelte:1063-1095), contents in order:
  1. "Stop painting" / "Stop erasing" button when `toolOff` (from md, tool != move and tools not shown in the editor).
  2. `{#if !readonly}`: `HistoryButtons` only while `pointer.touch` (coarse pointer); `PublishButton` when `codec` exists ("Publish" / "Share link").
- `pinned` = `scoreBar`: `TimelineHeaderScore` (headline) when `session && calibration`.
- `status` = `statusSlot`: SimPage `saveState` (SaveIndicator, edit mode with autosave) + "Updating".
Layer switches are not header actions (they go in the map toolbar's Layers panel via `layers={layerSwitches}`, SimPage.svelte:1051-1053; TimelineMode:1636-1648).

In view mode the actions snippet renders nothing unless `toolOff` (false in view since it needs `!readonly`), the pinned score remains, status undefined. I.

---

## 15. Test hosts and fakes

| File | Fakes / hosts |
|---|---|
| `routes/sim/test/SimPageHost.svelte` | the `/sim` page with `provideHeaderActions()` slots (`header-status`, `header-pinned`, `header-actions` testids) beside it |
| `routes/s/[id]/test/PageHost.svelte` | the `/s/[id]` page under the real `SiteHeader` wired like the root layout (`routeId="/s/[id]"`) |
| `lib/sim-page/test/SimPageHost.svelte` | SimPage under real `SiteHeader`; in-memory `MemoryStorage` (`sharing/fixtures/memory-storage`) unless a test passes `storage`; `headerUser` signs in the header |
| `lib/sim-page/test/FundingTabHost.svelte` (55), `TransitTabHost.svelte` (36), `TransitLayerRowHost.svelte` (52) | hosts for FundingTab / TransitTab (dead component) / TransitLayerRow (not opened) |
| `lib/sim-page/test/catalog.ts` (28) | `testCatalog(over)`: small `BrushCatalog` for forms/sections |
| `lib/sim-page/test/funding.ts` (105) | funding test values (not opened beyond head) |
| `lib/sim-page/fixtures/schema2/{default-record,painted,profile,tampered}.json` | schema-2 records for the upgrade path (not opened) |
| `lib/timeline/test/fake-timeline-worker.ts` (101) | `FakeTimelineWorker implements ScenarioWorkerLike`: records `posts: TimelineHostRequest[]`, `emit(response)`, `crash()`; message builders over `fixtures.ts` |
| `lib/timeline/test/fixtures.ts` (125) | hand-built `statics(...)`, series chunks (test values) |
| `lib/timeline/test/TimelineModeHost.svelte` (120) | TimelineMode under real `SiteHeader`, owns `policy`, `lots`, `lotsFailed`, selection; `ctl` to drive them; `readonly`, `regionHeight`, `saveStatus`, `saveOff` seams (V header :2-10) |
| `lib/timeline/test/{TimelineHost, PlayheadHost, InspectorHost, ExplainHost, SimDetailsHost, SimKeyControlHost}.svelte` | per-component hosts (headers not opened except as listed) |
| `lib/timeline/test/plus.ts` (7), `pointer.ts` (35) | `PLUS_NAME` regexes for the "+" accessible names (depend on `EMPTY_LANE` wording, `rows.ts:55-59`); a real-pointer hover helper |
| `lib/dock/test/DockHost.svelte` (59) | Dock in a `.sfh-dock-host` region (stale comment "as /sim lays it out") |
| Test seams on the components themselves | `SimPage` props `storage`, `fetchFn`, `timers`; `TimelineMode` props `createWorker`, `goal`, `statusMs`, `fetchPlaces`; `Playhead` `raf`/`cancelRaf` |

Things other work would have to keep in step (I): `PLUS_NAME`/`EMPTY_LANE` wording; `data-testid`s used by hosts (`tl-mode`, `tl-dock`, `tl-inspector`, `tl-lanes`, `tl-status`, `score-bar`, `tl-goal`...); `SimPageHost`'s `MemoryStorage`; `FakeTimelineWorker` message shapes (`TimelineHostRequest/Response` in `sim/timeline-protocol`).

---

## Doc/code contradictions

1. `docs/dev/timeline-ui.md:25` says `WINDOW_MONTHS = 480` months "from the dataset date's year"; code measures from the dataset date: `monthLastDay(asOf, 480) = asOf + floor(480 * MONTH_DAYS)` (V `sim/world/months.ts:19-21`, `TimelineMode.svelte:~382`). Minor wording.
2. `lib/dock/test/DockHost.svelte:2` comment ("as /sim lays it out") vs code and `docs/dev/sim-page.md:3`: /sim no longer mounts the dock.
3. Stale examples in code comments still show the RHNA Jan 2031 deadline: `timeline/copy.ts:68,76`, `timeline/outcome.ts:66`; the goal's deadline is now the window end (V `goal/goal.ts:72`; `docs/dev/timeline-ui.md:36` already says Sep 2066).
4. `docs/dev/sim-page.md:43` describes the schema-3 twin (`compare` `'preFzp'` when default policy); the page itself never reads `view.compare` (V `timeline/results.ts:96-98`); `compileLevers`/`compare` are only reached by `sim/world/policy/{limits,combine}.ts`, and `scoreCopy` with a faked `{compare:'fzp'}` in `TimelineMode.svelte:73-77`. (Doc describes an older layer; not a behavioural contradiction.)
5. `docs/dev/sim-timers.md:73-80` describes Save and "Revert to saved" as live behaviour; the same file :69-71 and code (`PermittingSection ... snapshot={false}`) say /sim has none. Internal to the doc; code agrees with :69-71.
6. Code comment `Inspector.svelte`/`lens.ts` talk about "today's editors"; `sim-page/TransitTab.svelte` (165 lines, with a 302-line spec) is imported by no non-test file (dead in app), while `docs/dev/sim-page.md` "older sections" still describe it.

---

## Appendix

### Files read in full
`routes/sim/+page.svelte`, `routes/sim/+page.ts`, `routes/s/[id]/+page.server.ts`, `+page.svelte`, `+page.ts`, `routes/sim/test/SimPageHost.svelte`, `routes/s/[id]/test/PageHost.svelte`, `lib/sim-page/SimRoute.svelte`, `load.ts`, `SimPage.svelte`, `PermittingSection.svelte`, `funding-drafts.svelte.ts`, `test/SimPageHost.svelte`, `timeline/policy4.ts`, `outcome.ts`, `results.ts`, `Inspector.svelte`, `WhatEditor.svelte`, `AddMenu.svelte`, `owner.ts`, `pool-level.ts` (1-66, 155-217; mid-section 66-155 not read), `session4.ts`, `SimDetails.svelte`, `TimelineHeaderScore.svelte`, `Timeline` header only (see partial), `lib/goal/goal.ts` and `lib/goal/GoalRow.svelte` (out of scope, read for item 5).

### Files read in part (line ranges)
- `lib/timeline/TimelineMode.svelte` 100-1846 (1-99 not read: imports above the first lines).
- `lib/timeline/Playhead.svelte` 1-330 (styles 330-521 not read).
- `lib/timeline/WhenEditor.svelte` 1-140 (template 140-252 not read).
- `lib/timeline/Timeline.svelte` 1-120; grep for `readonly/onedit`.
- `lib/timeline/KindRow.svelte` 60-110; `SpanBar.svelte` 1-20, 95-160; `PolicyRow`/`FixedRow`/`Lane`/`LevelFill` grep only.
- `lib/timeline/lens.ts` 1-130, 211-342 (130-211 not read: `readTiming`, `readFund`, `documentIds`).
- `lib/timeline/add.ts` 1-120 (`addPolicy` body 223-247 not read).
- `lib/timeline/sim-doc4.ts` 1-120, 296-361 (parse/serialize/open 120-296 not read).
- `lib/timeline/session.svelte.ts` 1-60, 100-330 (330-671 not read).
- `lib/timeline/policy-sync.svelte.ts` 1-60.
- `lib/timeline/reveal.ts` 1-80; `playhead.ts` 1-60; `rows.ts` 25-75; `activity-view.ts` 1-151; `SimActivity.svelte` 1-60, 60-172; `lib/timeline/copy.ts` first lines only.
- `lib/sim-page/policy.ts` 25-135; `policy-store.svelte.ts` 1-80; `FundingTab.svelte` 1-420 (420-694 not read); `FundingGroupEditor/FundingPoolRow/ProgrammeEditor/ProgrammeList/AddMoney/MarketTerms` header comments + props only; `RouteTimeline.svelte` 1-30 + grep; `timing.ts` 1-215, 340-395; `timing-sources.ts` 205-252; `funding-edit.ts` 855-900 + export list; `funding-presets.ts` 30-160 + grep; `funding-view.ts` export list; `funding-copy.ts` 140-180, 325-358; `SimNotices.svelte` 1-40; `lib/dock/Dock.svelte` 1-60; `dock-state.svelte.ts` 1-30.
- Outside scope but opened for items 9-11: `lib/sharing/{PublishButton.svelte, PublishDialog.svelte 100-200, publish-client.ts 55-100, doc-codec.ts 15-60, remix.ts 1-70, autosave.svelte.ts 1-80, SaveIndicator.svelte 1-50, storage.ts head}`, `lib/view/prefs.ts 1-60`, `lib/server/sharing/{shared-page.ts 1-60, publish.ts grep}`, `routes/api/policies/+server.ts`, `lib/sim/timeline-client.ts 20-140`, `lib/sim/world/months.ts 1-40`, `lib/shell/header-actions.svelte.ts` (grep).
- `docs/dev/{sim-page.md, timeline-ui.md, sim-timers.md}`: grep lines only.

### Dirs listed
`lib/sim-page`, `lib/sim-page/test`, `lib/sim-page/fixtures`, `lib/sim-page/fixtures/schema2`, `lib/timeline`, `lib/timeline/test`, `lib/dock`, `lib/dock/test`, `routes/sim`, `routes/sim/test`, `routes/s/[id]`, `routes/s/[id]/test`, `lib` (top level), `lib/sharing`, `lib/server/sharing`, `routes/api/policies`, `lib/goal`, `lib/members`, `lib/account`.

### NOT examined (in scope)
- All `*.spec.ts` / `*.svelte.spec.ts` bodies (only line counts taken).
- Source files opened only by name/grep, role marked I: `reconcile.ts`, `funding-reconcile.ts`, `funding-sources.ts`, `sim-session.ts`, `sim-doc.ts` (body), `transit-edit.ts`, `ProtectionsSection.svelte` (body), `TransitLayerRow.svelte` (body), `TransitTab.svelte` (body), `PolicySummary.svelte`, `SourceList.svelte`, `selection.ts`, `brush-tools.svelte.ts`, `brush-summary.ts`, `stroke-adapter.ts` (only head), `stroke-preview.ts`, `feedback.ts`, `lid-request.ts`, `outline-request.ts`, `debug.ts`.
- `lib/timeline`: `parse4.ts`, `reconcile4.ts`, `upgrade.ts`, `server-codec.ts`, `fill.ts`, `chunk-log.ts`, `chart-model.ts`, `ChartRow.svelte` (body), `ChartLegend.svelte`, `SimKey.svelte`, `Explain.svelte`, `FixedRow.svelte`, `Lane.svelte`, `LevelFill.svelte`, `SpanBar.svelte` template, `spans.ts` bodies (only export list), `details.ts`, `activity.ts`, `places.ts`, `key.ts`, `address.ts`, `axis.ts`, `shortcuts.ts`, `copy.ts` (most), `FundingTab.svelte` 420-694, `lens.ts` 130-211, `session.svelte.ts` 330-671, `sim-doc4.ts` 120-296.
- `lib/dock/Dock.svelte` 60-403, `icons.ts`.
- Test hosts' bodies other than those quoted: `FundingTabHost`, `TransitTabHost`, `TransitLayerRowHost`, `InspectorHost`, `PlayheadHost`, `TimelineHost`, `ExplainHost`, `SimDetailsHost`, `SimKeyControlHost`, `TimelineModeHost` (header only), `DockHost` (head), `funding.ts`, fixtures JSON.
- Outside scope and not opened (so statements about them are I): `fzp/MoneyResults.svelte`, `fzp/ProjectCardPanel`, `paint/PaintTab`, `brush/BrushController`, `sharing/SharedBanner.svelte` (grep only), `shell/SiteHeader`, `sim/levers/finance` (`FINANCE_LIMITS` values taken from copy text), the worker side of `setPolicy`.
- The full file:line list of every `$lib/plan` import in non-test scope files (only counts and the first ones listed).
- Whether live-data `windowEnd` equals Dec 2066 (funding editors' hard-coded bound); not computed.
