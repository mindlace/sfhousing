# /sim refinements: runs, absolute heights, height fog

Status: draft for approval (2026-10-31)

## Why

`/sim` lets you change policy at any moment of a simulation that runs to 2066, layer several zoning
regimes, and raise/lower/set heights. This is too much freedom to read, and the map doesn't show
what's going on: the base height limits are invisible, changed lots are tiny coloured dots, transit is
hidden, and the score reports an absolute count against no meaningful comparison. This redesign
narrows the page to one question: **given FZP as written, what does my policy change build, compared
with FZP alone?** It also makes the map show the answer in terms of height.

## Goals

1. **Runs.** You set up a policy, press Run, and watch it play. Policy can't be edited during a run.
2. **One baseline.** FZP as written, held for the whole simulation window. The "zoning layers" concept
   goes away.
3. **A score that is a comparison.** No customisation: FZP compared with no FZP. Any customisation:
   yours compared with FZP.
4. **Absolute heights.** A brush means "allow N stories here", whatever the area allowed before.
5. **Show the height limits.** A see-through height fog over the city, toggleable like transit.
6. **Show what a height buys.** Painting briefly fills the painted lots with the buildings they could
   actually hold, then fades.
7. **Fix chrome**: transit view on `/sim`, a timeline bar that stays still, Paint/Simulate as tabs,
   the score centred on desktop, a better policy pane order.
8. **Palette pass.** Every coloured thing on the map has its own distinct colour; no indigo bias.

## Non-goals

- No pre-FZP height map. Pre-FZP is only the counterfactual inside the default score; it is never
  drawn.
- No policy changes partway through a run, and no choice of zoning regime (current law, SB 79, base).
- No new source data. The fog uses the per-lot limits the worker already holds; the physical cap
  needs only lot geometry the pipeline and worker already have (it does need a dataset rebuild).

## Anti-goals (a failure even if it technically works)

- The timeline bar or header moving as the month changes.
- Overlays you can't tell apart: transit, fog, construction and painted areas mixing into one colour.
- A score that shows a number without saying what it's compared with.

## Design

### 1. Setup and Run

The page has two phases.

- **Setup** (the page opens here, at the present day):
  - Policy is editable.
  - The overlays (height fog, transit access, transit stops) can be shown, each with its own
    toggle in the view menu.
  - Construction already underway is shown, as today.
- **Run:**
  - Pressing **Run** simulates from the present to the end of the window and plays it.
  - The policy pane is read-only and the overlays hide.
  - The timeline bar gives play, pause and scrub within the run.
- **Change policy** is a button in the policy pane, shown during a run. It ends the run and returns
  to Setup at the present day with the policy intact. Overlay toggles come back as you left them.
- *My call:* scrubbing a finished run stays allowed; only editing is locked.
- *My call:* the comparison run is computed together with yours, so the comparison shows as
  soon as it is available. Until the band runs finish, the headline shows the same pending state it
  shows today.
- Starting a new run after **Change policy** discards the old run.
- *My call:* **Run lives in the timeline bar.** In Setup the Play button reads "Run" and the scrubber
  is pinned at the present day, disabled. During a run the button is Play/Pause/Replay. All four labels
  share one fixed-width slot, so switching phase doesn't move the bar.
- *My call:* **The worker keeps computing in Setup** as it does today: each edit is debounced and sent
  through `setLevers`, and the full run plus the comparison twin are computed then. Run plays what is
  already computed, or waits for it with the existing pending state.
- *My call:* **The phase is not persisted.** A reload or a restored autosave always opens in Setup.
  The read-only `/s/<id>` view also opens in Setup with Run available. There, the pane button reads
  "Back to start" instead of "Change policy", because the policy can't be edited anyway.
- The window stays the present day to `HORIZON` (2066-12-31).

### 2. Baseline and score

- **The baseline is FZP as written for the whole window.** There is no SB 79 switch in 2032 and no
  "alternative plan kept" checkbox. In engine terms: stock `['fzp']`, no law switch.
