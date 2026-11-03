# /sim UX: layers, shared paint, run HUD

Status: draft (2026-11-02).

## Intent

What `/sim` does is right; how it feels is not. Today it is "a sheet with too many buttons": a white panel of disclosures over a dark map, form-based rule editing, and controls for a running simulation left on screen while you set policy. The aim is a simulation-game feel with direct interaction. The policy reads as layers on the map, you click a layer to select it, you edit it inside its own row, and running the sim works like the time controls in a sim game.

There is a longer-term reason to get this right. The app may become an incremental game: first you get Paint (`/`); building enough housing unlocks the policy simulation; building enough there unlocks funding. That only works if the modes feel like one product. **Where two modes express the same thing, they use the same UI:**
- Paint is one tool with different effects. On `/` it is what gets built; on `/sim` it is what the zoning allows.
- The score looks the same in both.

## What works today and stays

- The permitting timelines UI (`PermittingSection`, `RouteTimeline`): easy to understand. It moves into a tab but keeps its content.
- The zoning layers on the map, the glass lids and contour lines of #57 (`src/lib/map/height/`), look good and are unchanged. Height swatches in the dock use the same neutral ink look (my call): the story number on a neutral tile, with no hue ramp.
- The simulation's behaviour, the levers engine, and how policies save and share.

## Problems this fixes

1. Sheets, notices, popovers and cards ignore dark mode. `PolicyPanel`, every section in it, `PhoneToolBar`, the ScoreBar details popover, `ProjectCardPanel` and the FzpMode notices are `bg-white text-black`.
2. Every notice (e.g. "Updating the simulation for your policy…") pushes the docked policy panel up on desktop. The notice row's height feeds `--fzp-scrubber-h`, and the panel is anchored to that variable (`docs/dev/fzp-mode.md`, "Layout variables").
3. Zoning paint is a regression from `/`'s instant paint. `/sim`'s stroke adapter has no `preview`, so nothing appears while you drag. After you let go, a 2-second flash of up to 300 buildings appears (the "paint feedback"). The same flash fires when a transit rule is saved, which reads as an unexplained blob.
4. Needless copy: "Each lot takes the tallest rule that covers it, never below FZP.", "Add transit rule" (the only kind left), "Later strokes win where they overlap.", and similar.
5. Run-only UI (speed, the scrubber, "Read-only during a run") stays on screen while you set policy, and setup UI stays during a run.
6. Rewinding to the present does not return to setting policy. Only "Change policy" does.
7. Editing a rule opens a form below the list of rules, not in place.

## Goals

### 1. One dock, with tabs

A docked panel on the left (desktop) holds the policy as tabs. It looks like a paint program's panel and uses dark/light tokens.

| Mode | Tabs |
|------|------|
| `/` | Paint |
| `/sim` Set Policy | Transit · Paint · Permits · Protect |
| `/sim` Run | the dock shows **Results** instead of the tabs (Goal 6) |

The tab structure has room for tabs that start locked (the incremental game), but nothing is locked in this work.

### 2. Transit tab: layers you select and edit in place

- Each transit rule is a **layer row**: a height swatch (its tallest band), a name ("Near Muni Metro", from its stop types), and its lot count.
- **FZP baseline** is the last row. It is locked and not editable, with a lock glyph and no explanatory sentence.
- **"+ Transit layer"** adds a layer, selected and expanded, with sensible defaults. A selected layer has a Remove control.
- **The selected row expands in place** to show its editor. It covers everything `RuleBrushForm` does today:
  - stop-type chips;
  - up to 3 distance bands, each with an editable distance and a stories stepper;
  - add and remove a band.

  There is no separate form and no Save. Edits apply as you make them, and undo covers them (my call: direct manipulation over a confirm step).
- **(My call) Invalid states can't be entered**, so nothing waits as a draft and nothing invalid reaches `compileLevers`:
  - an outer band's stepper stops at the inner band's height;
  - band distances can't collide;
  - the last stop-type chip can't be turned off.
- There is **no reordering**. Transit layers combine by taking the tallest, so order means nothing.
- **Selecting on the map:**
  - In Set Policy, with the Move tool, clicking a lot (built or vacant) selects the layer that sets its limit. The Transit tab opens if needed, and the row scrolls into view and expands.
  - If a painted area sets the limit, the Paint tab opens and selects that area.
  - If FZP sets it (no layer, a layer below FZP, or a protected lot), the FZP baseline row is selected.
  - Clicking outside every lot clears the selection.
  - (My call) Vacant lots need a point-to-lot hit test in the worker, because map picking only sees buildings today.
- **Selection on the map** uses the height-limits layer's existing `rule` mode (`src/lib/map/height/limits-style.ts`): the selected layer's lots in ink, everything else dimmed. The `paint` mode, which dashes paint-set lines while a paint tool is chosen, also stays.
- **No building flash on transit edits** (my call). The lids and contours update, the row's lot count updates, and the "Updating…" pill shows progress.

