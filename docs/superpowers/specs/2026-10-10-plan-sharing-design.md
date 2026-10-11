# Spec — `plan-sharing` (M1)

Derived from `docs/superpowers/design/2026-10-10-1749-sf-housing-sim.md` (approved).
Depends on `2026-10-10-platform-design.md` (bindings, D1 pipeline, `PUBLIC_DATASET_VERSION`)
and `2026-10-10-plan-model-design.md` (`parsePlan`, `serializePlan`, bounds). Citations into
planafoot are `path:line` at `b29964a82`. **V** = verified at source; **I** = inferred.

## 1. Scope

> | `plan-sharing` | Autosaves the current plan to `localStorage`. **Publish** POSTs the plan to the worker, which stores an immutable D1 row and returns a short id. `/p/<id>` loads it read-only, with a "remix" action that copies it into a new local plan. Payload size cap and rate limit. No accounts. |

**In:** localStorage autosave/restore of the single working plan; the Publish dialog and its
states; `POST /api/plans`, `GET /api/plans/:id`; the D1 `plan` table + migration; id
generation; server-side validation and caps; rate limiting via `PUBLISH_RL`; the `/p/:id`
read-only page (banner, Remix, version notice, 404); `docs/dev/plan-sharing.md` (incl.
manual takedown runbook).

**Out:** plan structure validation rules and canonical JSON (plan-model); the op log, undo/redo
(brush-tool); rendering the plan (map-view, generator, scoreboard — `/p/:id` composes them
read-only); a list of saved plans; editing or deleting published plans; accounts; analytics.

## 2. Interfaces

Verbatim rows owned or consumed:

| # | interface | owner → consumers | mark |
|---|---|---|---|
| I3 | (type lives in plan-model's module; brush-tool produces it) `type PlanOp = BrushStroke` where `type BrushStroke = { kind: 'paint'; stories: number /* integer 1..80 */; radiusM: number /* 5..500 */; path: [lng: number, lat: number][]; id: string } \| { kind: 'erase'; radiusM: number; path: [lng: number, lat: number][]; id: string }`. The union widens in later milestones (`AreaOp`, `PolicyOp`) | brush-tool → plan-model | DC |
| I4 | `interface Plan { schema: 1; datasetVersion: string; ops: PlanOp[]; title?: string }` | plan-model → brush-tool, plan-sharing | DC |
| I12 | Data manifest: `/data/<datasetVersion>/manifest.json` → `{ datasetVersion, builtAt, sources: { id, label?, url, retrievedAt, license }[], chunks: { cellId, bbox, url, parcelCount }[], buildingsTiles: url, basemapTiles: url, glyphs: url /* MapLibre `{fontstack}/{range}.pbf` template */, sprite?: url, neighborhoods: url }`. All `url`s are root-relative (`/data/<v>/…`). Every eligible-or-not parcel appears in **exactly one** chunk. `buildingsTiles` has one source-layer `buildings` with properties `parcelId`, `heightM`, `baseM`, at minzoom ≤ 12, with buildings clipped to parcels. Published versions are immutable and retained indefinitely. `datasetVersion` matches `^(\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\|fixture-\d+)$` (build date + 8-hex input hash) everywhere it is validated. R2 key = `data/<datasetVersion>/<path>`, served at `/data/<datasetVersion>/<path>` | data-pipeline → platform, plan-model, brush-tool (worker host), typology-generator, map-view | DC |
| I13 | Share API: `POST /api/plans` (body: `Plan`, ≤ 256 KB) → `{ id }`; `GET /api/plans/:id` → `Plan`; page `/p/:id`. Ids are 8-char base58. Status codes and error bodies are as defined in the plan-sharing spec | plan-sharing ↔ platform | DC |
| I16 | Dataset version discovery: the worker var `PUBLIC_DATASET_VERSION` names the current version for new plans. A **published** plan (`/p/:id`) renders on **its own** `plan.datasetVersion`, with an "Open with current data" action that remixes onto current. A **locally autosaved** plan is rebased to current on load: strokes are version-independent, so `datasetVersion` is rewritten and the plan re-resolved, with a one-line notice if the version changed (`manifestUrl = /data/${v}/manifest.json`). map-view and the worker host take the manifest as a parameter, never a global. If that version's manifest 404s, fall back to current and show the plan-sharing "older data" notice | platform → plan-sharing, brush-tool, map-view | DC |

I16 governs which dataset a loaded plan renders on. A **published** plan (`/p/:id`) renders on its
own `plan.datasetVersion`, falling back to the current version (`PUBLIC_DATASET_VERSION`) only if
that manifest 404s (notice N6); its "Open with current data" action remixes onto current. A
**locally autosaved** plan is rebased to current on load (notice N3 if the version changed). The
manifest load itself is brush-tool's `loadManifest`, whose `fellBack` flag drives N6.

Consumed from plan-model (its internal API, not an I-row): `parsePlan(text): Result<Plan>`,
`serializePlan(plan): string`, `planByteSize`, `rebasePlan`, `emptyPlan`, `MAX_PLAN_BYTES = 262_144`,
`OPS_MAX = 5000`, `PlanErrorCode`.

### Internal types

```ts
// src/lib/sharing/ids.ts
export const PLAN_ID_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'; // Bitcoin base58
export const PLAN_ID_RE = /^[1-9A-HJ-NP-Za-km-z]{8}$/;
export function newPlanId(rand?: (n: number) => Uint8Array): string;

// API error body (all non-2xx JSON responses from /api/plans*)
type ShareErrorCode = 'invalid_json' | 'invalid_plan' | 'unsupported_schema' | 'too_large'
  | 'too_many_ops' | 'empty_plan' | 'unknown_dataset_version' | 'unsupported_media_type'
  | 'rate_limited' | 'not_found' | 'server_error';
interface ShareError { error: { code: ShareErrorCode; message: string; details?: PlanError[] } }

// localStorage record, key 'sfhousing:plan:v1'
interface LocalPlanRecord {
  v: 1;
  savedAt: string;                                // ISO-8601
  plan: string;                                   // serializePlan() output
  lastPublished?: { id: string; hash: string };   // hash = sha256 hex of `plan` at publish time
}
```

## 3. Global constraints (verbatim)

- **Free and open source.** No paid APIs and no vendor keys are needed to run
  or build it. Licence: MIT for code (OD-3). Data attribution is shown in-app
  (ODbL for the OSM/Protomaps basemap and Overture, PDDL/public domain for
  DataSF).
- **Determinism.** The same `Plan` + `datasetVersion` gives the same buildings
  and the same score, on every machine.
- **Overshoot is meaningful.** No readout caps at 100% of a target.
- **Honesty of numbers.** Every unit count is labelled with what it is (M1:
  *theoretical max buildout*). Net counts are shown, not gross. Sources and
  vintages are visible.
- **Performance targets.** Existing-city view pans at 60 fps on a 2022-era
  laptop. Generated buildings appear within 150 ms of pointer-up for strokes
  covering ≤ 500 parcels. A whole-city repaint (≈150k parcels) finishes within
  5 s, off the main thread. The first meaningful paint transfers ≤ 5 MB (parcel
  chunks load lazily under the brush).
- **Mobile works.** Touch painting uses an explicit mode switch. Layout works
  at 375 px.
- **Data is static and versioned.** The worker does no geo computation at
  runtime.
- **Cross-project conventions apply:** Conventional Commits, worktrees for all
  work, bare-name Cloudflare resources (`sfhousing`), and the migration
  workflow via Drizzle.

## 4. Behaviour

### 4.1 D1 schema (Drizzle)

`src/lib/server/db/schema/plan.ts`, re-exported from `schema/index.ts`:

```ts
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const plan = sqliteTable('plan', {
  id: text('id').primaryKey(),                         // 8-char base58
  schema: integer('schema').notNull(),                 // Plan.schema
  datasetVersion: text('dataset_version').notNull(),
  body: text('body').notNull(),                        // serializePlan() output, canonical
  contentHash: text('content_hash').notNull().unique(),// sha256 hex of body
  opCount: integer('op_count').notNull(),
  byteSize: integer('byte_size').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
}, (t) => [index('plan_created_at_idx').on(t.createdAt)]);
```

No IP, user agent, or any personal data is stored. Rows are never updated. No foreign keys.
Migration produced by `npm run db:generate` (platform §4.5); never hand-written.

### 4.2 Id generation

`newPlanId()`: draw bytes from `crypto.getRandomValues`; accept a byte only if `< 232`
(= 4 × 58) and map `byte % 58` into `PLAN_ID_ALPHABET`, until 8 characters (rejection
sampling, uniform). Space 58⁸ ≈ 1.28 × 10¹⁴. Insert uses the primary key; on a PK collision
generate a new id and retry, at most 3 attempts total, then 500 `server_error`. Ids are not
secrets — published plans are public by design. planafoot's `newId()` (UUIDv7→base58, ~22
chars, `src/lib/server/ids/base58.ts:15–17`, V) is not reused: I13 fixes 8 chars.