- **The comparison is chosen automatically:**
  - Policy equal to the default (no zoning brushes, default timers, default protections): compare with
    pre-FZP. The headline reads like "+N homes vs no FZP".
  - Any customisation (zoning, permitting timelines or protections): compare with FZP unchanged. The
    headline reads like "+N homes vs FZP" (or "−N").
- **The headline is the difference.** The absolute totals move into the score details.
  - During a run, the headline is the difference at the scrubbed date.
  - In Setup, the headline is the projected difference at the end of the window: "+N homes vs FZP
    by 2066" (pending while it computes). This is open (see below).
- **Density caps under the FZP baseline:** the baseline keeps FZP's own per-lot caps
  (`fzpYieldCap`) for the whole window. User edits are always uncapped (see §3), so no edit can bring
  back §207.11 caps or the 2032 law switch. The baseline, the `fzp` twin and the user plan never take
  the switch path.
- **The engine needs a new `compare: 'fzp'` twin:** a plan of `{stock: ['fzp']}` with no switch and
  no user edits. `preFzp` stays. The `currentLaw` compare and twin are no longer reachable from the UI.
- **The score is centred in the header on desktop** (md and up, *my call*): a three-column header
  layout on `/sim` (status left, score centre, actions right) instead of `justify-between`.

### 3. Brushes

- **One zoning brush: "Allow N stories".** It sets the limit on painted lots to N, raising or
  lowering it as needed (the engine's existing `set` mode).
  - **No density limits, and no option for them** (your decision). Painted lots hold as many homes
    as fit in the envelope, subject only to the physical limits in §3a. The density-limits control
    is removed from `/sim` and from paint mode on `/`. Changing density rules is a later project.
  - The street, area and transit brush shapes keep their forms; transit bands also take absolute
    stories.
- **The eraser** removes your painting, returning lots to FZP.
- **Raise and lower go from the UI.** *My call:* published and autosaved policies containing
  `raise`/`lower` still load and run unchanged (schema 1 stays readable). Their summaries keep the
  old wording, and new brushes are always `set`. No schema bump.
- **Paint feedback:** when a stroke lands, the painted lots fill in with the buildings they could
  actually hold under the new limit, drawn the way paint mode on `/` draws generated buildings. Those
  buildings then fade out (roughly two seconds, *my call*). This shows that a tall limit on small
  lots still yields small buildings.
  - *My call:* freehand strokes show the feedback as soon as the stroke resolves.
  - *My call:* the rule brushes (street, area, transit) show it after their recompute, limited to lots
    in the current view.
  - *My call:* the eraser shows no feedback; the fog dropping back is the cue.

### 3a. Physical limits

A lot has a physical ceiling whatever its zoning: you can't put a 40-story tower on a 25 × 100 ft
Sunset lot. Each lot gets a **physical max stories**, and the envelope the generator builds is
`min(zoned or painted stories, physical max)`. This applies to the FZP baseline, painting on `/sim`
and `/`, and the paint feedback.

**Today** the generator does this implicitly and by area only (`select.ts`: 400/600/1500 m²
thresholds, tier 4), with no width test and no slenderness limit. The tower plate can be 12 m wide at
80 stories, about 20:1.

**The rule is the hybrid** (your decision). Two calibrations were run; evidence, tables and scripts
are in `docs/superpowers/design/2026-10-31-physical-limits/`. Let `w` be the lot's minimum width in ft
(principal-axis cross extent, as `poly.ts` computes it) and `A` its area in ft².

- **SF term**, from SF's own buildings: DataSF LiDAR footprints, parcels and the 2023 roll, 119,531
  sites. Tier 0. It is exceeded by 0.11% of sites.
  - `sf = min(0.3·w, capA(A))`
  - with `k = A/1000`:
    - `capA = 2.4k` when k ≤ 15
    - `capA = 36 + 0.9(k−15)` when k ≤ 30
    - `capA = 49.5 + 0.5(k−30)` above that

  On narrow lots this is physics, not zoning: pre-1960 buildings top out where everything else does
  below 60 ft wide, and NYC's pre-1961 25 ft lots agree at about 6 stories.
- **Large-lot term**, a slenderness cap: `big = min(0.49·w, 0.5·√A)`.
  - `0.49·w` is height ≤ 5 × width at 3.1 m per floor. SF towers top out around 5:1 (max 6.9:1),
    likely from seismic design; tier 0.
  - The `√A` term is NYC Manhattan post-2000 (PLUTO); tier 0 for NYC, applied to SF as tier 3.
  - On large lots SF's own stock is held down by zoning (pre-1960 vs all eras differ only above
    120 ft wide), so SF's data understates the physical limit there.