### 3. Paint tab, shared by `/` and `/sim`

One Paint tab component, used by both modes.
- **Tools:** Move / Paint / Erase.
- **Height:** a palette of swatches (`STORY_PRESETS`) plus the stepper for other values.
- **Brush size.**
- **Painted areas:** a list. Each row has:
  - a swatch;
  - an auto name;
  - its stroke and lot counts;
  - Remove when selected.

  Selecting one outlines it on the map. Painted areas keep creation order, where later wins on overlap, as now. There is **no reordering**, so the Move up/down buttons go. Erase areas are rows too, with an eraser swatch, so you can find and remove them.
- **(My call) Rows mean the same thing on both pages.** A row is a run of consecutive strokes at one height, as `/sim`'s brushes already group them. On `/`, rows are derived from the plan's op list. `/` gains:
  - a remove-row edit;
  - lot counts;
  - row outlines, which need new requests in `/`'s editor worker.

  A thinner list on `/` would be two paint experiences (anti-goal).
- **Live preview while dragging, in both modes:** buildings appear under the brush ring mid-stroke, the way `/` does today. On `/sim` they show what the painted lots could hold, the same thing the paint feedback computes now, rate-limited during the stroke.
- **(My call) On `/sim` the preview fades out on release.** Set Policy's map shows the present, and the lids and contours carry the new limit. On `/` the preview stays, because it is the plan. This replaces the post-stroke flash.
- On `/` this replaces `BrushToolbar`'s floating panel. Undo and redo sit at the top of the dock in both modes, and the keyboard shortcuts stay.

### 4. Permits and Protect tabs

`PermittingSection` and `ProtectionsSection` move into their own tabs with their content unchanged, restyled with the dock's tokens for dark and light.

### 5. Score: the same in both modes

- The header score is one component in `/` and `/sim`: a headline number, a progress bar toward the housing target (RHNA for now), and on `/sim` a "vs FZP +N" delta.
- Tapping it flips the dock to its **Results** face (Goal 6), in both modes. On `/` that face shows what the floating Scoreboard card shows today. The floating Scoreboard card goes away.
- **The dock has two faces in both modes:** an editing face (the tabs) and a Results face. A button at the top of Results flips back, in the same place in both modes:
  - **"Edit policy"** on `/sim`. It also ends a run (Goal 6).
  - **"Paint"** on `/`.
- (My call) `/` shows no "vs FZP" delta, because a painted plan has no FZP comparison today.
- **In Set Policy the score shows what it does now:** `at.total` at today, the net homes actually completed since the RHNA baseline. It does not project the policy.
- (My call) The "vs FZP" delta is hidden in Set Policy, where it is about 0, and appears once a run starts.

### 6. Run phase: the dock flips to Results

- **Starting a run:** pressing Play (labelled **Run** in Set Policy) starts it. The policy locks, the dock's tabs swap for **Results**, and the Paint/Transit outlines and the View menu hide, as the Run phase does today.
- **Results** shows the score details at the scrubbed date:
  - homes added and the delta vs FZP alone;
  - a chart of your policy against FZP over time, with a playhead;
  - RHNA progress;
  - the pipeline breakdown;
  - sources (collapsible).

  These are the contents of today's `FzpScorePanel`, rearranged. A by-neighbourhood breakdown on `/sim` needs engine score work, so it is out of scope. `/`'s Results keeps its existing one.