### 4.3 `POST /api/plans`

`src/routes/api/plans/+server.ts`. Steps, in order; the first failure returns:

| # | check | response |
|---|---|---|
| 1 | `Content-Type` is `application/json` (params ignored) | 415 `unsupported_media_type` |
| 2 | Rate limit: `enforceRate(env.PUBLISH_RL, 'publish:' + (cf-connecting-ip ?? 'unknown'))` — 10 per 60 s per IP (platform §4.2) | 429 `rate_limited`, `Retry-After: 60` |
| 3 | `Content-Length` present and > 262,144 | 413 `too_large` |
| 4 | Read body as a stream, aborting once > 262,144 bytes read (do not trust the header) | 413 `too_large` |
| 5 | `parsePlan(text)`: `not-json` → 400 `invalid_json`; `future-schema`/`unknown-schema` → 422 `unsupported_schema`; `too-many-ops` → 422 `too_many_ops`; `too-large` → 413 `too_large`; any other code → 422 `invalid_plan` with `details` = plan-model errors (first 20) | as listed |
| 6 | `plan.ops.length === 0` | 422 `empty_plan` |
| 7 | `BUCKET.head('data/' + plan.datasetVersion + '/manifest.json')` is null | 422 `unknown_dataset_version` |
| 8 | `body = serializePlan(plan)`; `hash = sha256hex(body)`; if a row with `content_hash = hash` exists → 200 `{ id: existing.id }` | 200 |
| 9 | Insert row (`opCount`, `byteSize = UTF-8 length of body`, `createdAt = now`) | 201 `{ id }`, `Location: /p/<id>` |

Notes:
- Order puts the rate limit before body reading so a flood costs no parse work. A 413/4xx
  still counts against the limit (cheap abuse costs quota too).
- Size is measured on the **received bytes** (I13 "≤ 256 KB" = 262,144 bytes) and again by
  plan-model on the canonical form (`too-large`); canonicalisation never grows a plan
  meaningfully, but both are checked.
- Dedupe (step 8) makes Publish idempotent: the same plan always yields the same link, and
  repeated publishes do not grow D1. Title is part of the body, so a retitled plan is new.
- `enforceRate` is copied from planafoot `src/lib/server/security/rate-limit.ts:43–74` (V),
  trimmed: no analytics/breach logging; test-env bypass when `ENVIRONMENT === 'development'`;
  `critical: true` — a missing binding in production denies (fail closed, `:50–59`).
- Responses: `Content-Type: application/json`, `Cache-Control: no-store`. No CORS headers
  (same-origin only; a cross-origin JSON POST needs a preflight we never grant — I).
- `message` strings are the user-facing copy in §4.6 so the client can show them directly.

### 4.4 `GET /api/plans/:id`

`src/routes/api/plans/[id]/+server.ts`. `id` fails `PLAN_ID_RE` → 404 `not_found` (no D1
query). Row missing → 404 `not_found`, `Cache-Control: no-store`. Found → 200, body = stored
`body` verbatim (already canonical `Plan` JSON), `Content-Type: application/json`,
`Cache-Control: public, max-age=3600`, `ETag: "<contentHash>"`; `If-None-Match` match → 304.
Not `immutable`, so a manual takedown (§4.9) expires from caches within an hour.

