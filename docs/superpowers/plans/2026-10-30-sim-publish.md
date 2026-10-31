# /sim Publishing, Local Autosave and Size Limits (Plan 5 of 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `/sim` policy (stock layers, user layer, protections, timelines with their Save snapshot, comparison twin) autosaves in the browser and publishes to an immutable link `/s/<id>`. The link opens a read-only `/sim` with a Remix action. Every load path re-checks the timing against the calibration it runs on.

**Architecture:** A sibling document, `SimDoc` (`{ schema, kind: 'sim', datasetVersion, title?, policy }`), not a new `Plan` schema. Plan sharing's client and server code becomes generic over a small `DocCodec<D>`. The plan codec reproduces today's behaviour, and the sim codec plugs the policy into the same autosave, publish, dedupe, rate limit, D1 table (with a new `kind` column), shared-page load and Remix. A pure `reconcileTiming(timing, calibration)` runs on every load path. It re-resolves the preset by its rule, clamps custom edits to the stage bounds and reports what changed, and the page shows that as a notice.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, Tailwind 4, Drizzle on D1, Vitest (`server` and `client` projects), Playwright with `expectNoA11yViolations`.

**Spec:** `docs/superpowers/specs/2026-10-28-sim-policy-levers-design.md`. Plan 5 owns the partner ruling "`/sim` policies are publishable" (section "Partner rulings after the builder check"). Read it with:

- `docs/dev/plan-sharing.md` and `docs/superpowers/specs/2026-10-10-plan-sharing-design.md` (I13, I16, §4). This plan reuses that API, autosave and Remix, and does not reinvent them.
- `docs/dev/sim-page.md`: the recipe, `PolicyStore`, Call 15 ("No local persistence"), which this plan supersedes.
- `docs/dev/sim-timers.md`: the timing model, Call 2 (edits stored as scales) and Call 3 (resolved numbers), floors and bounds.
- `docs/superpowers/plans/2026-10-30-sim-timers.md`, "Plan sequence": `parseSimPolicy` stays strict for plan 5.

## Plan sequence

This is plan 5 of 5. Plans 1 to 4 are merged on `main` at `c51d6d2`. Work in `.claude/worktrees/sim-publish` (branch `sim-publish`).

## Measured facts this plan relies on

Read from the code at `c51d6d2` on 2026-10-30.