- **Join** (tier 4, invented): `t = clamp((w − 60)/60, 0, 1)`, so the weight goes from 0 at 60 ft wide
  to 1 at 120 ft. Then:
  - `physicalMax = floor(clamp((1−t)·sf + t·max(sf, big), 5, 80))`
  - The floor of 5 is SF data on sub-20 ft lots. The ceiling of 80 is the generator's `MAX_STORIES`.

| Lot (ft) | Generator today | Hybrid |
| --- | --- | --- |
| 25×100 | 5 | 6 |
| 25×120 | 5 | 7 |
| 50×100 | 7 | 12 |
| 75×100 | 12 | 22 |
| 100×100 | 12 | 40 |
| 137.5×137.5 | 80 | 67 |
| 200×275 | 80 | 80 |

**Where it lives:** a pure `physicalMaxStories(site)` beside `selectTypology` in
`src/lib/generator/`. `generate` clamps S with it before choosing a typology, and the existing area
thresholds in `selectTypology` stay as the typology cascade. Each threshold is recorded with its tier
in the generator's provenance list.

**The cost:** the generator is covered by the `datasetVersion` hash, so stock yields change and a new
dataset version is built and promoted (`docs/dev/pipeline.md`, `docs/dev/deploy.md`).

**What the map shows:**

- The fog shows what zoning allows, not the physical cap.
- The paint feedback and the lot tooltip show what can be built: "Allowed: 40 · Buildable here:
  6". The gap between the two is the point.

### 4. What the map shows

- **The lot dots go.**
- **Painted areas are set apart only while the eraser is selected.** Then each painted area is
  outlined, so you can see what you'd be erasing. At other times the map shows only the limits in
  effect, through the fog.
  - *My call:* brush-protected lots get the same treatment, an outline in a different style shown
    while the eraser is on.
- **Height fog** is a single see-through surface across the whole map, covering roads and open
  space too, not boxes per parcel. Its height at each point is the effective limit there: FZP as
  written plus your painting.
  - It is smoothed between neighbouring limits rather than stepped at every lot line.
  - It is one neutral colour, so it never competes with the transit colours on the ground.
  - Existing and in-progress buildings show through it, so the gap between a building's top and
    the fog is room to grow.
  - It updates as you paint.
  - It is toggled in the view menu and shown in Setup only. *My call:* on by default.
- **Transit:** the same view menu as `/` (transit access and transit stops) is mounted on `/sim`,
  shown in Setup only. Today `FzpMode` hard-codes both off.

### 5. Policy pane

- **Sections, in order:**
  1. Your zoning
  2. Permitting timelines
  3. Protections
- "Zoning layers" is removed.
- *My call:* "Your zoning" opens expanded; the others start collapsed.
- **During a run** all sections are read-only, with **Change policy** at the top of the pane.

### 6. Timeline bar

- **Remove the "Simulation" pill** next to Play.
- **Reserve fixed widths** so nothing moves:
  - the month readout sized to the widest month-year label in the current locale, with
    `tabular-nums`
  - the Play/Pause/Replay button sized to its widest label

### 7. Paint / Simulate switch

- **Tabs, not links.** The current tab looks selected and non-interactive (a filled or raised tab,
  no underline). The other looks pressable.
- `aria-current` stays.

### 8. Palette