### 4.5 Local autosave

Module `src/lib/sharing/autosave.svelte.ts` (client only), key `sfhousing:plan:v1`,
value `JSON.stringify(LocalPlanRecord)`. One working plan per browser profile in M1.

- **Write:** whenever the brush-tool's committed plan changes (op committed, undo, redo,
  title edit, remix, "new plan"), debounce 500 ms then write. Also flush synchronously on
  `visibilitychange → hidden` and `pagehide`. Live drag preview is never saved (only committed ops).
- **Read on app start (`/`):** missing → `emptyPlan(currentDatasetVersion)`. Present →
  `parsePlan(record.plan)`. On failure (`ok: false`, JSON error, or `v !== 1`): copy the raw
  string to `sfhousing:plan:corrupt:<ISO timestamp>`, start empty, and show notice N1.
  `future-schema` (a plan from a newer app build) is treated the same way with notice N2.
- **datasetVersion differs from current:** per I16 the autosaved plan is **rebased** on load:
  `rebasePlan(plan, currentDatasetVersion)` (strokes are geographic; plan-model §4.9), written
  back to localStorage immediately, then handed to the editor and resolved against the current
  manifest. Notice N3 is shown once, as a one-line dismissible notice above the map. Same
  version → no notice.
- **Storage unavailable** (`localStorage` throws on access, `QuotaExceededError` on write):
  editing continues; a persistent status chip "Autosave off" with tooltip/popover N4. Retry
  write on each later change; chip clears on the first successful write.
- **Multiple tabs:** last write wins. No cross-tab sync in M1.
- **Redo stack is not persisted** — after reload, redo is empty; undo history is the op log
  itself as brush-tool defines it.
- A "Saved" indicator in platform's header `headerActions` slot (decided in fidelity pass) shows "Saved" (≤ 1 s after a write), "Saving…" during
  debounce, or "Autosave off". It is an `aria-live="polite"` status that announces only the
  transition to "Autosave off" and back (not every save).

### 4.6 Publish flow (client)

Button **Publish** in platform's header `headerActions` slot on `/`, beside the Saved indicator
(target ≥ 44×44 px on `pointer: coarse`, ≥ 24×24 px otherwise, matching brush-tool's touch
targets (decided in fidelity pass)). States:

| state | when | UI |
|---|---|---|
| disabled | plan has 0 ops | button disabled, `aria-describedby` hint "Paint something first." |
| already published | `sha256(serializePlan(plan)) === lastPublished.hash` | button reads "Share link"; opens the success dialog directly, no POST |
| ready | otherwise | opens the Publish dialog |

**Publish dialog** (modal, focus-trapped, Escape closes): heading "Publish this plan";
optional *Title* text field (max 120 chars, prefilled from `plan.title`); text "Published
plans are public and permanent. Anyone with the link can view and remix it. You can keep
editing your own copy afterward." Shows size "Size: 41 KB of 256 KB". Buttons **Publish**,
**Cancel**.

- **Client preflight:** if `planByteSize(plan with title) > 262,144` the Publish button is
  disabled and the oversize message is shown inline (no request).
- **Publishing:** button shows "Publishing…", `aria-busy`, fields disabled; 15 s client
  timeout (`AbortController`) → network-error state.
- **Success (200/201):** store `lastPublished = { id, hash }` and the title into the local
  plan (a title change is a committed plan change, autosaved). Dialog switches to: heading
  "Published", read-only URL field `https://<host>/p/<id>` (selected on focus), **Copy link**
  (→ "Copied" for 2 s, live region), **Open** (new tab), **Done**. If `navigator.share`
  exists, a **Share…** button too.