- **The strict preset check bakes in today's constants.**
  - `parseSimPolicy` → `parseTimingSet` rejects any preset not in `AVAILABLE_PRESETS` (`src/lib/sim-page/policy.ts:314`, `:332`).
  - `checkPresetLayer` requires a `benchmarkPermits` scale in `[BENCHMARK_RATIO, 1]`, where `BENCHMARK_RATIO` comes from `timing-sources.ts` (`policy.ts:355`, `:399-411`).
  - So if those constants change, a stored document stops parsing. It also cannot check floors or calibration-derived values (plan 4's carried item 1).
- **Presets resolve against the calibration.**
  - `resolvePreset` (`timing.ts:298-343`) raises a scale to the floor with `withFloor` (`:285-289`).
  - `sb423Clock`'s scale depends on `exitMonth` of the calibration's streamlined `filed` table (`:308-321`).
  - `noDiscretionary`'s shares come from `cal.pathwayForNew` (`:323-330`).
- **Custom edits are scales relative to the calibration's typical months.** `setStageMonths` stores `scale = m / typical0` (`timing.ts:488-507`). Its bounds come from `stageBounds` (`:467-481`), `STAGE_FLOORS` (`timing-sources.ts:224`) and `MIN_SCALE` / `MAX_SCALE`. An edit carries no months. The same scale means different months on another calibration.
- **The policy has no size bounds.**
  - `parseStrokeBody` accepts any positive radius, any finite coordinates and an empty path (`policy.ts:199-209`).
  - There is no cap on the number of strokes.
  - `/sim` strokes come from `BrushController`, which splits a stroke at `PATH_MAX_POINTS` (`BrushController.svelte.ts:444`) and clamps the radius to integer `RADIUS_MIN_M`–`RADIUS_MAX_M` (`src/lib/brush/radius.ts:24-27`).
- **Sizes** (canonical JSON, UTF-8):

  | Document | Bytes |
  | --- | --- |
  | The default policy as a `SimDoc` | 423 |
  | A `benchmarkPermits` set with one edit, custom shares, and a Save snapshot of the same set | 1,420 |
  | One 2,000-point stroke | 48,023 (24 per point) |
  | One minimal one-point stroke (`{"path":[[-122.419416,37.774929]],"radiusM":5}`) | 48 |

  So `MAX_PLAN_BYTES = 262,144` holds about 10,900 points. 5,001 minimal strokes come to about 240,048 bytes, under the byte cap. **Unlike plans, `too_many_ops` is reachable over HTTP for a policy** (`plan-sharing.md` notes it is unreachable for plans).
- **Plan sharing is hard-wired to `Plan`.**
  - `storage.ts` uses `PLAN_KEY` and `parsePlan`.
  - `Autosave` uses `serializePlan`, `rebasePlan` and `emptyPlan` (`autosave.svelte.ts:1`).
  - `publishPlan` posts to `/api/plans` (`publish-client.ts:57`).
  - `PublishButton` and `PublishDialog` take a `Plan`.
  - `handlePublish` uses `parsePlan` and `serializePlan` (`src/lib/server/sharing/publish.ts:47-121`).
  - `loadSharedPlan` uses `parsePlan` (`shared-page.ts:34-64`).
  - The `plan` table has no kind column (`src/lib/server/db/schema/plan.ts`).
- **`/sim` today.**
  - The policy is built from levers at init (`SimPage.svelte:74-76`), and the first policy is skipped by the sync effect (`:132-140`).
  - The load reads only the current dataset (`src/routes/sim/+page.ts:22-45`).
  - The notice row above the scrubber is FzpMode's (`FzpMode.svelte:813-870`).
  - Full-height routes are listed in `src/lib/shell/layout.ts:3`.
  - `App.PageState.sfhRemix` is in `src/app.d.ts`.

## Calls made in this plan

Each call is the builder's unless marked otherwise. Each gives its reason and what it costs if wrong.

1. **A sibling document, not a `Plan` schema bump.** `SimDoc = { schema: 1; kind: 'sim'; datasetVersion; title?; policy: SimPolicy }`.
   - Reason: the spec allows "a sibling document type". `SimLevers` set the precedent (`sim-levers.md`, "The lever document"), and `/`, `/p` and `parsePlan` stay untouched.
   - Cost if wrong: a later merge into `Plan` needs a migration in `MIGRATIONS`.
2. **One D1 table with a new `kind` column; separate endpoints and page.**
   - `plan.kind` is text, not null, default `'plan'`.
   - Policies post to `POST /api/policies` and are read from `GET /api/policies/:id`, with the page at `/s/<id>`. Ids share one space.
   - A `/p/<id>` that is a policy gets a 308 redirect to `/s/<id>`, and the reverse likewise.
   - Reason: dedupe, ids, the takedown runbook and the e2e seed all carry over.
   - Cost if wrong: one migration.
3. **One codec abstraction.** `DocCodec<D>` (Task 1) drives autosave, remix, publish (client and server), GET and the shared load. The plan codec must be byte-for-byte today's behaviour.
   - The record and result field names stay `plan` (`LocalPlanRecord.plan`, `RestoreResult.plan`), so `/` and its tests do not change.
   - Cost if wrong: a rename later.
4. **Size limits: the sim document reuses plan sharing's constants** (spec: "size limits reviewed"). A `SimDoc` must be:
   - at most `MAX_PLAN_BYTES` of canonical UTF-8;
   - at most `OPS_MAX` strokes in total (freehand, erase and protect strokes);
   - 1 to `PATH_MAX_POINTS` points per stroke, each inside `SF_BBOX` after `quantize`;
   - an integer radius from `RADIUS_MIN_M` to `RADIUS_MAX_M`;
   - a title of at most `TITLE_MAX_CHARS`.

   There is no cap on the number of brushes or on name lists: the byte cap bounds them. Reason: one set of limits, already reviewed for plans, and the measured sizes leave room (a timing set is about 1 KB). Cost if wrong: a heavy policy hits 413. The dialog's size line shows that before Publish.
5. **Canonical form.** The serialized form has sorted keys (the existing `canonical`, exported) and coordinates quantized to 1e-6° (as `serializePlan`). `parse(serialize(d))` then serializes to the same text, so dedupe and "Share link" work.
6. **Publish strips the Save snapshot** (`timing.saved = null`, through `codec.publishable`). Autosave keeps it.
   - Reason: the spec calls Save "a named local snapshot". The read-only view has no Revert. Two documents that differ only in the snapshot get one link.
   - Open question 1.
7. **The load-path rule (carried item 1).** `reconcileTiming` never rejects a document. On each set (`current` and `saved`):
   1. A preset that is no longer available becomes `observed`.
   2. The preset layer (`presetTimers`, `presetRouteShares`, `localProgramStreamlined`) is replaced by `resolvePreset(preset, cal)` when it differs (scale tolerance 1e-9).
   3. An edit on a stage the calibration has no table for is dropped.
   4. Every other edit goes through `setStageMonths(cal, set, p, st, scale × typical0)`, which clamps it to `stageBounds`. That removes an edit equal to the preset's months.
   5. Custom route shares are kept.

   It returns the same object, with no changes, when nothing moved. The page shows one notice listing the changes.
   - Reason: an immutable link must open. Clamping is what the anti-goal "durations below physical minimums" requires. Re-resolving a preset by its rule keeps the preset's sourced meaning. A "Custom" label would credit sourced presets to the user.
   - Cost if wrong: a refit link differs from what its author saw, with a notice saying so.
8. **Strict to publish, lenient to load.** `parseSimPolicy(json, { presetLayer })`.
   - `'strict'` (the default) is plan 4's check. The server's publish and the in-memory tests use it.
   - `'reconcile'` accepts any `PresetId` and skips `checkPresetLayer` except `editableOnce` and the shapes. GET, the shared page, autosave and the Remix hand-off use it, and `reconcileTiming` fixes the values.
   - Reason: a revised constant must not make stored links 500.
9. **A link opened on a newer dataset (carried item 3).**
   - `/s/<id>` renders on the document's own `datasetVersion` (I16, as `/p`), so its resolved numbers match.
   - Only the fallback (the version's manifest is gone, N6), Remix (onto current) and an autosave restore across versions run on another calibration. There, Call 7 applies: presets are re-resolved by rule, and custom edits keep their **scale** (the relative change) and are clamped.
   - Reason: edits carry only a scale (plan 4 Call 2). Recovering months would mean fetching the old calibration.
   - Open question 4. Cost if wrong: a custom "6 months" becomes `6 × t0_new / t0_old` months.
10. **The server does not check the calibration at publish.**
    - Reason: the load path must reconcile anyway (code changes, fallback datasets), so a server check adds an R2 read and a second failure mode without protecting a viewer more.
    - Cost if wrong: a hand-crafted document is stored, and it opens refit with a notice.
11. **Autosave key `sfhousing:sim:v1`, separate from `/`'s.**
    - Same record shape, 500 ms debounce, flush on `visibilitychange → hidden` and `pagehide`, Autosave off chip and corrupt preservation (`sfhousing:sim:corrupt:<ISO>`).
    - The title lives in the document. Undo history is not persisted.
12. **Restore runs in SimPage's `onMount`.**
    - `store.reset(policy)` clears history; it is not an undoable change.
    - `levers` becomes `compileLevers(policy, () => [])`: the policy without its lot lists, a valid `SimLevers`.
    - Then `sync.update(policy)` resolves the brushes and sends the full levers.
    - Whether FzpMode's `initScenario` goes before or after is not material: a later `setLevers` corrects it.
13. **`start=fzp` defers autosave.** No restore, and nothing is written until the first change. If a non-default policy is saved, a notice says "Showing the Family Zoning Plan comparison. Your saved policy is kept until you change something here." with a link "Open your policy" (`/sim`).
    - Reason: visiting `/fzp` must not destroy work (spec: `/fzp` links open "with the user layer empty").
    - Open question 2.
14. **"Empty" means the default policy.**
    - A policy equal to `policyFromLevers(DEFAULT_LEVERS)` (ignoring `saved`) cannot be published. The button is disabled with "Change the policy first.", and the server answers 422 `empty_plan`.
    - The FZP-compatibility policy is publishable.
    - `op_count` is brushes plus protect strokes.
15. **The read-only view is a summary.**
    - `PolicyPanel` gains `view: 'summary'`, rendering `PolicySummary`. It lists:
      - the layers on, the comparison and the alternative-plan toggle;
      - the brushes, through `brushSummary`;
      - the protections;
      - the timing label, route shares and each stage that differs from observed.
    - The view has no tools, no undo and no Publish. Lot dots still draw.
    - Reason: compact UI with details on demand; disabled controls would be clutter.
    - Task 0 shows the layout.
16. **Plans and policies share one rate limit:** `PUBLISH_RL`, key `publish:<ip>`, 10 per 60 s together. Open question 5.
17. **The seed is not published.** The link opens the representative future (`?seed=` still works on `/s/<id>`). Cost if wrong: an author who rerolled sees another future in the link.
18. **Copy per kind.**
    - `copyFor(kind)` returns the kind's strings. The plan's strings are today's `COPY` and helpers, unchanged.
    - The policy's strings say "policy" where the plan's say "plan", and its size advice says "Try fewer or shorter strokes, or fewer brushes."
    - The Remix confirm asks when the local policy is non-default: "Replace your current policy with a copy of this one? Your current policy will be lost unless you publish it first."
19. **`SimRoute.svelte`.** `/sim`'s page body (seed handling, `{#key}` remounts) moves into `src/lib/sim-page/SimRoute.svelte`, so `/sim` and `/s/<id>` share it. The `/sim` load becomes `loadSimScenario(version, current, fetch)` in `src/lib/sim-page/load.ts`.

## Global Constraints

- **Spec ruling:** "`/sim` policies are publishable. A policy (stock-layer toggles, user layer, protections, route timelines and shares, comparison twin) is saved locally and can be published as an immutable link, like editor plans (`docs/dev/plan-sharing.md`)… server validation with size limits reviewed (`MAX_PLAN_BYTES`, `OPS_MAX`), and a read-only shared view of `/sim` with a Remix action. Timeline **Save** is a named local snapshot inside the current policy. Publishing captures the current policy as a whole."
- **Spec anti-goals:** no setting decides directly how much gets built; no duration below a sourced minimum (reconcile clamps; Call 7); hard choices stay visible (the summary shows protections).
- **I16:** a published document renders on its own `datasetVersion`, falling back to current only when that manifest 404s (N6). A locally autosaved document is rebased to current on load (N3).
- **Determinism:** the simulation is deterministic in `(dataset, levers, seed)`; a published document's canonical form is deterministic (Call 5).
- **The plan side is unchanged.** `/`, `/p/<id>`, `/api/plans` and every existing sharing test keep their behaviour and copy. `GET /api/plans/:id` never serves a policy, nor `GET /api/policies/:id` a plan.
- **Privacy, as plan sharing:** no IP, user agent or personal data stored; the rate-limit key is never logged.
- **WCAG 2.2 AA** (`docs/dev/accessibility.md`):
  - every new control has a visible label and keyboard access, with targets of at least 24 × 24 px;
  - live regions stay in the accessibility tree while empty;
  - no horizontal scroll at 375 px;
  - the banner and notices never cover the map's controls (2.4.11).
- **Compact UI, details on demand:** a notice is one line with its details in a disclosure; the header gains only the Saved indicator and Publish.
- **Stack and style:**
  - Svelte 5 runes; colocated Vitest; `expect.requireAssertions` (every test calls `expect`);
  - 2-space indent, single quotes, no trailing commas, 100 columns;
  - `src/lib/sim-page/policy.ts`, `sim-doc.ts` and `reconcile.ts` stay pure TS (the server imports them);
  - schema changes go through `npm run db:generate` then `npm run db:migrate`, and migrations are never hand-edited.
- **CSP:** no change. **No new runtime dependency.** **No dataset bump.**
- **Shell and worktree:** never compound `cd … && cmd`. Work only in `.claude/worktrees/sim-publish`.
- **No push, no upload.** `npm run signoff` runs once, after the last task, when the controller asks.
- **Commits:** Conventional Commits with `-m` flags only (no heredoc), and `-m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"` as the last `-m`.

## Review Focus

1. **A stored or autosaved document that no longer validates.** A bad shape, a future schema, an unavailable preset, a preset scale outside today's range, or an edit below a floor:
   - the bad shape and the future schema are preserved under the corrupt key, and the page starts on the default with the notice;
   - the rest open refit with the timing notice, and never 500.

   Tests: Task 2 `lenient parse accepts a retired preset and an out-of-range benchmark scale`; Task 3 `an edit below the floor is raised and reported`; Task 5 `a corrupt record is kept and the page starts on the default`.
2. **Reloading must not nag.** A just-resolved, unedited or freshly autosaved policy reconciles to the same object with no changes. Reconcile is idempotent. Tests: Task 3 `reconcile of a resolved set is identity`, `reconcile is idempotent`; Task 5 `a reload shows no timing notice`.
3. **Publishing the same policy twice, or after only a Save.** The same link comes back (dedupe), and the button reads "Share link" until the policy or title changes. Tests: Task 2 `publishable strips the snapshot and serialize is stable`; Task 4 `a second publish of the same document returns 200 with the first id`; Task 5 `Share link after publish, Publish again after an edit`.
4. **Storage unavailable or full on `/sim`.** Editing continues, the header shows "Autosave off", and the first successful write clears it. Test: Task 5 `quota errors show Autosave off and recover`.
5. **The wrong kind at the wrong door.**
   - A policy id at `/p/<id>` redirects to `/s/<id>`, and the reverse likewise.
   - `/api/plans/<policy id>` is 404, and the reverse likewise.
   - A policy's 5,001 one-point strokes give 422 `too_many_ops`.

   Tests: Task 4 `kind mismatch redirects the page and 404s the API`, `too_many_ops is reachable for policies`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/sharing/doc-codec.ts` (new) | `DocKind`, `DocCodec<D>`, `PLAN_CODEC` |
| `src/lib/sharing/storage.ts`, `autosave.svelte.ts`, `remix.ts`, `publish-client.ts`, `copy.ts`, `PublishButton.svelte`, `PublishDialog.svelte`, `SharedBanner.svelte` | Generic over a codec; plan behaviour unchanged |
| `src/lib/sim-page/policy.ts` | `parseSimPolicy(json, opts)`; export `canonicalJson` |
| `src/lib/sim-page/sim-doc.ts` (new) | `SimDoc`, parse, serialize, limits, `isDefaultPolicy`, `SIM_CODEC` |
| `src/lib/sim-page/reconcile.ts` (new) | `reconcileTiming`, change text |
| `src/lib/server/db/schema/plan.ts`, `migrations/d1/*` (generated) | `kind` column |
| `src/lib/server/sharing/publish.ts`, `get-plan.ts`, `shared-page.ts`, `store.ts`, `e2e-seed.ts` | Codec-driven; kind filter and redirects |
| `src/routes/api/policies/+server.ts`, `src/routes/api/policies/[id]/+server.ts` (new) | Thin wrappers |
| `src/lib/sim-page/policy-store.svelte.ts` | `PolicyStore.reset` |
| `src/lib/sim-page/sim-session.ts` (new) | `restoreSimDoc`: restore, rebase, reconcile, notices |
| `src/lib/sim-page/SimPage.svelte`, `src/lib/fzp/FzpMode.svelte` | Persistence, Publish and Saved in the header, `mode: 'edit' \| 'view'`, `notices` snippet |
| `src/lib/sim-page/SimRoute.svelte`, `load.ts` (new); `src/routes/sim/+page.svelte`, `+page.ts` | Shared route body and load |
| `src/lib/sim-page/PolicySummary.svelte` (new), `PolicyPanel.svelte` | Read-only summary |
| `src/routes/s/[id]/+page.server.ts`, `+page.ts`, `+page.svelte`, `+error.svelte` (new); `src/lib/shell/layout.ts`; `src/app.d.ts` | The shared view and Remix |
| `e2e/sim-share.spec.ts` (new), `e2e/helpers/sharing.ts` | End to end |
| `docs/dev/plan-sharing.md`, `docs/dev/sim-page.md`, `docs/dev/sim-timers.md`, `CLAUDE.md` | Docs |

---

### Task 0: Read-only view and header mockups (controller, with the partner)

The spec asks for layouts to go to the partner before building ("Left to the builder"). The visual companion is a standing opt-in: launch it directly.

**Proposed layout** (the plan is executable under it):

- **`/sim` header (edit):** "Policy", then "Saved" / "Saving…" / "Autosave off", then "Publish" (or "Share link"), then "Another future". Below md they sit in the phone Menu, with the score bar pinned as today.
- **`/s/<id>`:**
  - The banner from `/p` sits above the map: "**<title or 'Untitled policy'>** · Shared policy · published <date>", with Remix and Start your own. Start your own goes to `/sim`.
  - The header has "Policy" (opens the summary) and "Another future".
  - The panel's title is "Policy (read-only)". On md+ it docks open by default, as on `/sim`.
- **Summary:** one compact block per section:
  - "Zoning layers: Current law" and "Compared with: the City's current rules";
  - one line per brush;
  - "Protections: rent-controlled buildings; 12 lots by brush";
  - "Permitting timelines: Custom (from Permits at San Diego's pace)", with a disclosure listing the shares and each changed stage ("Permit review, discretionary: 6 months (observed 12)").
- **Notices** sit in FzpMode's notice row above the scrubber, one line each. The timing notice has a "Details" disclosure.

- [ ] **Step 1:** Build static mockups (md+ and 375 px) of the `/sim` header and of `/s/<id>`, with the banner, the summary panel and a refit notice.
- [ ] **Step 2:** Show the partner. Record "Layout (approved <date>)" here. If there is no answer when Task 5 starts, build the proposal and flag it in the task report.

### Task 1: `DocCodec` and generic plan sharing (plan behaviour unchanged)

**Files:**
- Create: `src/lib/sharing/doc-codec.ts`, `src/lib/sharing/doc-codec.spec.ts`
- Modify:
  - `src/lib/sharing/storage.ts` (key and parse from the codec);
  - `autosave.svelte.ts` (`Autosave<D>`);
  - `remix.ts`;
  - `publish-client.ts` (`publishDoc`; `publishPlan` stays as a wrapper);
  - `copy.ts` (`copyFor`);
  - `PublishButton.svelte` and `PublishDialog.svelte` (generic `D`, `codec` prop);
  - `SharedBanner.svelte` (`confirmText` replaces `localOpCount`, and kind copy);
  - `src/routes/+page.svelte` and `src/routes/p/[id]/+page.svelte` (pass `PLAN_CODEC`);
  - existing specs only where a signature changed.

**Interfaces:**
- Produces:

```ts
// doc-codec.ts
import type { PlanError, Result } from '$lib/plan';
export type DocKind = 'plan' | 'sim';
export interface DocCodec<D> {
  readonly kind: DocKind;
  readonly api: '/api/plans' | '/api/policies';
  path(id: string): string;                    // '/p/<id>' | '/s/<id>'
  readonly storageKey: string;                 // 'sfhousing:plan:v1' | 'sfhousing:sim:v1'
  corruptKey(iso: string): string;
  parse(text: string): Result<D>;              // strict: what publish accepts
  load(text: string): Result<D>;               // lenient: stored and autosaved documents
  serialize(d: D): string;                     // canonical
  publishable(d: D): D;                        // what Publish sends (identity for plans)
  schema(d: D): number;
  datasetVersion(d: D): string;
  rebase(d: D, version: string): D;
  empty(version: string): D;
  isEmpty(d: D): boolean;                      // plans: no ops
  opCount(d: D): number;
  title(d: D): string | undefined;
  withTitle(d: D, t: string | undefined): D;
}
export const PLAN_CODEC: DocCodec<Plan>;
// storage.ts: readRecord(storage, codec = PLAN_CODEC), writeRecord(storage, record, codec = PLAN_CODEC),
//   preserveCorrupt(storage, raw, now, codec = PLAN_CODEC); PLAN_KEY and corruptKey stay exported.
// autosave.svelte.ts: class Autosave<D = Plan>; constructor opts gain `codec?: DocCodec<D>`;
//   restore(handoff?) → { plan: D; notice }, schedule(d: D), setLastPublished(lp, d: D).
//   restore() reads with codec.load; the handoff is parsed with codec.load.
// remix.ts: remixToLocal<D>(doc: D, current, storage, now?, codec?) ; localDoc<D>(storage, codec): D | null
// publish-client.ts: publishDoc<D>(codec, doc, opts) → PublishOutcome  (POSTs codec.serialize(doc) to codec.api)
// copy.ts: copyFor(kind: DocKind): ShareCopy   // ShareCopy: today's COPY keys plus the helper fns
// PublishButton / PublishDialog: props { codec: DocCodec<D>; doc: D; ... } (the `plan` prop renamed `doc`);
//   they hash and send codec.serialize(codec.publishable(withTitle(doc, title))).
// SharedBanner: props gain `kind: DocKind`; `localOpCount` is replaced by `confirmText: () => string | null`.
```

- [ ] **Step 1: Failing tests** (`doc-codec.spec.ts`):
  - `PLAN_CODEC serializes as serializePlan`: for `small.json`, `PLAN_CODEC.serialize(p) === serializePlan(p)`. `parse` and `load` equal `parsePlan`.
  - `PLAN_CODEC is empty only with no ops`; `publishable is identity`; `storageKey === 'sfhousing:plan:v1'`; `path('abcdEFGH') === '/p/abcdEFGH'`.
  - `copyFor('plan') matches COPY`: every key of `COPY` is deep-equal, and `copyFor('plan').tooLarge(300_000)` equals `tooLarge(300_000)`.
  - `copyFor('sim') says policy`: `dialogHeading === 'Publish this policy'` and `disabledHint === 'Change the policy first.'`.
  - A test codec (an in-file `{ n: number }` document): `Autosave` with that codec writes under its `storageKey`, and `readRecord(storage, codec)` reads it back.
- [ ] **Step 2:** Run `npx vitest --run --project server src/lib/sharing/doc-codec.spec.ts` (or `--project client` if `Autosave` needs runes there, matching `autosave.svelte.spec.ts`). Expected: FAIL.
- [ ] **Step 3:** Implement. `/` and `/p/<id>` pass `PLAN_CODEC` and `doc={editor.plan}`. `/p` passes `confirmText={() => { const n = localOpCount(getStorage()); return n >= 1 ? remixConfirm(n) : null; }}`.
- [ ] **Step 4:** Run `npx vitest --run --project server src/lib/sharing src/lib/server/sharing` and `npx vitest --run --project client src/lib/sharing src/routes/p src/routes/page`. Expected: PASS, with every existing sharing test unchanged except for renamed props.
- [ ] **Step 5:** Commit: `refactor(sharing): drive autosave, publish and remix through a document codec`.

### Task 2: The sim document: parse, serialize, limits and `SIM_CODEC`

**Files:**
- Create: `src/lib/sim-page/sim-doc.ts`, `src/lib/sim-page/sim-doc.spec.ts`
- Modify: `src/lib/sim-page/policy.ts`:
  - `:316-341` (`parseTimingSet` takes the mode);
  - `:362-415` (`checkPresetLayer` runs only when strict);
  - `:417-476` (`parseTiming` and `parseSimPolicy` take `opts`);
  - `:480-490` (export `canonical` as `canonicalJson`).
- Modify: `src/lib/sim-page/policy.spec.ts`

**Interfaces:**
- Consumes: `DocCodec`, `copyFor` (Task 1); `quantize`, `MAX_PLAN_BYTES`, `OPS_MAX`, `PATH_MAX_POINTS`, `RADIUS_MIN_M`, `RADIUS_MAX_M`, `SF_BBOX`, `TITLE_MAX_CHARS`, `PlanError`, `Result` (`$lib/plan`); `DATASET_VERSION_RE`.
- Produces:

```ts
// policy.ts
export function parseSimPolicy(json: unknown, opts?: { presetLayer?: 'strict' | 'reconcile' }): SimPolicy;
export function canonicalJson(v: unknown): string;
// sim-doc.ts
export const SIM_DOC_SCHEMA = 1;
export const SIM_KEY = 'sfhousing:sim:v1';
export interface SimDoc { schema: 1; kind: 'sim'; datasetVersion: string; title?: string; policy: SimPolicy }
export const DEFAULT_POLICY: SimPolicy;                      // policyFromLevers(DEFAULT_LEVERS)
export function isDefaultPolicy(p: SimPolicy): boolean;      // canonical equal, ignoring timing.saved
export function simDocProblems(d: SimDoc): PlanError[];      // Call 4 limits, bytes last
export function parseSimDoc(text: string, mode: 'strict' | 'reconcile'): Result<SimDoc>;
export function serializeSimDoc(d: SimDoc): string;         // canonicalJson, coordinates quantized
export const SIM_CODEC: DocCodec<SimDoc>;                    // parse = strict, load = reconcile
```

Error mapping in `parseSimDoc` (so `errorForParse` works unchanged):

| Condition | `PlanErrorCode` |
| --- | --- |
| Not JSON | `not-json` |
| Not an object | `not-object` |
| `schema` above 1 | `future-schema` (with `FUTURE_SCHEMA_MESSAGE`) |
| Missing or other `schema`, or `kind !== 'sim'` | `unknown-schema` |
| A bad `datasetVersion` or title, or a `PolicyFormatError` | `bad-field` at `/policy/<path>` |
| Strokes over `OPS_MAX` | `too-many-ops` |
| Points over `PATH_MAX_POINTS` | `too-many-points` |
| A point outside `SF_BBOX` or a radius out of range | `out-of-bounds` |
| Bytes over `MAX_PLAN_BYTES` | `too-large` |

- [ ] **Step 1: Failing tests** (`sim-doc.spec.ts`; plus `policy.spec.ts`):
  - `serialize round-trips`: for the default, an FZP-compat, a timing-heavy and a brush-heavy document, `serializeSimDoc(parseSimDoc(serializeSimDoc(d), 'strict').value) === serializeSimDoc(d)`.
  - `coordinates are quantized`: a point `[-122.41941649, 37.7749291]` serializes as `[-122.419416,37.774929]`.
  - `publishable strips the snapshot and serialize is stable`: two documents that differ only in `timing.saved` give equal `SIM_CODEC.serialize(SIM_CODEC.publishable(d))`.
  - `the default policy is empty, FZP compat is not`: `SIM_CODEC.isEmpty` is true for `DEFAULT_POLICY` (with or without a snapshot) and false for `policyFromLevers(FZP_COMPAT_LEVERS)`.
  - `limits`, each giving the code:
    - 5,001 one-point strokes give `too-many-ops`;
    - a 2,001-point path gives `too-many-points`;
    - an empty path gives `bad-field`;
    - `[0, 0]` gives `out-of-bounds`;
    - radius 4, radius 501 and radius 30.5 give `out-of-bounds`;
    - a 121-character title gives `bad-field`;
    - a document of 262,145 bytes gives `too-large`;
    - `schema: 2` gives `future-schema`;
    - `kind: 'plan'` gives `unknown-schema`.
  - `the measured sizes hold`: the default document serializes to at most 512 bytes. The timing-heavy one (a benchmark set, one edit, custom shares and a snapshot) is at most 2,048.
  - `lenient parse accepts a retired preset and an out-of-range benchmark scale`:
    - `parseSimPolicy(x, { presetLayer: 'reconcile' })` accepts `preset: 'ceqaInfill'` and a `benchmarkPermits` timer with scale 0.3;
    - strict rejects both (`PolicyFormatError` at `timing.current.preset` and `timing.current.presetTimers[0]`);
    - both modes reject an edit with `reach: 'new'` and duplicate edits.
- [ ] **Step 2:** Run `npx vitest --run --project server src/lib/sim-page/sim-doc.spec.ts src/lib/sim-page/policy.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. `SIM_CODEC`:
  - `opCount` = `brushes.length + protect.strokes.length`;
  - `rebase` rewrites only `datasetVersion` (reconcile is Task 3's and runs where a calibration exists);
  - `empty(v)` is `{ schema: 1, kind: 'sim', datasetVersion: v, policy: DEFAULT_POLICY }`.
- [ ] **Step 4:** Rerun (PASS), then `npx vitest --run --project server src/lib/sim-page` (PASS).
- [ ] **Step 5:** Commit: `feat(sim-page): the sim policy document, its canonical form and size limits`.

### Task 3: `reconcileTiming` (carried items 1 and 3)

**Files:**
- Create: `src/lib/sim-page/reconcile.ts`, `src/lib/sim-page/reconcile.spec.ts`

**Interfaces:**
- Consumes: `resolvePreset`, `setStageMonths`, `PRESETS`, `SimTiming`, `TimingSet` (`timing.ts`); `typicalMonths` (through `setStageMonths` and a local memo, as `timing.ts:230-240`).
- Produces:

```ts
export type TimingChange =
  | { set: 'current' | 'saved'; kind: 'preset-unavailable'; preset: PresetId }
  | { set: 'current' | 'saved'; kind: 'preset-refit'; preset: PresetId }
  | { set: 'current' | 'saved'; kind: 'edit-dropped'; pathway: Pathway; stage: TimedStage }
  | { set: 'current' | 'saved'; kind: 'edit-clamped'; pathway: Pathway; stage: TimedStage;
      months: number; bound: 'min' | 'max' };
export function reconcileTiming(t: SimTiming, cal: Calibration): { timing: SimTiming; changes: TimingChange[] };
export function changeText(c: TimingChange): string;
// 'SF as observed is used: <preset name> is no longer offered'
// '<preset name> was re-computed for this data'
// '<Stage label>, <route>: removed (this route has no such stage in this data)'
// '<Stage label>, <route>: raised to the minimum, <months> months' | '…: lowered to the maximum, …'
```

The rule is Call 7, in its order. An edit whose months land within 1e-9 of the old ones and that is not removed is not a change. A set with no change keeps its identity, and so does `t` when both sets are unchanged.

- [ ] **Step 1: Failing tests** (on the fixture-0 calibration, plus a hand-made calibration where noted):
  - `reconcile of a resolved set is identity`: for every available preset, `reconcileTiming({ current: resolvePreset(id, cal), saved: null }, cal)` returns the same `timing` object and `changes: []`. The same holds after one `setStageMonths` edit inside the bounds.
  - `reconcile is idempotent`: reconciling the output again gives identity and no changes.
  - `a tampered preset scale is re-resolved`: `benchmarkPermits` with scales 0.3 becomes `resolvePreset('benchmarkPermits', cal).presetTimers`, with one `preset-refit`.
  - `a retired preset becomes observed`: `preset: 'ceqaInfill'` becomes `'observed'`, with one `preset-unavailable`, and its edits are kept (clamped).
  - `an edit below the floor is raised and reported`: a discretionary `permitFiled` edit with `scale = 0.1 / typical0` becomes the floor's months, with `edit-clamped`, `bound: 'min'` and months equal to `stageBounds(...).min`.
  - `an edit on a missing table is dropped`: a `permitOnly` `filed` edit (permit only has no `filed` table) gives `edit-dropped`.
  - `on another calibration, edits keep their scale`: a hand-made calibration whose discretionary `permitFiled` typical is twice fixture-0's keeps an in-bounds edit's scale within 1e-9. Its shown months double (Call 9).
  - `the snapshot is reconciled too`: a `saved` set with a tampered preset gives a change with `set: 'saved'`.
  - `changeText` gives the copy above for each kind.
- [ ] **Step 2:** Run `npx vitest --run --project server src/lib/sim-page/reconcile.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun (PASS). Commit: `feat(sim-page): reconcile a loaded policy's timelines with the calibration`.

### Task 4: Server: `kind` column, `/api/policies`, the shared load and redirects

**Files:**
- Modify:
  - `src/lib/server/db/schema/plan.ts` (`kind: text('kind').notNull().default('plan')`), then run `npm run db:generate` and `npm run db:migrate`;
  - `src/lib/server/sharing/publish.ts` (`handlePublish(event, codec, deps)`);
  - `get-plan.ts` (`handleGetPlan(event, codec)`, with a 404 when `row.kind !== codec.kind`);
  - `shared-page.ts` (`loadSharedDoc(codec, args)`; `loadSharedPlan` stays a wrapper);
  - `store.ts` (the row includes `kind`);
  - `e2e-seed.ts` (optional `kind` in the payload, default `'plan'`; `opCount` through the codec's `load`);
  - `src/routes/api/plans/+server.ts`, `[id]/+server.ts`, `src/routes/p/[id]/+page.server.ts` (pass `PLAN_CODEC`).
- Create: `src/routes/api/policies/+server.ts`, `src/routes/api/policies/[id]/+server.ts`, `src/routes/api/policies/server.spec.ts`, `src/routes/api/policies/[id]/server.spec.ts`
- Test: the existing `src/lib/server/sharing/*.spec.ts` and `src/routes/api/plans/**/server.spec.ts` (unchanged results)

**Interfaces:**
- Consumes: `PLAN_CODEC` (Task 1), `SIM_CODEC` (Task 2).
- Produces:

```ts
export async function handlePublish(event, codec: DocCodec<unknown>, deps?: PublishDeps): Promise<Response>;
export async function handleGetPlan(event, codec: DocCodec<unknown>): Promise<Response>;
export interface SharedDocData<D> { id: string; doc: D; createdAt: string; currentDatasetVersion: string;
  datasetNotice: DatasetNotice }
export async function loadSharedDoc<D>(codec: DocCodec<D>, args: { id; platform; current }): Promise<SharedDocData<D>>;
// Throws redirect(308, other.path(id)) when the row's kind is the other codec's (CODECS by kind);
// error(404) and error(500, copyFor(kind).unparsable) as today. Parses with codec.load (lenient).
export const CODECS: Record<DocKind, DocCodec<unknown>>;     // in doc-codec.ts or a server-side map
```

`handlePublish` keeps today's nine steps and their order. It uses `codec.parse`, then `codec.isEmpty` (422 `empty_plan`), the manifest head for `codec.datasetVersion`, and dedupe on `sha256Hex(codec.serialize(doc))`. The row carries `kind`, `schema: codec.schema(doc)` and `opCount: codec.opCount(doc)`.

- [ ] **Step 1: Failing tests:**
  - `POST /api/policies`, on the D1 shim with `FakeR2Bucket`:
    - a valid policy returns 201 with `Location: /s/<id>`, and the row's `kind` is `'sim'`;
    - `a second publish of the same document returns 200 with the first id`;
    - the default policy gets 422 `empty_plan`;
    - `too_many_ops is reachable for policies`: 5,001 one-point strokes under 262,144 bytes give 422 `too_many_ops`;
    - 262,145 bytes give 413;
    - `kind: 'plan'` in the body gives 422 `unsupported_schema`;
    - a tampered `benchmarkPermits` scale gives 422 `invalid_plan` with details;
    - the rate limit is shared: in a non-development environment, with a limiter mock that denies, both `/api/plans` and `/api/policies` return 429 under the key `publish:<ip>`.
  - `kind mismatch redirects the page and 404s the API`:
    - `GET /api/plans/<policy id>` returns 404, and `GET /api/policies/<plan id>` returns 404;
    - `loadSharedDoc(PLAN_CODEC, policy id)` throws a 308 to `/s/<id>`, and the reverse throws a 308 to `/p/<id>`.
  - `a stored policy that fails strict parsing still loads`: a row seeded with a tampered scale parses through `loadSharedDoc(SIM_CODEC, …)`.
  - The existing plan specs pass unchanged.
- [ ] **Step 2:** Run `npx vitest --run --project server src/lib/server/sharing src/routes/api src/routes/p`. Expected: FAIL.
- [ ] **Step 3:** Implement. Edit the schema, run `npm run db:generate` (check that the generated SQL adds the column with its default, and do not edit it), then `npm run db:migrate`.
- [ ] **Step 4:** Rerun (PASS). Commit: `feat(sharing): publish and serve /sim policies beside plans`.

### Task 5: `/sim` autosave, restore and Publish

**Files:**
- Create: `src/lib/sim-page/sim-session.ts`, `src/lib/sim-page/sim-session.spec.ts`
- Modify:
  - `src/lib/sim-page/policy-store.svelte.ts` and its spec (`reset`);
  - `src/lib/sim-page/SimPage.svelte`;
  - `src/lib/fzp/FzpMode.svelte` (an optional `notices?: Snippet` rendered inside the ready-phase notice row, `:813-870`, so its height joins `noticeH`);
  - `src/lib/sim-page/SimPage.svelte.spec.ts`;
  - `src/app.d.ts` (`sfhSimRemix?: { from: string; doc?: string }`).

**Interfaces:**
- Consumes: `SIM_CODEC`, `isDefaultPolicy` (Task 2); `reconcileTiming`, `changeText` (Task 3); `Autosave`, `copyFor`, `PublishButton`, `SaveIndicator` (Task 1).
- Produces:

```ts
// policy-store.svelte.ts
reset(p: SimPolicy): void;                 // replaces the policy and clears undo and redo
// sim-session.ts (pure; the notices are data)
export interface SimNotice { id: 'corrupt' | 'future' | 'rebased' | 'timing' | 'remix' | 'fzp-kept';
  text: string; details?: string[]; tone?: 'info' | 'toast'; link?: { href: string; label: string } }
export function restoreSimDoc(r: { plan: SimDoc; notice: AutosaveNotice | null }, cal: Calibration,
  remixFrom?: string): { doc: SimDoc; notices: SimNotice[] };
// SimPage props gain:
mode?: 'edit' | 'view';                    // default 'edit'
initialPolicy?: SimPolicy;                 // view: the shared document's policy
title?: string;                            // view: shown in the banner, not edited
persist?: 'restore' | 'deferred' | 'off';  // edit: 'restore', or 'deferred' under start=fzp; view: 'off'
remix?: { from: string; doc?: string };    // the hand-off from /s/<id>
```

Behaviour:
- **`persist: 'restore'`.** In `onMount`, run `autosave.restore(remix?.doc)` and then `restoreSimDoc`. Then:
  - `store.reset(doc.policy)` and `title = doc.title`;
  - set `levers` to `compileLevers(doc.policy, () => [])`, then `sync.update(doc.policy)` (Call 12);
  - render the notices through FzpMode's `notices` snippet;
  - when there was a remix, `replaceState('', {})` (no re-toast, as on `/`).
- **Every change autosaves.** An `$effect` on `store.policy` and `title` schedules `{ schema: 1, kind: 'sim', datasetVersion, title, policy }`, and `autosave.attach()` flushes on hide.
- **`'deferred'`.** No restore. If `localDoc(storage, SIM_CODEC)` is non-default, show the `fzp-kept` notice (Call 13). The first change after mount starts scheduling.
- **The header actions** (`actions` snippet) are "Policy", then `<SaveIndicator>` and `<PublishButton codec={SIM_CODEC} doc={…} lastPublished={autosave.lastPublished}>`. On publish, set `title` from the published document and call `autosave.setLastPublished`.
- **The timing notice text** is "Some permitting timelines were re-fit to the data this simulation runs on.", with a "Details" disclosure listing `changeText` for each change.

- [ ] **Step 1: Failing tests:**
  - `sim-session.spec.ts` (server):
    - an unchanged restore gives no notices;
    - a rebased record gives the `rebased` notice (`copyFor('sim')`'s N3 text);
    - a tampered preset gives a `timing` notice whose details include "Permits at San Diego's pace was re-computed for this data";
    - `remixFrom` adds the toast "Remixed from <from>. You're editing your own copy."
  - `policy-store.svelte.spec.ts`: after two changes, `reset(p)` gives `policy === p` with `canUndo` and `canRedo` false.
  - `SimPage.svelte.spec.ts` (client, fake worker as the existing spec), with `memory-storage`:
    - `a reload keeps the policy and its snapshot`: choose "Permits at San Diego's pace", Save, edit, flush; a remount with the same storage shows "Custom (from Permits at San Diego's pace)" and "Revert to saved".
    - `a reload shows no timing notice`.
    - `a corrupt record is kept and the page starts on the default`: the raw text is kept under `sfhousing:sim:corrupt:<ISO>`, and the N1 policy notice shows.
    - `quota errors show Autosave off and recover`: `setItem` throws, so the header reads "Autosave off"; the next write succeeds and it reads "Saved".
    - `deferred start keeps the saved policy`: under `start: 'fzp'`, a stored non-default policy is untouched after mount, the `fzp-kept` notice shows, and the first change overwrites the record.
    - `Share link after publish, Publish again after an edit`: with a `fetchFn` returning 201, the button reads "Share link"; after a timing edit it reads "Publish".
    - `Publish is disabled on the default policy` with the hint "Change the policy first."
    - `the first restore does not add an undo entry` (`store.canUndo` false).
- [ ] **Step 2:** Run `npx vitest --run --project server src/lib/sim-page/sim-session.spec.ts` and `npx vitest --run --project client src/lib/sim-page/SimPage.svelte.spec.ts src/lib/sim-page/policy-store.svelte.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. `/sim`'s `+page.svelte` passes `persist={data.start === 'fzp' ? 'deferred' : 'restore'}` and `remix={page.state.sfhSimRemix}`.
- [ ] **Step 4:** Rerun (PASS), then `npx vitest --run --project client src/lib/sim-page src/lib/fzp src/routes/sim` (PASS; the FzpMode and `/fzp` specs are unchanged because `notices` is optional).
- [ ] **Step 5:** Commit: `feat(sim-page): autosave, restore and publish the /sim policy`.

### Task 6: `/s/<id>`: the read-only view and Remix

**Files:**
- Create:
  - `src/lib/sim-page/SimRoute.svelte` (body moved from `src/routes/sim/+page.svelte`, Call 19);
  - `src/lib/sim-page/load.ts` (`loadSimScenario`, moved from `src/routes/sim/+page.ts`);
  - `src/lib/sim-page/PolicySummary.svelte` and `PolicySummary.svelte.spec.ts`;
  - `src/routes/s/[id]/+page.server.ts`, `+page.ts`, `+page.svelte`, `+error.svelte`, `page.server.spec.ts`, `page.view.svelte.spec.ts`, `test/PageHost.svelte`.
- Modify:
  - `src/routes/sim/+page.svelte` and `+page.ts` (use the moved pieces);
  - `src/lib/sim-page/PolicyPanel.svelte` (`view: 'summary'` with a `summary` snippet; title "Policy (read-only)");
  - `SimPage.svelte` (in `mode: 'view'`: no `BrushController`, no tools, no autosave or Publish; the panel is in the `summary` view);
  - `src/lib/shell/layout.ts:3` and its spec (`/s/[id]` is full height).

**Interfaces:**
- Consumes: `loadSharedDoc(SIM_CODEC, …)` (Task 4); `reconcileTiming` (Task 3); `remixToLocal`, `localDoc`, `SharedBanner` (Task 1); `brushSummary`, `timingLabel`, `shownRouteShares`, `routeView`.
- Produces:

```ts
// load.ts
export async function loadSimScenario(version: string, current: string, fetchFn): Promise<FzpPageData & { fellBack: boolean }>;
// /s/[id]/+page.ts → SharedDocData<SimDoc> & FzpPageData & { fellBack: boolean; datasetVersion: string }
//   (datasetVersion = the manifest's: the document's own, or current on fallback)
// PolicySummary props: { policy: SimPolicy; calibration: Calibration | null; lotsOf(key: string): number | null }
// SimRoute props: { data: SimPageData; mode: 'edit' | 'view'; persist; initialPolicy?; remix? }
```

Behaviour:
- **The view starts from the reconciled policy.** SimPage takes `initialPolicy`, reconciles it against `calibration` (Task 3), and shows the `timing` notice if anything changed. Then `levers = compileLevers(policy, () => [])` and `sync.update(policy)`.
- **Remix** calls `remixToLocal(SIM_CODEC.publishable(doc), current, storage, now, SIM_CODEC)` and then `goto('/sim', { state: { sfhSimRemix: stored ? { from } : { from, doc } } })`. `from` is the title or the id. The confirm uses `confirmText`: non-null when the local document is non-default (Call 18).
- **OG and title.**
  - The page title is "<title or 'Shared policy'> · SF Housing Simulator".
  - `og:description` is "A housing policy for San Francisco, run through the simulation lot by lot. Open it to see how many homes it adds against the RHNA target."
  - `og:url` is `/s/<id>`.

- [ ] **Step 1: Failing tests:**
  - `page.server.spec.ts`:
    - a sim row loads with `datasetNotice` set to `'none'`, `'remix'` or `'gone'` as `/p` does;
    - a plan id throws a 308 to `/p/<id>`;
    - a bad id gives 404;
    - an unparsable body gives 500 with the policy's unparsable copy.
  - `PolicySummary.svelte.spec.ts`:
    - the default policy lists "Current law" and "SF as observed";
    - a policy with a transit brush, rent-control protection and a custom permit-review edit lists the brush summary, "rent-controlled buildings" and "Permit review, discretionary: 6 months (observed 12)" inside the timelines disclosure, which is collapsed by default (`aria-expanded="false"`).
  - `page.view.svelte.spec.ts` (client, fake worker):
    - the banner reads "Shared policy";
    - there is no "Publish", no "Saved" and no "Add a brush";
    - "Policy" opens "Policy (read-only)";
    - `a tampered link opens refit`: a document with a benchmark scale of 0.3 shows the timing notice;
    - `Remix confirms over a non-default local policy`: with a stored custom policy, Remix shows the confirm; Replace writes `sfhousing:sim:v1` and calls `goto('/sim', …)` with `sfhSimRemix.from`.
  - `layout.spec.ts`: `isFullHeightRoute('/s/[id]')` is true.
- [ ] **Step 2:** Run `npx vitest --run --project server src/routes/s src/lib/shell` and `npx vitest --run --project client src/routes/s src/lib/sim-page/PolicySummary.svelte.spec.ts src/routes/sim`. Expected: FAIL.
- [ ] **Step 3:** Implement. `/sim`'s existing specs must stay green after the `SimRoute` move.
- [ ] **Step 4:** Rerun (PASS). Commit: `feat(sim): read-only shared view of a published policy with Remix`.

### Task 7: End to end, accessibility, docs and signoff

**Files:**
- Create: `e2e/sim-share.spec.ts`
- Modify:
  - `e2e/helpers/sharing.ts` (`seedPlanRow(request, { body, datasetVersion?, kind? })`; `SIM_KEY`);
  - `docs/dev/plan-sharing.md` (a "Policies (`/sim`)" section: `kind`, `/api/policies`, `/s/<id>`, the sim limits including the reachable `too_many_ops`, autosave key, reconcile, redirects; the takedown runbook covers both kinds);
  - `docs/dev/sim-page.md` (Call 15 superseded: the recipe autosaves and publishes; the read-only view; `start=fzp` deferral);
  - `docs/dev/sim-timers.md` (Save persists locally and is stripped at publish; reconcile on load);
  - `CLAUDE.md` (the plan-sharing line names policies).

**Interfaces:**
- Consumes: `window.__sfhFzp.levers` (`status`, `sentRev`; sim-page.md "The debug hook") to wait for a revision.

- [ ] **Step 1: Failing e2e** (`e2e/sim-share.spec.ts`, fixture-0):
  - `publish round trip`:
    1. On `/sim`, choose "Permits at San Diego's pace", then Publish with title "SD permits"; the link reads `/s/<id>`.
    2. Open it: the banner reads "SD permits · Shared policy", the summary names the preset, and `levers.status` reaches `current`.
    3. Remix (no confirm on a default local policy): `/sim` shows the toast and the preset's label.
  - `autosave survives a reload`: add a transit brush and Save timelines, reload; the brush card and "Revert to saved" are there, and no timing notice shows.
  - `a seeded tampered policy opens refit`: seed `kind: 'sim'` with a benchmark scale of 0.3 on fixture-0; the timing notice shows, its Details lists the re-computed preset, and the page does not error.
  - `a policy on a gone dataset falls back`: seed with `datasetVersion: 'fixture-0000'`; the N6 policy notice shows, and the page renders on fixture-0.
  - `kind redirects`: `/p/<policy id>` lands on `/s/<policy id>`.
  - `/fzp keeps the saved policy`: store a custom policy, visit `/fzp`; the `fzp-kept` notice shows and storage is unchanged.
  - `storage off`: with `localStorage.setItem` throwing (init script), the header shows "Autosave off" and editing works.
  - `axe on /s/<id>` with `expectNoA11yViolations` at 1280 px (summary open) and 375 px (the sheet open, the banner visible). At 375 px there is no horizontal scroll.
  - `the map controls stay uncovered`: on `/s/<id>` at 768 px, the zoom control's box does not intersect the banner, panel or notices (as `e2e/sim.spec.ts` checks for the panel).
- [ ] **Step 2:** Run `npx playwright test e2e/sim-share.spec.ts` (FAIL). Implement any fixes, then rerun (PASS). Also run `npx playwright test e2e/share-roundtrip.spec.ts e2e/share-states.spec.ts e2e/share-a11y.spec.ts e2e/sim.spec.ts` (PASS, unchanged).
- [ ] **Step 3:** Write the docs listed above.
- [ ] **Step 4:** Run `npm run lint`, `npm run check` and `npm run test:unit` (all PASS). Commit: `test(sim): publish, autosave and shared view end to end; docs for /sim sharing`.
- [ ] **Step 5: Signoff (when the controller asks).** Run `npm run signoff -- --dry-run`, then `npm run signoff`. Expected: every planned step passes and the `chreode/signoff` status is posted. The D1 migration reaches staging and production through the deploy workflows (`.github/workflows/deploy-staging.yml:35`, `deploy-prod.yml:35` run `d1 migrations apply`), as the plan table's did.

---

## Open questions (partner)

The plan runs under each recommendation.

1. **Does Publish include the timeline Save snapshot?** **Recommendation:** no, strip it (Call 6). The spec calls Save "a named local snapshot", the read-only view cannot use it, and two documents that differ only in it then share a link. Autosave keeps it.
2. **`/fzp` and the saved policy.** **Recommendation:** under `start=fzp`, don't restore and don't write until the first change, and say so in a notice with "Open your policy" (Call 13). The alternative, never autosaving under `start=fzp`, loses edits on reload.
3. **A published link whose preset constants were later revised in code.** **Recommendation:** open it refit to today's sourced values, with the notice (Call 7). The alternative, honouring the published numbers, would show values the evidence no longer supports.
4. **Custom durations on a newer dataset (Remix, fallback, autosave across versions).** **Recommendation:** keep the relative change (scale), clamped (Call 9). Keeping months would need the old calibration fetched, or months stored beside the scale (a change to plan 4's `TimingSet`).
5. **One rate limit for plans and policies.** **Recommendation:** shared, 10 per minute per IP together (Call 16). Separate limits would double the publish rate from one IP.
6. **Stale client after a deploy** (an open `/sim` tab showed no score until reload): left for later, per the partner; a build-version check that prompts a reload would fix it.

## Spec gaps and contradictions found

- **Plan 4's "strict for plan 5" against immutable links.** `checkPresetLayer` and `AVAILABLE_PRESETS` (`policy.ts:314`, `:355`, `:399-411`) bake today's constants into the shape check. A revised constant would make every stored link that uses it fail to parse (500). Resolved by keeping strict for publish and adding a lenient mode for loads (Call 8).
- **`too_many_ops` is reachable for policies.** `plan-sharing.md` says it is unreachable over HTTP for plans. For policies, 5,001 one-point strokes come to about 240 KB, under the 262,144-byte cap. Review Focus 5 tests it.
- **The spec allows "a `Plan` schema version (or a sibling document type)"**: this plan chooses the sibling (Call 1).
- **`sim-page.md` Call 15 ("No local persistence")** is superseded by this plan. Task 7 updates the doc.
- **I16's "strokes are version-independent"** holds for the policy's brushes, which are recipes (Call 1 of plan 3), but not for its timing: edits are scales of the calibration's typical months. That is why reconcile runs on every load path (Calls 7 and 9).

## Self-review

- **Spec ruling coverage:**
  - saved locally: Task 5;
  - published as an immutable link: Tasks 2 and 4;
  - server validation with size limits reviewed: Task 2 (limits, Call 4) and Task 4 (status codes);
  - read-only shared view with Remix: Task 6;
  - Save as a local snapshot persisted: Task 5, with Call 6 for publish;
  - publishing captures the whole policy: `SimDoc.policy`.
- **Carried items:**
  - 1 (floors and presets against the calibration on load): Task 3, wired in Tasks 5 and 6;
  - 2 (`timing.saved` persisted): Task 5;
  - 3 (newer dataset): Call 9, Tasks 3 and 6, e2e in Task 7.
- **Types:**
  - `DocCodec` (Task 1) is used by Tasks 2, 4, 5 and 6.
  - `SimDoc` and `SIM_CODEC` (Task 2) are used by 4, 5 and 6.
  - `reconcileTiming` and `TimingChange` (Task 3) are used by 5 and 6.
  - `restoreSimDoc` takes `Autosave.restore`'s `{ plan, notice }` shape (Call 3).
- **Review Focus tests:**
  - 1: Tasks 2, 3 and 5;
  - 2: Tasks 3 and 5;
  - 3: Tasks 2, 4 and 5;
  - 4: Task 5 and e2e;
  - 5: Task 4 and e2e.
- **Proportion:** the code blocks are signatures, the error table and copy only. Bodies are left to the implementer; the reconcile order (Call 7) is spelled out because tests alone do not fix it.