Accepted to try (your decision); tune in review once it's on the map. Map tokens live in `src/lib/map/palette.ts` (`TOKENS`, light and dark).
The chrome's only accent today is Tailwind blue-600/700/800.

**The rule is one hue family per meaning:**

- teal = transit
- terracotta = new housing (generated buildings, your brush, the app accent)
- plum = projects already in the pipeline
- red/amber/green = chance only
- uncoloured haze = height limits
- ink = outlines

Blue and violet are left only for water.

| Role | Today | Proposed light | Proposed dark |
| --- | --- | --- | --- |
| Transit capacity ramp 1–5 (ground, 0.45) | steel blue `#E4EEF3`…`#2C6E8F` | `#E0F2EF #B3E0D8 #7CC7BA #3FA596 #167A6E` | `#16282A #1B3E3E #22595A #2E7B78 #4BA59E` |
| Stops: bus / Muni Metro / BART·Caltrain | `#5F6B66 #7B3FA0 #1F5FBF` | `#5E7A76 #0F5A52 #0B3B36` | `#9BB5B0 #7FD6C9 #C2F0E8` |
| Generated buildings | terracotta ramp | unchanged | unchanged |
| Pipeline ghosts: planning / permitted / ready | indigo `#9DB0FF #6F86F0 #4257D6` | `#E3C8DA #C58FB1 #93527F` | `#5A3550 #8A5679 #C08AAE` (pale → strong, like light) |
| Dying ghost | `#D84A4A` | `#C62828` (= unlikely) | `#FF8A80` |
| Chance bars | red/amber/green | unchanged | unchanged |
| Height fog | n/a | white, ~0.3 | `#C8D2D6`, ~0.2 |
| Brush ring paint / erase | `#1D4ED8` / `#BE185D` | `#BF5A3A` solid / `#2B2A28` dashed | `#DB8B42` / `#E8E4DC` |
| Eraser on: painted / protected | lot dots | `#BF5A3A` dashed outline / `#2B2A28` solid outline + hatch | `#DB8B42` / `#E8E4DC` |
| App accent (tabs, Run, Publish, banner, target bars, timeline editing) | Tailwind blue | `#A3472C`, hover `#84371F` | `#E0955A` |
| UI warnings | amber | unchanged | unchanged |
| Dark ground: existing / replaced / road | `#3B3D41 #2A2B2E #2C2E31` | n/a | `#3B3D41 #232427 #34373B` |

**Related fixes that ride along:**

- The transit legend swatches render at the map's 0.45 over land, not at full strength.
- The legend labels match the bin edges. Today the labels read `< 1k, 1k-3k…`, but the bins are
  200/1k/3k/10k/30k (`src/lib/transit/legend.ts`).
- `ViewMenu` takes the map's theme, not its own `matchMedia`.
- Header and toolbars get dark variants.
- Palette contrast tests (`palette.spec.ts`, `style.spec.ts`) are updated to the new tokens.

## Compatibility

- **Saved policies:** `/s` and autosaved docs use `SimDoc` schema 1. `stock`,
  `assumeAlternativePlanKept` and `compare` in old docs are ignored on load (normalised to the new
  baseline and the automatic comparison). *My call:* few such docs exist and they were published
  days ago.
- `?start=fzp` becomes the default and can be dropped (keep the param accepted as a no-op).
- The default policy constant (`DEFAULT_POLICY`, `isDefaultPolicy`) is redefined against the FZP
  baseline. The current-law twin no longer reads `DEFAULT_LEVERS`.

## Left to the builder

- How the fog surface is built: for example a coarse grid sampled from the parcel limits the worker
  holds, smoothed and rendered as a translucent mesh or fill-extrusion. Keep the map perf bar in
  `docs/dev/map-perf.md`.
- How the paint feedback reuses the generated-building pipeline from `/`.
- Outline rendering for painted and protected areas.
- Exact copy for the score and the Run and Change policy buttons.
- Test and doc updates (`docs/dev/sim-page.md`, `sim-levers.md`, `fzp-mode.md`).