- **Error states** (dialog stays open, message in a `role="alert"` region, Publish re-enabled
  unless noted):
  - 413 `too_large`: "This plan is too large to share (X KB of the 256 KB limit). Try fewer
    or shorter strokes." (Publish stays disabled until the plan changes.)
  - 422 `too_many_ops`: "This plan has more than 5,000 strokes, the most a shared plan can hold."
  - 422 `unknown_dataset_version`: "This plan uses map data the server doesn't recognise.
    Reload the page and try again." (This happens only if a version was never uploaded.)
  - 422 `invalid_plan` / `unsupported_schema` / 400 / 415: "The server couldn't read this
    plan (code: `<code>`). Please report this." with a link to the GitHub issues page
    (`${REPO_URL}/issues`, platform §4.6).
  - 429 `rate_limited`: "Too many plans published from your network. Try again in a minute."
    Publish disabled with a visible countdown from `Retry-After` (default 60 s).
  - network error, timeout, 5xx: "Couldn't publish. Check your connection and try again."

### 4.7 `/p/:id` read-only view

`src/routes/p/[id]/+page.server.ts` loads the row directly via `getDb` (no HTTP self-call),
parses `body` with `parsePlan`, and returns `{ plan, id, createdAt, currentDatasetVersion }`.
Page headers: `Cache-Control: public, max-age=300`.

- **Not found** (bad id format or missing row): HTTP 404, page heading "Plan not found",
  text "This link doesn't match a published plan. It may have been mistyped or removed.",
  link **Start your own plan** → `/`. `<meta name="robots" content="noindex">`.
- **Stored plan fails to parse** (only possible after a breaking app change): HTTP 500 page
  "This plan can't be shown by this version of the app." with link home.
- **Found:** the full map renders with the plan applied and the scoreboard visible; the brush
  tool, undo/redo, Publish and autosave are absent, and the local autosaved plan is neither
  read into the view nor modified. A banner above the map (sticky, wraps at 375 px):
  "**<title or 'Untitled plan'>** · Shared plan · published <Mon D, YYYY>" with buttons
  **Remix** (primary) and **Start your own** (link to `/`).
- **Dataset version (I16):** the view renders against `plan.datasetVersion` when
  `/data/<plan.datasetVersion>/manifest.json` exists (datasets are immutable and never
  deleted), so viewers see what the author saw (Determinism constraint). If it 404s, it
  renders against the current version. The server load decides the banner line with
  `BUCKET.head`; the client's `loadManifest` reaches the same answer and passes the manifest
  to map-view and the worker host. When `plan.datasetVersion !== current`, the
  banner adds a second line N5 or N6 respectively. Both lines end with an **Open with current
  data** button (I16), which runs the Remix flow below (decided in fidelity pass).
- **Remix:** if the local plan has ≥ 1 op, a confirm dialog: "Replace your current plan
  (<n> strokes) with a copy of this one? Your current plan will be lost unless you publish it
  first." [**Replace**] [**Cancel**]. On confirm (or immediately if the local plan is empty):
  write `rebasePlan(plan, currentDatasetVersion)` with `title` kept and `lastPublished`
  cleared to localStorage synchronously, then navigate to `/`. The editor shows a one-time
  toast "Remixed from <title or id>. You're editing your own copy." If localStorage is
  unavailable, Remix passes the plan via `history.state` so the editor still opens it, with
  the "Autosave off" chip.
- **Meta:** `<title>` "<title or 'Shared plan'> · SF Housing Simulator"; `og:title` same;
  `og:description` "A plan for San Francisco housing with <n> brush strokes. Open it to see
  the buildings and net new units." (The worker computes no units — no geo at runtime.)
  `og:url` canonical `https://sfhousing.mindlace.net/p/<id>`.

### 4.8 Notice copy

- N1 "Your saved plan couldn't be read, so we started a new one. The old data was kept in
  this browser in case it can be recovered."
- N2 "Your saved plan was made by a newer version of this app. We started a new one; the old
  plan was kept in this browser."
- N3 "Your plan was made with an older map dataset (<old>). It's now shown on the current data
  (<new>), so some numbers may differ."
- N4 "Your browser isn't letting this site save. Changes will be lost when you close the tab.
  Publish to keep a copy."
- N5 "Made with map data <plan.datasetVersion>. Remixing moves it to the current data
  (<current>); numbers may change."
- N6 "Made with map data <plan.datasetVersion>, which is no longer available. Shown on the
  current data (<current>); numbers may differ from when it was published."

