# Survey: the policy levers as they exist today

Read-only extraction, 2026-11-24, branch `worktree-incremental-feel`. All paths are relative to
`/Users/mindlace/Projects/sfhousing/.claude/worktrees/incremental-feel/`.

Marks: **V** = verified at a file:line I read. **I** = inferred (arithmetic on verified code, or a
doc's statement I did not check in code). Where a doc and the code disagree, both are given under
"Doc against code" (section K).

Scope note: the brief names "src/lib/brush (the stop types in brushes.ts)". `src/lib/brush/` has no
`brushes.ts` (V: directory listing). The stop types are in `src/lib/sim/levers/brushes.ts:13`.

---

## A. The schema 4 policy document

### A1. Types as written (`src/lib/timeline/policy4.ts`)

```ts
export type Selector =                                         // :17-24
  | { tag: 'transit'; stopTypes: StopType[] }
  | { tag: 'painted' }
  | { tag: 'category'; category: 'rentControl' | 'historic' | 'newerThan' }
  | { tag: 'routes' }
  | { tag: 'baseline' }
  | { tag: 'fund'; pool: string }
  | { tag: 'terms' };

export type Effect =                                           // :26-33
  | { tag: 'bands'; bands: TransitBand[] }
  | { tag: 'brushes'; brushes: CustomBrush[] }
  | { tag: 'protect'; years: number | null }
  | { tag: 'timing'; set: TimingSet }
  | { tag: 'scales'; entries: { pool: string; from: Day; scale: number }[] }
  | { tag: 'fund'; pool: Pool | null; programmes: Programme[] }
  | { tag: 'terms'; terms: Partial<Record<TermKey, number>> };

export interface Span { from: Day; to: Day | null; what: Effect; }   // :35-39

export interface Policy {                                      // :41-48
  id: string; label: string; preset: string | null; on: boolean;
  where: Selector; spans: Span[];
}

export interface SimPolicy4 {                                  // :50-53
  schema: 4;
  kinds: { zoning: Policy[]; permitting: Policy[]; money: Policy[] };
}
export type PolicyKind = keyof SimPolicy4['kinds'];            // :55
```

- V. Version field: `schema: 4` on the policy (`policy4.ts:51`) and again on the envelope
  `SimDoc4 { schema: 4; kind: 'sim'; datasetVersion: string; title?: string; policy: SimPolicy4 }`
  (`src/lib/timeline/sim-doc4.ts:38-44`). `SIM_DOC4_SCHEMA = 4` (`sim-doc4.ts:34`).
- V. Default: `DEFAULT_POLICY4 = { schema: 4, kinds: { zoning: [], permitting: [], money: [] } }`
  (`policy4.ts:58-61`), described as "the plan as adopted, observed timing, today's City funding"
  (`policy4.ts:57`).
- V. There are three kinds only. Market terms are a `money` policy (`where.tag: 'terms'`), not a
  fourth kind. "Market conditions" is a fixed, read-only timeline row with no policy behind it
  (`src/lib/timeline/rows.ts:13-33`, `:61`).
- V. `Day` is days since 1970-01-01; a span has a start day and an inclusive end day or null
  (`policy4.ts:35-39`; inclusive end: `spanAt`, `policy4.ts:88-91`).

### A2. Selector and effect pairs (enforced)

V (`src/lib/timeline/parse4.ts:26-39`):

| Kind | `where.tag` allowed | `what.tag` required |
| --- | --- | --- |
| zoning | `transit`, `painted`, `category` | `bands`, `brushes`, `protect` |
| permitting | `routes` | `timing` |
| money | `baseline`, `fund`, `terms` | `scales`, `fund`, `terms` |

### A3. Validation (`parsePolicy4`, `parse4.ts:366-396`)

- V. Strict keys everywhere: unknown key and missing key both fail (`rec`, `parse4.ts:48-55`).
- V. `schema` must be 4 (`parse4.ts:370-372`); `kinds` must hold exactly the three lists
  (`parse4.ts:374`, `:25`).
- V. Policy keys: `id`, `label`, `preset`, `on`, `where`, `spans` (`parse4.ts:256`).
  - `id`: string of 1 to 80 characters, unique across all three kinds (`parse4.ts:257-261`, `LABEL_MAX = 80` at `:22`).
  - `label`: string of at most 80 characters; empty is accepted (`parse4.ts:262-264`).
  - `on`: boolean, required (`parse4.ts:265`).
  - `preset`: permitting, a non-empty string (`:269-272`) that must equal each span's `what.set.preset` (`:300-301`); money, null or a string of 1 to 60 characters (`MONEY_PRESET_MAX = 60`, `:24`, `:273-283`); zoning, must be null (`:284-287`).
- V. Spans (`checkSpanDays`, `parse4.ts:217-240`): `from`/`to` are whole days from `FIRST_DAY` 10957 to `LAST_DAY` 47482 (`parse4.ts:73-77`; values at `src/lib/sim/levers/finance.ts:33-34`, 2000-01-01 and 2100-01-01); `to >= from`; with a dataset date, `from` is after `asOf` and is the first day of a model month, `to` the last day of one; spans ascending, not overlapping, none after an open-ended one. `asOf: null` skips only the month alignment (`parse4.ts:226`, `:364`).
- V. An empty `spans` list parses (no minimum; `parse4.ts:289-313`). An on policy with no span counts as not in force (`nothingInForce`, `policy4.ts:94-98`).
- V. Every `what` goes through the schema 3 parser of its field (`parse4.ts:131-211`): `parseRule`, `parseCustom`, `parseTimingSet`, `parseFinanceLevers`.
- V. Fund policies: every span names the same pool id and the same programme ids (`checkFundSpan`, `parse4.ts:317-360`); a fund with no added pool must name a baseline pool id (no `u-` prefix) and its programmes must pay from that pool (`:326-338`); pool id pattern `^[a-z0-9][a-z0-9-]{0,39}$` (`:41`, `:122`).
- V. Timing layer mode: `presetLayer: 'strict'` (default) re-checks the preset layer; `'reconcile'` leaves it to the caller (`parse4.ts:381`; `src/lib/sim-page/policy.ts:265-295`).
- V. Strict publish also refuses a programme needing a term nothing sources (`sim-doc4.ts:169-177`).

### A4. Size limits

| Limit | Value | Where |
| --- | --- | --- |
| Canonical document bytes | `MAX_PLAN_BYTES` = 262,144 (256 KB) | V `sim-doc4.ts:111-112`; `src/lib/plan/constants.ts:9` |
| Strokes over the document | `OPS_MAX` = 5000 | V `sim-doc4.ts:80-85`; `constants.ts:8` |
| Stroke radius | integer 5 to 500 m | V `sim-doc4.ts:89-94`; `constants.ts:5-6` |
| Points per stroke path | 1 to 2000 | V `sim-doc4.ts:95-102`; `constants.ts:7` |
| Stroke points | inside `SF_BBOX` | V `sim-doc4.ts:103-108` |
| Title | at most 120 characters | V `sim-doc4.ts:157-158`; `constants.ts:10` |
| Added pools over the document | 12 | V `parse4.ts:389-390`; `finance.ts:24` |
| Added programmes over the document | 24 | V `parse4.ts:391-392`; `finance.ts:26` |
| Scale entries (distinct pool + day) over the document | 24 | V `parse4.ts:393-394`; `finance.ts:27` |
| Inflows per pool | 1 to 12 | V `finance.ts:25`, `:130-131` |
| Finance labels / ids | 1 to 80 chars / at most 40 chars | V `finance.ts:28-29`, `:40`, `:68-73` |
| Problems reported | first 20 | V `sim-doc4.ts:54`, `:78` |

- V. There is no limit on the number of policies or of spans per policy, other than the byte size (no such check in `parse4.ts` or `sim-doc4.ts`).
- V. Off policies count toward every limit: strokes (`sim-doc4.ts:57`), ids and finance limits (`parse4.ts:375-394` do not read `on`).
- V. The editable window is model months 1 to `WINDOW_MONTHS` = 480 (`src/lib/sim/timeline-client.ts:29`; `src/lib/timeline/spans.ts:18-22`).

---

## B. Each kind of policy item: shape, defaults, limits, and what "+" offers

"+" is `addChoices(kind, cal, doc, allowed)` (`src/lib/timeline/add.ts:68-116`). V for all of this
subsection unless marked.

Common to every add (`addPolicy`, `add.ts:230-259`): the new policy is `on: true` (`:149`,
`upgrade.ts:27`), has one span from the first day of the playhead's month (clamped to 1..480) with
`to: null` (`:235-248`), is appended to the end of its kind's list (`:256`), and its id is renamed
with `-2`, `-3`, … if taken (`:238-243`).

`addChoices` returns `[]` for a kind not in `allowed.kinds` (`add.ts:74`).

### B1. Zoning: transit rule

- Shape: `where { tag: 'transit', stopTypes: StopType[] }`, `what { tag: 'bands', bands: TransitBand[] }`, `TransitBand { maxM: number; stories: number }` (`policy4.ts:18`, `:27`; `src/lib/sim-page/policy.ts:39-42`).
- "+" label: "Transit rule" (`add.ts:80`). Always offered; any number may be added (no filter on existing ones, `add.ts:79-88`).
- Default as added: `newLayer()`: stop types `['regionalRail', 'metro']`, bands `DEFAULT_BANDS` = `[{maxM: 402, stories: 6}, {maxM: 805, stories: 4}]` (`src/lib/sim-page/transit-edit.ts:26-33`; `policy.ts:75-78`, labelled tier 4, "our judgement"). Policy label "Transit rule" (`upgrade.ts:42`); id from `newOpId()` (`transit-edit.ts:28`).
- Limits: see section D.

### B2. Zoning: painted area

- Shape: `where { tag: 'painted' }`, `what { tag: 'brushes', brushes: CustomBrush[] }`; `CustomBrush` is `{ id, kind: 'paint', strokes, stories }` or `{ id, kind: 'erase', strokes }`; `Stroke { path: [lng, lat][]; radiusM }` (`policy.ts:35-38`, `:49-51`).
- "+" label: "Painted area" (`add.ts:81`). Always offered while zoning is allowed.
- Default as added: id `painted`, label "Painted zoning", `brushes: []` (`add.ts:162-165`).
- Limits: `stories` integer 1 to 80 (`policy.ts:168-172`; `constants.ts:3-4`); brush ids unique within the span (`parse4.ts:149-155`); stroke limits in A4.

### B3. Zoning: protections (three categories)

- Shape: `where { tag: 'category', category }`, `what { tag: 'protect', years }`. `years` must be null for `rentControl` and `historic`, and a positive finite number for `newerThan` (`parse4.ts:158-170`).
- "+" labels (`add.ts:58-62`): "Protect rent-controlled buildings", "Protect historic buildings", "Protect buildings newer than 30 years".
- Availability: each category is offered only while no zoning policy of that category exists in the document, on or off (`add.ts:77-87`).
- Defaults: `newerThan` starts at 30 years (`NEWER_THAN_YEARS`, `add.ts:46`; the editor's `DEFAULT_YEARS = 30`, `src/lib/sim-page/ProtectionsSection.svelte:21`). Ids `protect-rentControl`, `protect-historic`, `protect-newerThan` (`upgrade.ts:61`).
- Limits: the editor takes whole years 1 to 200 (`ProtectionsSection.svelte:22-23`, `:67-76`); the parser takes any positive finite number (`parse4.ts:166-169`).

### B4. Permitting

- Shape: `where { tag: 'routes' }`, `what { tag: 'timing', set: TimingSet }`.

```ts
export interface TimingSet {                    // src/lib/sim-page/timing.ts:175-186
  preset: PresetId;
  presetTimers: TimerEdit[];
  presetRouteShares: Record<Pathway, number> | null;   // whole percents summing to 100, or null = observed
  edits: TimerEdit[];                                  // reach 'all', one per (pathway, stage), editable stages
  routeShares: Record<Pathway, number> | null;         // custom whole percents summing to 100, or null
  localProgramStreamlined: boolean;
}
export interface TimerEdit { pathway: Pathway; stage: TimedStage; scale: number; reach: 'all' | 'new'; }
                                                // src/lib/sim/levers/types.ts:42-47
```

- "+" offers every preset that is `available` and is not `observed`, labelled with the preset's `name`, then "Custom timing" (`add.ts:90-98`; `CUSTOM_TIMING_LABEL`, `src/lib/timeline/lens.ts:21`). Not filtered by what the document holds, so the same preset can be added more than once (`add.ts:90-98`).
- Default as added: a preset is resolved against the calibration (`resolvePreset`, `add.ts:170-171`); "Custom timing" is the observed set with `preset: 'observed'` and label "Custom timing" (`add.ts:174-177`). Id `timing`.
- "SF as observed" is the fixed row "Current timelines", not an addition (`add.ts:92`; `rows.ts:41-45`).
- Limits: scale 0.05 to 10 (`MIN_SCALE`, `MAX_SCALE`, `types.ts:83-84`, `:186-195`); timers only on editable stages, at most one per (pathway, stage) (`policy.ts:297-307`); custom edits must have reach `all` (`policy.ts:279-282`); route shares whole percents summing to 100 (`policy.ts:252-260`). Presets and floors: section C.

### B5. Money: given measures (funding presets)

- "+" offers every `fundingPresets(cal)` entry with `available: true`, labelled with its `label` (`add.ts:101-106`). Nothing is offered when the calibration lacks `market` or `baselineFunding` (`hasMoney`, `add.ts:64-66`, `:100`).
- Shape as added: a preset with a pool becomes a `fund` policy (`where { tag: 'fund', pool: 'u-<presetId>-<n>' }`, `what { tag: 'fund', pool, programmes }`), id `fund-<poolId>` (`upgrade.ts:107-117`); a scale preset becomes a `baseline` policy (`what { tag: 'scales', entries }`), id `baseline` (`upgrade.ts:97-106`). Each gets `preset: <presetId>` and `label: <preset label>` (`add.ts:220-221`).
- Limits: refused with `AddLimitError` past 12 pools, 24 programmes or 24 scale entries over the document (`add.ts:202-212`).
- The list: section E.

### B6. Money: own pool, City funding scale, market terms

- Offered only when `allowed.money !== 'given'` (`add.ts:107-113`): "Your own pool" (`ownPool`, opens a pool draft; added as a `fund` policy when the draft completes, `add.ts:39-43`, `:192-197`), "City funding scale" (a `baseline` policy with `entries: []`, id `baseline`, `add.ts:180-188`), "Market terms" (a `terms` policy with `terms: {}`, id `terms`, `add.ts:189-190`).
- Scale entry: `{ pool, from, scale }`, `pool` a baseline id (no `u-`), `from` a day, `scale` 0 to 10 (`finance.ts:88-96`). The editor's dated change is a percent 0 to 1000, step 5 (`src/lib/sim-page/FundingGroupEditor.svelte:146`, `:236-237`).
- Market terms: five keys, `constructionRate` [0, 0.25], `constructionYears` [0.25, 10], `requiredReturn` [0.01, 0.25], `guaranteeRateCut` [0, 0.05], `lossOnExit` [0, 1] (`src/lib/timelapse/types.ts:286-287`; `src/lib/sim/finance/terms.ts:120-126`; applied by `parseTerms`, `finance.ts:219-235`). I (doc): the editor offers only `guaranteeRateCut`, 0 to 5 points, step 0.05 (`docs/dev/sim-funding.md:146`; parser of the field V at `src/lib/sim-page/funding-edit.ts:153-157`).
- Own pool and programme field bounds (V, `funding-edit.ts`): amount above $0 to $100,000 million (`:100-104`; `MAX_DOLLARS` = 100,000,000,000, `finance.ts:36`); years to repay whole 1 to 40 (`:125-129`); leverage above 0 to 10 (`:132-136`); `minHomes` whole 0 to 10,000 (`:139-143`); income tier whole percent 0 to 100 (`:146-150`); pool name 1 to 48 characters (`:160-164`); percent fields per the comment at `:106-110` (share above 0 to 100, debt rate above 0 to 25, loan rate 0 to 25, lower return 1 to 25, reserve 0 to 100). Starting values: grant share 0.35, loan or guarantee cost share 0.6, reserve 0.1, required return 0.0525, private `minHomes` 10 (`:711-718`); "Your own pool" starts as `generalRevenue` with one yearly row from `nextFiscal(asOf)` and no amount (`:910-919`). Pool kinds: `goBond`, `cop`, `generalRevenue`, `dedicatedTax`, `state`, `federal`, `bank` (`types.ts:241-242`).

### B7. Availability flags, in one place

| Flag | Where | Effect |
| --- | --- | --- |
| `allowed.kinds` | V `add.ts:74` | A kind not in the set offers nothing |
| `allowed.money === 'given'` | V `add.ts:107` | Money offers presets only |
| `hasMoney(cal)` | V `add.ts:64-66`, `:100`; `rows.ts:64-65` | No money menu and no Public money kind without `market` and `baselineFunding` |
| `Preset.available` (permitting) | V `timing.ts:54`, `add.ts:93` | Unavailable presets are not offered |
| `FundingPreset.available` | V `funding-presets.ts:62`, `add.ts:102` | Unavailable presets are not offered |
| Category already present | V `add.ts:77-87` | A protection is offered once |

---

## C. Permitting

### C1. Routes and stages

- V. Routes (`PATHWAYS`): `discretionary`, `streamlined`, `permitOnly` (`src/lib/timelapse/types.ts:34-37`).
- V. Stages: `permitOnly` runs `preApplication, permitFiled, permitIssued, construction, complete`; the other two run the full `STAGE_ORDER` (`types.ts:44-49`). Timed stages a lever may name: `preApplication, filed, entitled, permitFiled, permitIssued` (`src/lib/sim/levers/types.ts:19-26`).
- V. Editable stages: `preApplication`, `filed`, `permitFiled`, `permitIssued` (`timing.ts:154-159`). `entitled` and `construction` are shown and locked, with reasons "Set by the applicant's timing, not by the city" and "Set mostly by the builder, financing and technology" (`timing.ts:170-173`).
- V. Stage labels: Pre-application; Filed to entitled; Entitled to permit filed; Permit review; Permit issued to construction start; Construction (`timing.ts:161-168`).
- I. That gives 11 editable (route, stage) pairs: 4 on discretionary, 4 on streamlined, 3 on permitOnly (no `filed`). A pair exists only when the calibration has a transition table for it (`routeView` skips an absent one, `timing.ts:517-518`).

### C2. Presets (`PRESETS`, `timing.ts:83-149`)

| Id | Name (label) | `reach` | Available | What it sets (`resolvePreset`, `timing.ts:298-343`) | Sources (constants in `src/lib/sim-page/timing-sources.ts`) |
| --- | --- | --- | --- | --- | --- |
| `observed` | "SF as observed" | null | yes (V `:91`) | Nothing: no timers, shares null, Local Program streamlined (V `:193-203`, `:305`) | `OBSERVED_PROVENANCE`, tier 0 (V `timing.ts:59-66`) |
| `sb423Clock` | "SB 423 approval clock" | `new` | `SB423_SMALL_SHARE.value !== null` (V `:104`); the value is 0.7679, so yes (V `timing-sources.ts:113-125`) | One timer `{ streamlined, filed, scale, reach: 'new' }` where `deadline = (90 × share + 180 × (1 − share)) / MONTH_DAYS`, `q = exitMonth(t, 0.9)`, `raw = min(1, deadline / q)`, `scale = withFloor(...)`; no timer when `raw >= 1` or the scale is 1 (V `:308-322`). Route shares stay observed (V `:98-102`) | `SB423_DEADLINE_DAYS` 90 / 180 days, cutoff 150 units, tier 1, Gov. Code § 65913.4(d)(1) (V `timing-sources.ts:96-110`); `SB423_SMALL_SHARE` 0.7679 (43 of 56), tier 0 (V `:113-125`); `SB423_DEADLINE_QUANTILE` 0.9, tier 4, invented (V `:142-153`) |
| `noDiscretionary` | "No discretionary review" | `new` | yes (V `:119`) | `presetRouteShares = { discretionary: 0, streamlined: observed discretionary + observed streamlined, permitOnly: observed }`, whole percents; no timers (V `:323-331`) | `NO_DISCRETIONARY_BASIS`, tier 2, HCD review Required Action 1 (V `timing-sources.ts:168-183`) |
| `ceqaInfill` | "CEQA infill exemption (AB 130 / SB 131, 2025)" | `new` | `CEQA_FILED_RATIO.value !== null` (V `:130`); the value is null, so **no** (V `timing-sources.ts:156-165`) | Nothing (V `:306`); `resolvePreset` throws for it (V `:300-302`) | None; reason text at `timing-sources.ts:158-164` |
| `benchmarkPermits` | "Permits at San Diego's pace" | `all` | yes (V `:141`) | One timer per route that has a `permitFiled` table: `{ pathway, permitFiled, scale: withFloor(134 / 280), reach: 'all' }` (V `:332-340`) | `BENCHMARK_PERMIT_DAYS.sf` 280 and `.sanDiego` 134, both tier 1, BLA "Post-Entitlement Permitting" Exhibit 1 (V `timing-sources.ts:63-90`); `BENCHMARK_RATIO_PROVENANCE`, tier 2 (V `timing.ts:68-77`) |

- I. 134 / 280 = 0.4786 (also stated at `docs/dev/sim-timers.md:50`). The SB 423 deadline is about 3.64 months with today's share; the resulting scale depends on the calibration's `q` and is not a constant.
- V. Every preset keeps `localProgramStreamlined: true` (`policy.ts:320-321`).
- V. `SB423_ROUTE_SHIFT` is unsourced (null), which is why SB 423 keeps observed shares (`timing-sources.ts:128-136`).
- V. What a strict document may hold per preset (`checkPresetLayer`, `policy.ts:316-369`): `observed` no timers, no shares; `noDiscretionary` no timers, shares with discretionary 0; `sb423Clock` only streamlined `filed`, reach `new`, scale at most 1; `benchmarkPermits` only `permitFiled`, reach `all`, scale from 134/280 to 1.

### C3. Floors (`STAGE_FLOORS`, `timing-sources.ts:217-252`)

| Route | Stage | Floor (months) | Source |
| --- | --- | --- | --- |
| all three | `permitFiled` | `days(13 + 15)` = 0.92 | V `:187-200`: tier 2, BLA: median 13 days completeness check plus median 15 days first review |
| discretionary | `filed` | `days(20)` = 0.657 | V `:220-234`: tier 2, Planning Code § 333 handout, notice 20 days before the hearing |
| streamlined | `filed` | none | V `:240-243`: the statute sets only maximums |
| all three | `preApplication` | none | V `:204-208` |
| all three | `permitIssued` | none | V `:209-211` |
| permitOnly | `filed` | no entry (the route has no such stage) | V `:247-251` |

- V. `days(d) = round(d / MONTH_DAYS × 1000) / 1000` (`:185`).
- V. Bounds of a custom stage edit (`stageBounds`, `timing.ts:467-481`): `min = ceilHalf(max(floor, 0.05 × typical0))`, capped at max; `max = floorHalf(10 × typical0)`; months are rounded to 0.5 (`:499`). I: both sourced floors round up to 1.0 month when the floor wins.
- V. A preset scale below a floor is raised to the floor's scale, never above 1 (`withFloor`, `timing.ts:284-289`).
- V. `entitled` and `construction` have no floor shown (`floor: editable ? ... : null`, `timing.ts:543`).

### C4. How settings combine

Inside one policy's set (V, `compileTiming`, `timing.ts:380-391`): the preset's timers, minus any on a stage that has a custom edit, then the edits. A custom edit replaces the preset on its stage; it does not stack. Shares are the custom ones if set, else the preset's.

Across permitting policies in force in a month (V, `permittingOf`, `src/lib/sim/world/policy/combine.ts:184-204`):

- Every reach-`all` timer of every policy in force goes into one list; `scaleTable(all, 'inFlight')` multiplies them per (route, stage) and clamps the product to [0.05, 10] (`combine.ts:193`, `:203`; `src/lib/sim/levers/timers.ts:37-51`).
- Each reach-`new` timer becomes a `speedNew` entry `{ from: <its span's start>, scale }`, sorted by `from` then list order (`combine.ts:194-198`, `:202`). A frame says it "applies to a project whose `from` is before the day it filed (or which is not yet filed)" (`src/lib/sim/world/policy/frame.ts:24-25`). A new project's scale is `speed` times every `speedNew` scale, clamped (`newScale`, `src/lib/sim/world/policy/lookups.ts:14-28`).
- Route shares are not combined: the last policy in list order that sets them wins (`combine.ts:199`, "a lower policy overrides").
- The Local Program is streamlined unless some policy in force says otherwise (`combine.ts:200`).
- I. So two policies scaling the same stage multiply (for example two `benchmarkPermits` policies would give 0.4786² on `permitFiled`); the three available presets each touch a different thing (streamlined `filed` for new projects; route shares; `permitFiled` for all), so stacking those three multiplies nothing against each other.
- V. Timers scale time only; outcomes are drawn from the unscaled tables (`src/lib/sim/levers/apply.ts:3-8`). The engine itself was not read.

---

## D. The transit rule

- V. Stop types (`STOP_TYPES`, `src/lib/sim/levers/brushes.ts:13`): `regionalRail`, `metro`, `rapidBus`, `frequentBus`.
  - `regionalRail`: pattern mode `heavy-rail` or `commuter-rail` (`brushes.ts:145`).
  - `metro`: mode `light-rail` (Muni Metro only; streetcar and cable car are other modes) (`:146-147`).
  - `rapidBus`: a Muni bus route whose id matches `/^\d+R$/` (`:26-28`, `:149-150`).
  - `frequentBus`: summed peak trips per hour over every bus pattern at the stop of at least `FREQUENT_BUS_TPH` = 6 (tier 4) (`:21`, `:151`, `:156-157`).
- V. Distance is straight-line from the lot's label point to the stop (tier 4) (`brushes.ts:283-287`); only `eligible` lots are returned (`:296-297`).
- V. Maximum bands: `MAX_BANDS = 3` (`src/lib/sim-page/transit-edit.ts:19`), enforced by `addBand` (`:98-104`). Minimum 1: `removeBand` refuses the last (`:107-111`); the parser requires at least one (`policy.ts:200`).
- V. Distance in the editor: whole metres from 1 to `BAND_MAX_M` = 3219 (2 miles, tier 4), strictly between the neighbouring bands (`transit-edit.ts:21`, `:63-74`). A new band sits `NEW_BAND_STEP_M` = 402 m beyond the outermost with the same stories (`:23`, `:98-104`).
- V. Stories in the editor: whole numbers between the outer band's and the inner band's stories, within `STORIES_MIN` 1 to `STORIES_MAX` 80 (`transit-edit.ts:54-60`; `src/lib/plan/constants.ts:3-4`).
- V. Band rule: no two bands at one distance, and no outer band taller than the band inside it (`bandProblem`, `policy.ts:89-96`; enforced in the parser, `policy.ts:208-210`).
- V. The last stop type cannot be switched off in the editor (`toggleStop`, `transit-edit.ts:114-119`).
- V. Defaults: stop types `regionalRail` and `metro`; bands 402 m at 6 stories and 805 m at 4 (`transit-edit.ts:26-33`; `policy.ts:75-78`).
- V. The parser is looser than the editor: it accepts any number of bands of at least 1, any `maxM > 0` (not whole, no 3219 cap), and an empty `stopTypes` list (`policy.ts:195-217`; `parse4.ts:109-114`). `MAX_BANDS` and `BAND_MAX_M` are read only in `transit-edit.ts` (grep over `src`, non-test files).
- V. Effect on a lot: each lot takes the highest rule that names it, and only where that is above its FZP stories; the lot is then uncapped (`src/lib/sim/levers/resolve.ts:80-93`; across policies `combine.ts:141-145`).

---

## E. Public money: the funding presets

`fundingPresets(cal, start?)`, `src/lib/sim-page/funding-presets.ts:130-496`. Eleven entries in
display order (V `:287-493`).

Start rule (V): a preset has `dates: 'start'` unless it is `htf-2026`, which is `'fixed'`
(`:162`, `:494-495`). Without `start`, dates count from `nextFiscal(asOf)` = 1 July of the year
after `asOf`'s UTC year (`:70`, `:134`), or for two presets from other defaults noted below. With
`start`, every date counts from it (`:134`). On `/sim` a measure is always re-dated on add:
`addPolicy` calls `dateMeasure`, which rebuilds the preset with `start` = the policy's first span's
`from` (`add.ts:249-253`; `funding-presets.ts:535-591`), and again whenever that `from` moves
(`redateMoved`, `add.ts:265-276`). A `'fixed'` preset is never re-dated (`funding-presets.ts:540`).
`dateMeasure` leaves a measure alone once anything but ids, labels and dates differs from the preset
(`:556-568`). Money counts only in months when the policy is on and a span covers them
(`src/lib/sim/world/policy/money.ts:1-10`; `combine.ts:48-59`).

| # | Id | Label | Group | Adds / removes | Amount | Starts | Ends | Available |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `housing-bond` | "A housing bond" | city | **Adds** (pool `goBond`, grant to affordable) | one `once` of $410,442,573 (`BOND_PRINCIPAL`, V `funding-sources.ts:69-80`); debt 0.06 over 20 years (V `:261-272`) | the start | one payment | yes if the data has a funding model and an affordable baseline programme (`needsGrantBase`, V `:288-299`, `:188-190`) |
| 2 | `general-revenue` | "General revenue, yearly" | city | **Adds** (pool `generalRevenue`, grant to affordable) | $36,700,000 a year (`GENERAL_FUND_FY25`, V `funding-sources.ts:83-91`) | the start | `to` = start + 29 years: 30 payments (`GENERAL_FUND_TERM_YEARS` 30, V `funding-presets.ts:307-314`; `funding-sources.ts:198-211`) | as 1 (V `:317`) |
| 3 | `htf-2026` | "Housing Trust Fund increase (Proposition C, 2026)" | city | **Adds** (content built but held back) | `once` $6, 13, 22, 31, 40, 49 million on 1 July 2028 to 2033, then $60,000,000 a year (V `funding-sources.ts:104-119`) | fixed: 1 July 2028 | fixed: yearly from 1 July 2034 `to` 1 July 2057 | **no**: "Not yet certified (passed November 2026)." (V `:319-331`) |
| 4 | `revolving-fund` | "A revolving construction-loan fund" | city | **Adds** (pool `generalRevenue`, loan to market projects) | one `once` of $100,000,000; loan `costShare` 0.1, `rate` 0.06, `minHomes` 0, no tiers (V `:332-368`; `funding-sources.ts:122-149`) | the start | one payment | yes if the loan's market terms are sourced and the data has a model (V `:337`) |
| 5 | `public-bank` | "The SF public bank, as planned" | bank | **Adds** (pool `bank`, loan to affordable) | five `once`: $8,666,667; $11,333,333; $10,000,000; $26,666,667; $13,333,333; leverage 0.67; loan `costShare` 0.1, `rate` 0.0613 (V `:369-408`; `funding-sources.ts:152-177`, `:289-313`) | the start, then its next four anniversaries | five payments | yes if the loan's terms are sourced and `needsGrantBase` holds (V `:374`) |
| 6 | `state-bond-2026` | "State housing bond (Proposition 1, 2026)" | state | **Neither** (no content) | none | — | — | **no**: "Not yet certified, and San Francisco's share is not published." (V `:409-415`) |
| 7 | `state-off` | "No state money from a date" | state | **Removes** (scale 0 on the state pool) | scale 0 | the start | none: stays off | yes if the data has a model and a state pool (V `:416-424`, `:259`) |
| 8 | `state-double` | "State money doubled from a date" | state | **Adds** (scale 2 on the state pool) | scale 2, then scale 1 | the start | back to 1 at start + 10 years (`STATE_DOUBLE_TERM_YEARS`, V `:425-434`; `funding-sources.ts:223-229`) | as 7 |
| 9 | `federal-support` | "Federal support from a year" | federal | **Adds** (pool `federal`, grant to affordable) | yearly, `dollarsPerYear` = the baseline state pool's first arrival on or after `asOf` (data-dependent) (V `:275-284`, `:454`) | `start`, or without one 1 January of `max(2028, asOf year + 1)` (V `:448`) | `to` = from + 9 years: 10 payments (`FEDERAL_SUPPORT_TERM_YEARS`, V `:453`; `funding-sources.ts:214-220`) | yes if `needsGrantBase`, a state pool, and a state arrival exist (V `:440-446`) |
| 10 | `federal-credits-off` | "Federal tax credits withdrawn from a date" | federal | **Removes** (scale 0 on the federal pool) | scale 0 | `start`, or without one `nextCalendar(asOf)` = 1 January of the next year (V `:477-485`, `:72`) | none: stays off | yes if the data has a model and a federal pool |
| 11 | `regional-bond` | "A regional bond" | state | **Neither** (no content) | none | — | — | **no**: "There is no regional measure yet." (V `:486-492`) |

- I. Tally: 8 can be available (1, 2, 4, 5, 7, 8, 9, 10); 3 are held back (3, 6, 11). Of the 8, six add money (five add a pool; `state-double` scales a baseline pool up) and two take money away (7, 10). Of the 3 held back, one has content that adds money (3) and two have no content.
- V. The grant presets' programme is `cityGrant`: `{ kind: 'grant', share: round6(CITY_PER_HOME / uncoveredPerHome('affordable', PROTOTYPES[0])) }`, reach `affordable`, `to: null`, `minHomes` and `tiers` copied from the baseline's first affordable programme (`funding-presets.ts:89-99`); `CITY_PER_HOME` = $300,027 (`funding-sources.ts:48-56`). I (doc): the share is 0.348251 (`docs/dev/sim-funding.md:38`).
- V. Ids: a preset carries placeholder ids `u-<presetId>-1`; real ones are the least free `n` (`funding-presets.ts:172`, `:185`, `:499-504`).
- V. An edit through the editor that changes what a given measure pays sets its `preset` to null (it becomes the player's own measure); the switch, order, Remove and date edits keep it (`lens.ts:280-286`).
- V. In today's game at level 5, `allowed.money === 'given'` makes a given measure's "What" read-only (`src/lib/timeline/Inspector.svelte:484`).
- I (doc, not checked in code): what each preset does under the fill rule, including "`state-double` buys no homes on the baseline" (`docs/dev/sim-funding.md:90-100`).

---

## F. Protections

Three categories (V `src/lib/sim/levers/types.ts:36-40`; `parse4.ts:40`).

| Category | Which lots | Where |
| --- | --- | --- |
| `rentControl` | lots with `parcels.rentControlLikely` | V `src/lib/sim/levers/resolve.ts:46-47`; UI label "Rent-controlled buildings (likely)", V `ProtectionsSection.svelte:90` |
| `historic` | lots with `policy.historicProtected` | V `resolve.ts:48-49`; UI label "Historic buildings (status A or A*)", V `ProtectionsSection.svelte:101` |
| `newerThan` (years N) | lots with `yearBuilt > 0` and `yearBuilt >= year(asOf) − N` | V `resolve.ts:50-56` |

What a protection does (V unless marked):

- A protected lot is reset to its FZP row (stories, cap, yields), discarding any rule or paint on it, and its `hostable` is set to 0, so no new project starts there; it makes no `Need` (`resolve.ts:103-111`; header `:1-9`).
- In-flight projects on a protected lot carry on (`resolve.ts:5-7`; UI text "Protected lots get no new housing in the simulation. Projects already in the pipeline continue.", `ProtectionsSection.svelte:147-150`).
- Capacity is reported with and without protections: `LeverCapacity { plan, withoutProtections, protectedLots }` (`resolve.ts:195-212`).
- Combining across policies in force: any policy turns a category on; `newerThan` takes the largest years (`combine.ts:130-135`).
- A protected lot's limit reads as FZP with `protected: true` (`src/lib/sim/world/policy/limits.ts:146-155`; `src/lib/sim/levers/source.ts:57`).
- I. A protection can only remove homes or leave them unchanged relative to the same policy without it (follows from `hostable = 0`; `docs/dev/sim-levers.md:53` says `withoutProtections − plan` is never negative).

---

## G. Mechanisms that switch something off without deleting it

| # | Mechanism | Where | What it does |
| --- | --- | --- | --- |
| 1 | `Policy.on: boolean` | V `policy4.ts:45`; required boolean, `parse4.ts:265` | A policy that is off has no span in force: `spanAt` returns null (`policy4.ts:88-91`), so `inForceAt` skips it (`combine.ts:48-59`) |
| 2 | `setOn(doc, kind, id, on)` | V `src/lib/timeline/spans.ts:212-216` | The pure edit; returns the same document when nothing changes |
| 3 | The Inspector's "On" switch | V `src/lib/timeline/Inspector.svelte:240-245` (`toggleOn`, undo label "Switched on: …" / "Switched off: …"), `:423-428` (`role="switch"`) | The UI for 1 and 2; shown only when not read-only (`:421`) |
| 4 | Editors writing `on` | V `lens.ts:216-233` | Removing a transit policy's rule, unchecking a protection, or clearing `newerThan` years sets `on: false`; setting them again sets `on: true`. An off transit or protection policy projects into its editor as "no rule / unchecked" (`lens.ts:77-88`). The Inspector keeps a transit policy's `on` across a lens edit (`Inspector.svelte:118-140`) |
| 5 | Span end date `Span.to` | V `policy4.ts:37`; `setTo`, `spans.ts:87-98` | A policy is in force only in months a span covers; spans may leave gaps (`addSpan`, `splitSpan`, `removeSpan`, `spans.ts:141-210`) |
| 6 | Baseline scale 0 → engine `off` span | V `finance.ts:347-360` (`offSpans`), `:394-399` | A scale-0 entry on a baseline pool switches the pool off from its day until the next entry above 0; presets `state-off` and `federal-credits-off` are this |
| 7 | `FinanceFrame.offered` | V `frame.ts:37`; `money.ts:148-154` | Per month, a programme is offered only when in force and its pool is not switched off |
| 8 | Programme `to`, yearly inflow `to` | V `finance.ts:107-114`, `:183-185` | End dates inside a fund's definition |
| 9 | The game's `playable(doc, allowed)` filter | V `src/lib/game/allowed.ts:51-63`; used at `src/lib/sim-page/SimPage.svelte:211-216` | Policies the level does not run are left out of the document the worker runs and Publish sends (`SimPage.svelte:240-241`); autosave keeps the whole one (`:210`). This drops them from the run; it does not touch `on` |
| 10 | Legacy saved timing as an off policy | V `upgrade.ts:82-93` | A schema 3 `timing.saved` snapshot upgrades to a permitting policy `timing-saved` with `on: false` |
| 11 | `available: false` on a preset | V `timing.ts:54`; `funding-presets.ts:62` | Hides a preset from "+"; not a switch on an existing policy |

What an off policy still does (V):

- Its lot queries are still resolved: `queriesOf4` covers "off policies too" (`policy4.ts:63-85`).
- Its pools and programmes keep their place in every money frame, "so the arrays do not change when a policy is switched" (`money.ts:31-48`); its definition rests at its first span's (`restingDef`, `money.ts:81-92`).
- It counts toward ids, finance limits, strokes and bytes (A4).
- It does not change the comparison: `nothingInForce` and `comparisonOf` read only on policies (`policy4.ts:94-98`; `src/lib/sim/world/policy/compare.ts:43-45`).
- An off terms policy types no term for the gap check, but an off fund policy's programmes are still checked (`reconcile4.ts:161-170`).
- The timeline draws it as off (`src/lib/timeline/PolicyRow.svelte:63-68`, `:84`; `KindRow.svelte:147`) and its bar's name ends ", off" (`rows.ts:180-189`).
- Reconciling a permitting policy reports changes under `'saved'` when off, `'current'` when on (`reconcile4.ts:112-113`).

- V. `localProgramStreamlined` is a boolean in the timing set, but a strict (published) document must hold `true` (`policy.ts:320-321`); the editor shows it as text "yes"/"no" (`src/lib/sim-page/PermittingSection.svelte:187-190`). I: no control sets it false (I did not read `PermittingSection.svelte` beyond those lines).

---

## H. `src/lib/game/allowed.ts`

### H1. Full logic (V, all 84 lines read)

- `Allowed { kinds: ReadonlySet<PolicyKind>; money: 'given' | 'all' }` (`:5-10`). `kinds`: "Kinds whose policies run and can be edited". `money: 'given'`: "only given measures run, and what they pay is read-only".
- `ALL_ALLOWED`: all three kinds, `money: 'all'` (`:12-15`).
- Per level (`AT`, `:17-24`):

| Level | `kinds` | `money` |
| --- | --- | --- |
| 1 | none | `given` |
| 2 | none | `given` |
| 3 | permitting | `given` |
| 4 | permitting, zoning | `given` |
| 5 | permitting, zoning, money | `given` |

- `allowedAt(level)` returns the row (`:26-28`). No level gives `money: 'all'`; only `ALL_ALLOWED` does.
- `unlocksAt(kind)`: permitting 3, zoning 4, money 5 (`:30-35`).
- `isGiven(p)`: `preset` is a string and `where.tag` is `fund`, `baseline` or `terms` (`:38-43`).
- `runs(kind, p, a)`: the kind is allowed, and for money either `money === 'all'` or the policy is given (`:45-47`).
- `playable(doc, a)`: each kind's list filtered by `runs`; the same document object when nothing is dropped (`:51-63`).
- `levelNeeded(doc)`: 6 if any money policy is not given; else 5 if any money policy; else 4 if any zoning; else 3 if any permitting; else 2 (`:66-73`). It reads list lengths, not `on`.
- `simLocked(p)`: `p.level === 1` (`:76-78`).
- `needsHigher(doc, p)`: `levelNeeded(doc)` when above `p.level`, else null (`:81-84`).

The locks are per kind (and given-or-own for money). Nothing in this file is per preset, per stop type, per band or per field.

### H2. Census of consumers (non-test), from a grep over `src/`, `e2e/`, `scripts/`

| File | Lines | Uses |
| --- | --- | --- |
| `src/lib/game/store.svelte.ts` | 4, 240, 571-572 | `#allowed = open ? ALL_ALLOWED : allowedAt(progress.level)`; getter `allowed` |
| `src/lib/game/copy.ts` | 3, 29-34 | `unlocksAt` in `lockedLane` ("Unlocks when you level up", "Unlocks at level N") |
| `src/lib/sim-page/SimPage.svelte` | 35, 207, 211-216, 217, 401-405, 408, 420, 507-520, 525-547, 1240 | `allowed = game?.allowed ?? ALL_ALLOWED`; `playable` for the run document; `zoningLocked`; `runs` in `locked(ref)`; refuses selecting a locked policy and opening "+" on a locked kind; closes an editor that locks; opens the kinds a level-up unlocks; passes `allowed` down |
| `src/lib/sim-page/SimRoute.svelte` | 14, 103 | `simLocked` |
| `src/lib/sim-page/funding-presets.ts` | 26, 536 | `isGiven` in `dateMeasure` |
| `src/lib/shell/SiteHeader.svelte` | 21, 71 | `simLocked` (the Simulate step) |
| `src/lib/timeline/add.ts` | 9, 72-74, 107, 270 | `allowed` in `addChoices`; `isGiven` in `redateMoved` |
| `src/lib/timeline/activity-view.ts` | 7, 92-99 | `startersFor(cal, doc, allowed)` passes it to `addChoices` |
| `src/lib/timeline/AddMenu.svelte` | 7, 20, 23, 25 | prop `allowed`, passed to `addChoices` |
| `src/lib/timeline/Inspector.svelte` | 20, 79, 97, 393, 484 | prop `allowed`; passes to `AddMenu`; a given measure's What is read-only while `money === 'given'` |
| `src/lib/timeline/Timeline.svelte` | 13, 79, 105, 110-112 | `lockOf(kind)` lane words; `lockedIn(kind)` = `!runs(...)` |
| `src/lib/timeline/TimelineMode.svelte` | 168, 415, 602, 1938 | `allowed = g?.allowed ?? ALL_ALLOWED`; `startersFor(..., allowed)`; passes it to the timeline |
| `src/lib/timeline/test/InspectorHost.svelte` | 8, 28 | test host prop |
| `src/routes/+page.svelte` | 16, 172 | `simLocked` |
| `src/routes/s/[id]/+page.svelte` | 7, 41, 43 | `simLocked`; `needsHigher(doc.policy, progress)` |

Tests importing it: `src/lib/game/allowed.spec.ts:15`, `src/lib/game/store.svelte.spec.ts:8`,
`src/lib/timeline/activity-view.spec.ts:9`, `src/lib/timeline/Inspector.svelte.spec.ts:10`,
`src/lib/timeline/add.spec.ts:2`, `src/lib/timeline/Timeline.svelte.spec.ts:7` (V: import lines only;
the specs were not read).

- V. `levelNeeded` has no caller outside `allowed.ts` and its spec (grep); it is reached through `needsHigher`.
- V. No hit in `e2e/` or `scripts/`.
- All line numbers above are V from grep output or a read; the described use at each is V where I read the lines (`SimPage.svelte:196-255`, `:390-420`, `:500-549`; `Timeline.svelte:100-119`; `copy.ts` whole; `Inspector.svelte:100-259`, `:405-495`) and I for `SimRoute.svelte`, `SiteHeader.svelte`, `TimelineMode.svelte`, `store.svelte.ts` and the two routes (single grep lines only).

---

## I. From a policy document to what the engine runs

### I1. The compile (V unless marked)

1. **Open and reconcile.** A stored body of schema 2, 3 or 4 becomes a reconciled schema 4 document (`openSimDoc4`, `sim-doc4.ts:232-263`): schema 2/3 goes through `upgradePolicy` (one span per policy from month 1 with no end, `upgrade.ts:12-35`); every body goes through `reconcilePolicy4`, which snaps spans to the dataset's model months, re-fits permitting preset layers, and drops scale entries and programmes the data cannot honour (`src/lib/timeline/reconcile4.ts:254-299`).
2. **Lot queries.** `queriesOf4(doc)` lists the transit and freehand queries the document needs (`policy4.ts:63-85`); the page resolves them to lots through the worker (`PolicySync`, `SimPage.svelte:228-231`). A transit rule makes one query per band, outermost first (`policy.ts:463-470`).
3. **`compileTimeline(doc, lots, ctx, base)`** (`src/lib/sim/world/policy/compile.ts:153-406`) checks span alignment, requires `reconcilePolicy4(doc).doc === doc` (`:164-166`) and no programme term gap (`:170-171`), then builds one `PolicyFrame` per model month of the window, in budgeted slices (`step`, `:375-386`).
4. **Per month** (`advance`, `:335-347`): `inForceAt(doc, first day of month)` (`combine.ts:48-59`) → a `State` keyed by which (policy, span) pairs of zoning and permitting are in force (`compile.ts:197-219`) → a zoning view → `assemble` (`:291-332`).
5. **Zoning in force → levers** (`zoningLevers`, `combine.ts:100-155`): rules, each lot at the highest rule naming it; paint, the lower painted policy in the list winning a lot; protections as in F.
6. **Zoning view** (`createViewJob`, `src/lib/sim/world/policy/zoning-view.ts:86-178`), built once per distinct zoning state: `resolveEnvelopes` → yield recompute of the `Need`s → `fillNeeds` → `applyLevers` → `precomputeOf`. Views are interned by lever key and by content in a weak cache `VIEWS` (`compile.ts:232-268`; `src/lib/sim/world/policy/intern.ts:159-211`).
7. **Permitting in force** → `speed`, `speedNew`, `routeShares`, Local Program switch (C4); route shares become `newCalibration` via `routeSharesOp`, once per distinct shares (`compile.ts:221-229`).
8. **Money in force** → one `FinanceLevers` (`moneyLeversOf`, `combine.ts:211-232`: scale entries merged per pool and day with the lower policy winning; pools and programmes in document order; terms merged with the lower policy winning) → `buildFinance(base, levers, asOf)` once per distinct levers (`money.ts:125-133`; `finance.ts:368-409`) → the month's `FinanceFrame` with `offered` and `arrivals` (`money.ts:136-187`). `finance` is null when the dataset has no baseline funding (`money.ts:118`).
9. **Frame** (`frame.ts:14-29`): `id`, `view`, `calibration`, `newCalibration`, `speed`, `speedNew`, `market`, `finance`. The id is interned from the view's content digest, the input and layer serials, the permitting key, the market shift and the money key (not arrivals) (`compile.ts:295-297`; `intern.ts:123-135`).
10. **The comparison** (`comparisonOf`, `compare.ts:43-45`): with nothing in force, the same document on the pre-plan zoning; otherwise `DEFAULT_POLICY4` on the plan. The runner compiles both sides (`src/lib/sim/world/runner/runner.ts:1226-1228`).

The older undated path still exists: `compileLevers(p: SimPolicy, lots)` → `SimLevers` (schema 3)
(`policy.ts:561-574`) → `applyLevers` (`src/lib/sim/levers/apply.ts:144-162`). The schema 4 compiler
calls into it per month (`combine.ts:143`, `zoning-view.ts:131`).

### I2. What is recomputed when a policy changes

Code:

- V. On an accepted edit the runner computes `m = firstDifference(oldTimeline, newTimeline)`; if `m` is null or past the last month stepped it keeps the ensemble, else it restores at `m` and refills from there (`runner.ts:641-655`).
- V. `firstDifference` is the first month whose frames differ in id or in arrivals (`compare.ts:27-37`).
- V. A zoning view is rebuilt only for a zoning state not already held or cached; the state's key covers zoning and the Local Program switch only (`compile.ts:206-208`, `:232-249`). So a permitting-only or money-only change builds no new view and runs no yield recompute.
- V. A change of policies in force changes the set of (policy, span) pairs, so a new `State` (`compile.ts:124-126`, `:197-200`); switching a policy off is such a change.
- I. Whether switching a policy back on reuses its earlier view depends on the weak cache still holding it (`intern.ts:159-162`).

Docs (I: testimony, not checked beyond the lines cited above):

- `docs/dev/ensemble-runner.md:54`: copies are kept at month 0 only (`COPY_MONTHS = [0]`); "A restore takes the last complete copy at or before m − 1 … and re-steps quietly to m − 1. With m = 1, or no copy, the worlds are created again."
- `docs/dev/ensemble-runner.md:62`: "While an edit compiles nothing steps"; the edit is accepted once each new timeline is ready through the ensemble's last month stepped.
- `docs/dev/ensemble-runner.md:76`: "An edit from a document with nothing in force changes the comparison from the pre-plan base to the default on the plan, so the comparison is re-created and `refill` is from 0."
- `docs/dev/policy-timeline.md:122`: a programme or pool not on offer is not part of a month's identity, "so a fund opening in month m leaves earlier frames as they were".
- `docs/dev/policy-timeline.md:155`: "An edit dated after month 1 reuses the default view for the earlier months (first frame 0)."
- Measured compile cost for an edit from month 1 on the live city, ballpark (`docs/dev/policy-timeline.md:150-164`): one added metro rule (6 stories at 402 m, 4 at 805 m; 39,202 lots changed) about 4.4 to 4.7 s with no gross table; 500 painted lots about 120 to 132 ms. With the gross table, the largest brush's needs cost 86 ms of lookups against 22,332 ms of recompute (`docs/dev/sim-levers.md:169-176`).

I. Put together for a change dated from today (month 1): the first differing month is 1, so both
kept worlds are discarded and the whole window is stepped again; a zoning change also pays one view
build (the yield recompute when the dataset has no gross table), a permitting or money change does
not.

---

## J. Counts

### J1. Distinct on/off items

Available today (18):

| # | Item | Kind | Ref |
| --- | --- | --- | --- |
| 1 | `sb423Clock` | permitting preset | C2 |
| 2 | `noDiscretionary` | permitting preset | C2 |
| 3 | `benchmarkPermits` | permitting preset | C2 |
| 4 | stop type `regionalRail` | transit rule | D |
| 5 | stop type `metro` | transit rule | D |
| 6 | stop type `rapidBus` | transit rule | D |
| 7 | stop type `frequentBus` | transit rule | D |
| 8 | protect `rentControl` | zoning | F |
| 9 | protect `historic` | zoning | F |
| 10 | protect `newerThan` (also carries a years setting) | zoning | F |
| 11 | `housing-bond` | money, adds | E |
| 12 | `general-revenue` | money, adds | E |
| 13 | `revolving-fund` | money, adds | E |
| 14 | `public-bank` | money, adds | E |
| 15 | `state-double` | money, adds | E |
| 16 | `federal-support` | money, adds | E |
| 17 | `state-off` | money, removes | E |
| 18 | `federal-credits-off` | money, removes | E |

By group: 3 permitting presets, 4 stop types, 3 protections, 8 money measures (6 add, 2 remove).
Items 11 to 18 depend on the dataset having a funding model and the pools each names (E).

Exist in code but not offered (4): `ceqaInfill` (no content), `htf-2026` (content built),
`state-bond-2026` and `regional-bond` (no content).

Not counted as on/off items: `observed` (the fixed baseline row); the six containers "+" also
offers (Transit rule, Painted area, Custom timing, Your own pool, City funding scale, Market terms);
the generic `Policy.on` every policy has; `localProgramStreamlined` (no control found, G).

### J2. Distinct stepped settings

| # | Setting | Steps and range | Count | Ref |
| --- | --- | --- | --- | --- |
| 1 | Transit: number of distance bands | 1, 2, 3 | 1 per rule | D |
| 2 | Transit: a band's distance | whole metres 1 to 3219, between neighbours | up to 3 per rule | D |
| 3 | Transit: a band's stories | whole 1 to 80, not taller than the band inside | up to 3 per rule | D |
| 4 | Protection `newerThan` years | whole 1 to 200 (editor) | 1 | B3 |
| 5 | Permitting: typical months of a stage | 0.5-month steps, `max(floor, 0.05 × typical)` to `10 × typical` | up to 11 (route, stage) pairs | C1, C3 |
| 6 | Permitting: route shares | whole percents summing to 100 | 3 values, 2 free | B4 |
| 7 | Money: dated change on today's funding | percent 0 to 1000, step 5, with a date | per baseline group (City, State, Federal) or pool; at most 24 entries | B6 |
| 8 | Money: market terms | 5 keys with ranges; the editor offers `guaranteeRateCut` 0 to 5 points, step 0.05 | 5 in the parser, 1 in the editor (I for the editor) | B6 |
| 9 | Money: an own pool's and programme's fields | amounts, dates, kind, debt rate and years, leverage, share, loan rate, lower return, reserve, `minHomes`, income mix | 14 rows in the doc's field table, some holding two fields (I: counted from `docs/dev/sim-funding.md:158-174`) | B6 |
| 10 | Any policy: span start and end | model months 1 to 480; several spans per policy | 2 per span | A3, G |
| 11 | Painted area: a brush's stories and stroke radius | stories 1 to 80; radius 5 to 500 m | per brush | B2, A4 |

I. Counting the settings the design's branches would draw on (rows 1 to 6): 1 + 3 + 3 for one transit
rule, 1 for `newerThan`, 11 stage durations, 3 route shares = 22 values, in 6 kinds of setting.

---

## K. Doc against code

| # | Doc says | Code says |
| --- | --- | --- |
| 1 | `docs/dev/policy-timeline.md:5`: "Release A builds all of this and switches none of it on: `/api/policies`, `/s/[id]`, `SIM_CODEC`, the page and the autosave key `sfhousing:sim:v1` still use schema 3." Also `:136`: "Their callers (the server codec, `/sim`) come with timeline-ui." | Schema 4 is in use: the page's store is `PolicyStore<SimPolicy4>(DEFAULT_POLICY4, …)` and its document a `SimDoc4` (V `src/lib/sim-page/SimPage.svelte:202`, `:235-239`), with `createSimCodec4` (`:165`, `:290`); `/s/[id]` uses `createSimCodec4` (V `src/routes/s/[id]/+page.svelte:16`, `:56`); the server codec calls `loadSimDoc4` and `parseSimDoc4` (V `src/lib/timeline/server-codec.ts:76`, `:102`, grep lines only) |
| 2 | `docs/dev/sim-timers.md:28`: "One preset at a time (Call 4). Choosing one replaces the current set … Combinations are made by editing." (The doc scopes itself at `:8` to "one span's set".) | Across policies, any number of permitting policies can be added (V `add.ts:90-98`) and those in force combine (V `combine.ts:184-204`). Within one policy the preset is the policy's: a change on one span of several is refused (V `lens.ts:146-151`) |
| 3 | `docs/dev/sim-timers.md:48`: SB 423 deadline `D = (90p + 180(1-p)) / 30.4375` months | The code divides by `MONTH_DAYS` (V `timing.ts:313`); the same doc at `:169-170` says month conversions use 30.436875, and the floor's method string uses 30.436875 (V `timing-sources.ts:196`). I did not read `MONTH_DAYS` itself |
| 4 | `docs/dev/sim-levers.md:63`: "Stacked edits on one pathway and stage multiply" | True of `scaleTable` (V `timers.ts:37-51`). On the page a custom edit replaces the preset's timer on its stage instead of stacking (V `timing.ts:380-391`; `docs/dev/sim-timers.md:17-24` agrees). Different layers, not a contradiction |
| 5 | `docs/dev/sim-levers.md:94-124` and `docs/dev/finance-levers.md:56-63` describe the worker protocol `initScenario` / `setLevers` / `leverStep` | `/sim` holds a `TimelineClientApi` (V `SimPage.svelte:222`) and the runner compiles with `compileTimeline` (V `runner.ts:1226-1228`); `docs/dev/ensemble-runner.md:22` gives `openTimeline` / `setPolicy`. I did not check whether anything still uses the `setLevers` path |
| 6 | Root `CLAUDE.md` indexes `sim-levers.md` as covering the "law switch" | `docs/dev/sim-levers.md:20` and `:234`: there is no law switch; it was retired |
| 7 | The design, `docs/superpowers/specs/2026-11-24-incremental-feel-design.html` (Branches table): Public money nodes are "The measures that add money, about seven of the eleven presets" | Eleven presets exist (V `funding-presets.ts:287-493`). Six available ones add money; a seventh with content (`htf-2026`) is held back; two more have no content (E) |
| 8 | The design (The tree): "A measure starts on its own lawful date, shown on the node, and not always today." | Ten of eleven presets have `dates: 'start'` and are dated from the policy's first span (V `funding-presets.ts:162`, `:535-540`; `add.ts:249-253`). Only `htf-2026` has dates set in law (V `:494-495`), and it is not available (V `:329`) |
| 9 | The design (Branches table): permitting presets "multiply when stacked" | Timers on the same route and stage multiply; route shares do not combine (the lower policy wins) (C4). The three available presets act on three different things |
| 10 | The design (Branches table): zoning is "each of the four stop types, a second and a third distance band, the height cap in steps" | Matches the editor: 4 stop types (V `brushes.ts:13`), `MAX_BANDS = 3` (V `transit-edit.ts:19`), stories 1 to 80 (V `constants.ts:3-4`). The three-band cap and the 3219 m cap are editor limits only; the parser does not enforce them (D) |
| 11 | The design (Branches table): "The CEQA infill exemption is not available in the code today." | Agrees (V `timing.ts:130`; `timing-sources.ts:156-165`) |

---

## Appendix

### Files read in full

- `src/lib/timeline/policy4.ts`, `parse4.ts`, `sim-doc4.ts`, `add.ts`, `upgrade.ts`, `rows.ts`
- `src/lib/timeline/spans.ts`, `lens.ts`, `reconcile4.ts` (outside the named scope; read for G and I)
- `src/lib/sim-page/policy.ts`, `timing.ts`, `timing-sources.ts`, `transit-edit.ts`, `funding-presets.ts`, `funding-sources.ts`, `ProtectionsSection.svelte`
- `src/lib/game/allowed.ts`, `src/lib/game/copy.ts`
- `src/lib/sim/levers/types.ts`, `brushes.ts`, `finance.ts`, `resolve.ts`, `apply.ts`, `timers.ts`, `layers.ts`, `view.ts`, `source.ts`
- `src/lib/sim/world/policy/compile.ts`, `combine.ts`, `frame.ts`, `money.ts`, `compare.ts`, `lookups.ts`, `intern.ts`, `limits.ts`, `zoning-view.ts`
- `docs/dev/sim-levers.md`, `policy-timeline.md`, `sim-timers.md`, `sim-funding.md`, `finance-levers.md`
- `docs/superpowers/specs/2026-11-24-incremental-feel-design.html` (as text with tags stripped; skimmed)

### Files read in part

- `src/lib/sim-page/funding-edit.ts`: lines 1-520 and 700-924 of 1003. Not read: 521-699 (debt, leverage, programme edits, `rescaleTiers`) and 925-1003 (draft update and completion).
- `src/lib/sim/levers/recompute.ts`: lines 1-60.
- `src/lib/timeline/Inspector.svelte`: lines 100-259 and 405-495.
- `src/lib/sim-page/SimPage.svelte`: lines 196-255, 390-419, 500-549.
- `src/lib/timeline/Timeline.svelte`: lines 100-119.
- `src/lib/sim/world/runner/runner.ts`: lines 630-679.
- `src/lib/sim/finance/terms.ts`: lines 112-129.
- `docs/dev/ensemble-runner.md`: lines 50-77, plus grep lines.
- `src/lib/timelapse/types.ts`, `src/lib/plan/constants.ts`, `src/lib/sim-page/FundingGroupEditor.svelte`, `src/lib/sim-page/PermittingSection.svelte`, `src/lib/timeline/server-codec.ts`, `src/lib/timeline/AddMenu.svelte`, `src/lib/timeline/activity-view.ts`, `src/lib/timeline/TimelineMode.svelte`, `src/lib/timeline/PolicyRow.svelte`, `src/lib/timeline/KindRow.svelte`, `src/lib/game/store.svelte.ts`, `src/lib/shell/SiteHeader.svelte`, `src/lib/sim-page/SimRoute.svelte`, `src/routes/+page.svelte`, `src/routes/s/[id]/+page.svelte`: grep output lines only.

### Directories listed

- `src/lib/sim/levers/`, `src/lib/sim/world/policy/`, `src/lib/brush/`, `src/lib/game/`, `.superpowers/superconductor/incremental-loop/`

### In scope and NOT examined

- Every `*.spec.ts` in `src/lib/sim/levers/` and `src/lib/sim/world/policy/` (13 and 10 files), including `roundtrip.spec.ts` and `compile.perf.spec.ts`; `src/lib/game/allowed.spec.ts`. No test was read or run.
- `src/lib/sim/levers/fixtures/` and `src/lib/sim/world/policy/test/` (directories not listed; one line of `test/fixtures.ts` seen in grep).
- `src/lib/sim/levers/recompute.ts` after line 60 (`createYieldRecompute` body, `createTableRecompute`).
- `src/lib/sim-page/funding-edit.ts` lines 521-699 and 925-1003.
- `src/lib/brush/`: nothing read (it holds the Paint brush controller and editor, not the stop types).
- Not verified in code, taken from docs only: the fill-rule effect of each funding preset (`sim-funding.md:90-100`); the editor offering only `guaranteeRateCut`; the count of own-pool fields; the measured timings; the value of `MONTH_DAYS`.
- Out of the named scope and not read, though they bear on these questions: the engine (`src/lib/sim/scenario/engine.ts`, `funded.ts`, `funding.ts`), `src/lib/sim/world/` outside `policy/` (the step, the runner apart from the lines above), `src/lib/sim-page/reconcile.ts` and `funding-reconcile.ts`, `PermittingSection.svelte`, `RouteTimeline.svelte`, `FundingTab.svelte`, `WhatEditor.svelte`, `WhenEditor.svelte`, `src/lib/sim/finance/` apart from the term ranges, `docs/dev/game.md`, `docs/dev/timeline-ui.md`, `docs/dev/sim-page.md`, `docs/dev/finance-engine.md`.
- No command was run against a dataset: availability of presets 11 to 18 (J1) and of each (route, stage) pair on the live or fixture calibration was not checked against data.