- **"Edit policy"** at the top of Results returns to Set Policy.
- **Development details:** clicking a building pops its project card next to the building (today's `ProjectCardPanel` content, dark/light). It adds the line "Allowed by: <layer name>" when the lot's limit came from a layer (my call, since the data exists in the worker's lot resolution).

### 7. Time controls like a sim game

- The bottom bar has **⏸ Pause · ▶ Play · ▶▶ Faster**, the current year, and the track. There is no speed dropdown.
- (My call) ▶ is 1 year/s and ▶▶ is 3 years/s. The 1 month/s speed goes, because pausing and scrubbing cover close inspection.
- **Markers** on the track are buttons that jump to their date. RHNA deadline and 2045 do that already; Today and the horizon are new.
- **In Set Policy,** the track and markers are disabled and ▶ reads **Run**. It is the one primary action.
- **Scrubbing back to Today,** by dragging, the Today marker or Home, **returns to Set Policy** and unlocks the policy. Replay at the horizon restarts the run and does not return to Set Policy.
  - (My call) A drag returns on release at Today, not when it crosses Today mid-drag.
  - The e2e helpers that press Run, Pause, then Home (`gotoSim`/`gotoFzp` with `run: true`) need a new path to a paused run.

### 8. Notices: a phone-style pill

- Notices ("Updating the simulation…" with its lot progress, the stopped and reroll status, a failed revision, dataset mismatch) are pills at the top centre of the map, just under the header, stacked.
- On desktop they overlay the map and **never move the dock or anything else**. They leave `--fzp-scrubber-h` out.
- On phones they sit in flow under the header and push content down. This is your call, and it means the map resizes while a pill shows. The "Layout that jumps" anti-goal is about desktop.

### 9. Dark and light everywhere

- Every surface in this work follows `prefers-color-scheme`: dock, tabs, rows, pills, the project card, Results and the time bar.
- Colours come from the `@theme` tokens in `src/routes/layout.css`. `TimeScrubber`'s hand-coded hex media query moves onto them too.
- Dark surfaces use `accent-dark` (`#e0955a`) with `on-accent-dark`; light surfaces use `accent` (`#a3472c`).
- This reverses the earlier light-only ruling for these surfaces (`docs/superpowers/plans/2026-10-31-sim-runs-3-palette-and-physical-limits.md`). That ruling was about the light accent's contrast on gray, which the dark accent on dark chrome does not have. `src/lib/shell/accent.spec.ts` changes to match.
- Both themes must meet WCAG 2.2 AA (`docs/dev/accessibility.md`).

### 10. Less copy

- Remove "Each lot takes the tallest rule that covers it, never below FZP.", "Later strokes win where they overlap.", the "New zoning rules" and "Custom zoning" section titles (the tabs replace them), and "Read-only during a run" (Results replaces the panel).
- "Add transit rule" becomes "+ Transit layer".
- Anything that still needs explaining goes behind an ⓘ, not inline.

### 11. Phones

(My call, following the existing phone patterns: compact UI, details on demand, nav in the hamburger.)
- The dock is a bottom sheet with the same tabs.
- Choosing Paint or Erase collapses it to a one-line palette strip (tool, height swatch, size, Done), as `PhoneToolBar` and `/`'s bottom bar do now. It is the same component on `/` and `/sim`.
- In Run, the sheet holds Results at a peek height above the time bar.
- Project cards are a bottom sheet, as now.

### 12. Opening and closing the dock; view mode

(My call)
- **Desktop:** the dock is open by default. It can collapse to a thin rail of tab icons; the header's "Policy" button on `/sim` and "Paint" on `/` toggle it, as "Policy" does now.
- **Phones:** the sheet has a peek handle showing the active tab or face name, and opens from there. It is also reachable from the Menu, as now.
- **View mode (`/s/<id>`):** the editing face shows the policy read-only, restyled from today's `PolicySummary`. The flip button on Results reads "Policy".

## Non-goals

- Unlocks, locked tabs, funding, or any incremental-game progression.
- A "meet or exceed housing need" target. It needs simulated population growth, which is later work. The target stays RHNA.
- Reordering layers, toggling layer visibility, or renaming layers.
- Changes to the simulation engine, the levers model, policy storage or sharing (`/s/<id>` view mode keeps its read-only summary, restyled).
- New transit lever kinds.

## Anti-goals

- **Two paint experiences.** If `/` and `/sim` end up with separate paint components that drift, this has failed even if both look fine.
- **Layout that jumps.** A notice, a recompute or a hover must never move the dock, the time bar or the map's insets.
- **A dark map under light sheets,** or any surface that ignores the colour scheme.
- **Losing what works:** the permitting timelines UI and the look of the lids and contours.

## Constraints

- SvelteKit 2, Svelte 5 runes, Tailwind 4. `md` (768 px) is the desktop/phone breakpoint.
- Header actions go through `useHeaderActions`. The save state stays in the header's status slot.
- CSP is unchanged, and no new runtime dependencies.
- Live preview must keep `/`'s rule of one request in flight, rate-limited.
- Saved and shared policies open unchanged. This work is UI only.

## Left to the builder

- Exact layout dimensions, motion, icons, and the ▶▶ glyph treatment.
- How lot → layer attribution reaches the click handler. `LeverSync.result(key)` already caches each brush's resolved lots, and the worker's `parcelSummary` serves the hover.
- How map clicks are routed between selection (Set Policy, Move tool), strokes (Paint/Erase) and project cards (Run).
- Whether the Results view and the floating `/` Scoreboard share code, as long as the result is one view.
- Splitting this into plan tasks and their order.

## Prior art

- The mockups from this session are in the main checkout, not the worktree: `/Users/mindlace/Projects/sfhousing/.superpowers/brainstorm/28462-1793677433/content/`.
  - `setup-layout-v2.html` (A chosen);
  - `paint-placement-v2.html` (A1 chosen);
  - `run-phase.html` (R1 chosen, with sim-game time controls in place of the speed dropdown).

  They predate some decisions. Where they differ from this document, the document wins:
  - the orange height ramp: the map keeps its neutral lids;
  - the visibility eyes: there are none;
  - notices in the status slot: they are pills.
- The left-hand stack of items in Civilization VI; the layers panels in paint programs.