### 4.9 Operations

`docs/dev/plan-sharing.md` documents: the API contract above; the rate limit; and a manual
takedown — `wrangler d1 execute sfhousing --remote --command "DELETE FROM plan WHERE id = '<id>'"`,
after which the link 404s and caches expire within 1 h (API) / 5 min (page). Takedown is the
only deletion; there is no user-facing delete in M1.

## 5. Seams

- **M2 `area-select` / M3 `policy-levers`:** new `PlanOp` variants arrive with a plan-model
  schema bump. The server validates only through `parsePlan`, so it accepts whatever the
  deployed plan-model accepts; the `schema` column records it. Nothing more now.
- **M3 `scenario-loader`:** a plan may later name a baseline. It would be a `Plan` field
  (plan-model), stored inside `body`. No column now.
- **`accounts`:** owned/editable plans add a nullable `owner_id` column and an update route
  later (adding a nullable column is a safe migration). Nothing now; immutability stays the
  rule for anonymous rows.
- **M2 `consequences`, M4, M5:** no seam in sharing.

## 6. Testing

**server project (Vitest node):**
- `src/lib/sharing/ids.spec.ts` — 10k ids all match `PLAN_ID_RE`; injected RNG with bytes
  `≥ 232` are skipped (rejection path); chi-square-style check that each alphabet char
  appears within ±20% of expectation over 58k draws using a seeded RNG.
- `src/routes/api/plans/server.spec.ts` using an in-memory SQLite D1 shim (better-sqlite3
  via `drizzle-orm/better-sqlite3` with the generated migration applied — fixture
  `src/lib/server/test/d1.ts`), `FakeR2Bucket` (platform) seeded with
  `data/fixture-0/manifest.json`, and a `FakeRateLimiter({ allow: n })`:
  - 201 + `{ id }` for `fixtures/plans/small.json`; row columns correct; body equals `serializePlan`.
  - same body again → 200 and the same id; non-canonical but equivalent body (extra field,
    whitespace) → same id.
  - 415 wrong content type; 413 by `Content-Length`; 413 by streamed body without a
    `Content-Length` (`fixtures/plans/oversize.json`, 262,145 bytes); 400 `not json`;
    422 `unsupported_schema` (`schema: 2`); 422 `too_many_ops` (`fixtures/plans/ops-5001.json`);
    422 `empty_plan`; 422 `invalid_plan` with `details`; 422 `unknown_dataset_version`.
  - 429 with `Retry-After: 60` when limiter denies, and the body is never read (spy).
  - PK collision: injected id generator returns an existing id twice then a fresh one → 201;
    returns existing id 3 times → 500.
  - production env with `PUBLISH_RL` undefined → 429 (fail closed); development env → allowed.
- `src/routes/api/plans/[id]/server.spec.ts` — 200 verbatim body + ETag + cache header;
  304 on `If-None-Match`; 404 for malformed id (no DB call, spy) and for missing id.
- `src/routes/p/[id]/page.server.spec.ts` — found / not found (404) / unparsable (500);
  `datasetVersion` selection: plan version present in R2 → plan's; absent → current.

**client project (Vitest browser):**
- `autosave.svelte.spec.ts` — debounce (fake timers): 3 commits within 500 ms → 1 write;
  flush on `visibilitychange`; corrupt record → preserved under `corrupt:` key + N1; `v: 2`
  record treated as corrupt; `setItem` throwing `QuotaExceededError` → "Autosave off" chip,
  clears after a later successful write; older `datasetVersion` → rebased to current, written
  back, N3 once; same version → no notice.
- `PublishDialog.svelte.spec.ts` — each row of §4.6 with a mocked `fetch`: disabled-when-empty,
  preflight oversize (no fetch call), publishing busy state, success → URL + Copy, already-
  published → no fetch, 413/422/429 (countdown from `Retry-After`)/network messages exactly as specified.
- `SharedBanner.svelte.spec.ts` — N5/N6 lines, each with "Open with current data" running Remix;
  Remix confirm shown only when local plan non-empty.

**e2e (Playwright, chromium + 375 px project, against `npm run preview` with fixture data,
platform §6):**
- `share-roundtrip.spec.ts` — paint one stroke (brush-tool helper), Publish with title, read
  URL, open it in a new context (empty localStorage): banner title matches, scoreboard net
  units equal the author's. Remix → `/` shows the plan and the toast. Proves the
  brush → POST → D1 → `/p/:id` → map seam.
- `share-states.spec.ts` — `/p/zzzzzzzz` → 404 page; `page.route('/api/plans', 429 + Retry-After: 5)`
  → rate-limited message and re-enable after 5 s; reload restores the autosaved plan.
- `share-a11y.spec.ts` — `expectNoA11yViolations` on `/p/<id>`, the 404 page, the open
  Publish dialog (success and error states), at both viewports.

**Fixtures** (`src/lib/sharing/fixtures/plans/`): `small.json` (3 strokes on `fixture-0`),
`ops-5001.json` (generated by a fixture script, committed), `oversize.json`, `schema2.json`,
`old-version.json` (`datasetVersion: "fixture-0000"`, absent from R2).

## 7. Acceptance criteria

1. `POST /api/plans` with a valid non-empty plan returns 201 `{ id }` where `id` matches
   `^[1-9A-HJ-NP-Za-km-z]{8}$`; `GET /api/plans/<id>` returns a body byte-identical to
   `serializePlan` of the posted plan.
2. Posting an equivalent plan twice returns the same id and leaves one row.
3. Bodies over 262,144 bytes get 413 whether or not `Content-Length` is sent; > 5,000 ops get
   422 `too_many_ops`; a denied rate limit gets 429 with `Retry-After` before the body is read.
4. The `plan` table stores no IP or client identifier.
5. After any committed edit and a 500 ms pause, reloading `/` restores the same plan; a
   corrupt record never crashes the app and is preserved.
6. `/p/<id>` renders read-only (no brush, no autosave write — asserted by localStorage being
   unchanged), with banner, Remix, and the correct dataset notice; an unknown id returns HTTP 404.
7. Remix replaces the local plan only after confirmation when the local plan is non-empty,
   and the remixed plan's `datasetVersion` is the current one.
8. Every error state in §4.6 shows its specified copy; axe gate passes on the dialog, `/p/:id`, and 404.

## 8. Interface concerns (for the orchestrator)

1. ~~**I13 has no status codes or error body.**~~ *Resolved:* I13 now defers status codes and
   error bodies to this spec (§4.3–4.4).
2. ~~**Rendering a shared plan at its own `datasetVersion`.**~~ *Resolved by I16:* map-view
   and the worker host take the manifest as a parameter; a published plan uses its own version with a 404 fallback to current; an autosaved plan is
   rebased to current on load.
3. **Capacity of 256 KB.** At ≈ 24 bytes per quantised point, the cap holds ≈ 10,000 path
   points; plan-model allows 5,000 ops × 2,000 points. Real plans hit the byte cap long before
   the op cap. brush-tool must simplify stroke paths; plan-model already flags a compact wire
   encoding as its open question 1. *Resolved:* brush-tool §4.4 fixes the spacing (`clamp(radiusM/2, 2, 50)` m radial filter) and refuses a commit past the cap (§4.5).
4. ~~**`datasetVersion` pattern mismatch.**~~ *Resolved:* I12 fixes one pattern,
   `DATASET_VERSION_RE` in `src/lib/data/manifest.ts`, which plan-model, platform and the
   pipeline all import.
5. **No remix lineage.** I4 `Plan` has no `remixOf`; lineage is not recorded. Fine for M1.

## 9. Open questions

1. *Rate limit value* — 10 publishes/min/IP. Recommend keep; shared NATs (schools,
   offices) rarely publish 10 plans a minute.
2. *Should Publish also offer "Download plan (.json)"?* Recommend not in M1. The share link
   already serves `GET /api/plans/:id` as JSON.
3. *Retention of stored plans* — recommend indefinite; at ≤ 256 KB per row and dedupe, D1's
   storage limits are far off at expected volumes (I).
