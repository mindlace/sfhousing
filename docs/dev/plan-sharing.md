# Plan sharing

Publish a plan to a permanent public link (`/p/<id>`), view it read-only, remix it into your own copy, and keep a working plan in `localStorage`. Spec: `docs/superpowers/specs/2026-10-10-plan-sharing-design.md`. `/sim` policies are shared the same way (`/s/<id>`, `/api/policies`): see "Policies (`/sim`)" below.

Everything below is generic over a `DocCodec<D>` (`src/lib/sharing/doc-codec.ts`): parse (strict, for publish), load (lenient, for stored bodies), serialize, `publishable`, `isEmpty`, `opCount`, the API and page paths and the autosave keys. `PLAN_CODEC` is the editor plan; `SIM_CODEC` (`src/lib/sim-page/sim-doc.ts`) is the `/sim` policy.

Code map:

| Where                                                                | What                                                                                                     |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/lib/server/db/schema/plan.ts`                                   | D1 `plan` table                                                                                          |
| `src/lib/server/sharing/`                                            | publish, get, rate limit, body reader, `/p/:id` and `/s/:id` load (`shared-page.ts`), JSON error helpers |
| `src/lib/server/sharing/codecs.ts`                                   | `CODECS`: the kind → codec map the server uses to tell a row's document from the one a route expects     |
| `src/routes/api/plans/+server.ts`, `src/routes/api/plans/[id]`       | thin route wrappers (`PLAN_CODEC`)                                                                       |
| `src/routes/api/policies/+server.ts`, `src/routes/api/policies/[id]` | thin route wrappers (`SIM_CODEC`)                                                                        |
| `src/routes/p/[id]/`                                                 | read-only plan view, banner, Remix, not-found / unparsable error page                                    |
| `src/routes/s/[id]/`                                                 | read-only policy view (`SimRoute` in view mode), banner, Remix, error page                               |
| `src/lib/sharing/`                                                   | client: autosave, publish client and dialog, Saved indicator, notices, ids, copy (all text, per kind)    |

## Data

One row per published plan. No IP, user agent or other personal data is stored. Rows are never updated.

| column            | type               | notes                                                                                                                                        |
| ----------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | text PK            | 8-char base58 id                                                                                                                             |
| `kind`            | text, default plan | `'plan'` or `'sim'` (`DocKind`); `/api/policies` and `/s/<id>` serve `'sim'` rows, a kind mismatch is a 404 on the API and a 308 on the page |
| `schema`          | integer            | `Plan.schema`                                                                                                                                |
| `dataset_version` | text               |                                                                                                                                              |
| `body`            | text               | `codec.serialize()` output (canonical JSON)                                                                                                  |
| `content_hash`    | text, unique       | SHA-256 hex of `body`; dedupe key                                                                                                            |
| `op_count`        | integer            |                                                                                                                                              |
| `byte_size`       | integer            | UTF-8 length of `body`                                                                                                                       |
| `created_at`      | integer (ms epoch) | indexed (`plan_created_at_idx`)                                                                                                              |

### Ids

`newPlanId()` (`src/lib/sharing/ids.ts`): 8 characters from the base58 alphabet `123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz`, by rejection sampling (bytes `< 232` only, `byte % 58`), so uniform. `PLAN_ID_RE = /^[1-9A-HJ-NP-Za-km-z]{8}$/`. Space 58⁸ ≈ 1.28 × 10¹⁴. A primary-key collision retries with a new id, 3 attempts in total, then 500 `server_error`. Ids are not secrets: published plans are public.

## API

All JSON responses have `Content-Type: application/json` and, unless noted, `Cache-Control: no-store`. No CORS headers are sent; the API is same-origin only. `/api/policies` behaves as `/api/plans` below with `SIM_CODEC`; the differences are under "Policies (`/sim`)".

### Error body

```json
{
  "error": { "code": "too_large", "message": "This plan is too large to share (…)", "details": [] }
}
```

`code` is one of `invalid_json`, `invalid_plan`, `unsupported_schema`, `too_large`, `too_many_ops`, `empty_plan`, `unknown_dataset_version`, `unsupported_media_type`, `rate_limited`, `not_found`, `server_error`. `message` is the user-facing copy, but the client renders its own copy keyed by `code` (a 5xx from the platform may not be JSON). `details` (plan-model errors, first 20) appears only on `invalid_plan`. The server copy is kind-aware: `serverMessage(code, bytes, kind)` (`src/lib/sharing/copy.ts`) gives a policy's errors the plan wording with "plan" swapped for "policy", and its own size advice, so a policy error never says "plan".

### `POST /api/plans`

Checks run in order; the first failure returns.

| #   | check                                                                                                                                                                                                                                  | response                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 1   | `Content-Type` is `application/json` (parameters such as `charset` ignored)                                                                                                                                                            | 415 `unsupported_media_type`                |
| 2   | Rate limit, key `publish:<cf-connecting-ip or 'unknown'>` (see below)                                                                                                                                                                  | 429 `rate_limited`, `Retry-After: 60`       |
| 3   | `Content-Length` present and > 262,144                                                                                                                                                                                                 | 413 `too_large`                             |
| 4   | Body read as a stream, aborted once > 262,144 bytes (the header is not trusted)                                                                                                                                                        | 413 `too_large`                             |
| 5   | `parsePlan(text)`: `not-json` → 400 `invalid_json`; `future-schema`/`unknown-schema` → 422 `unsupported_schema`; `too-many-ops` → 422 `too_many_ops`; `too-large` → 413 `too_large`; anything else → 422 `invalid_plan` with `details` | as listed                                   |
| 6   | `plan.ops.length === 0`                                                                                                                                                                                                                | 422 `empty_plan`                            |
| 7   | `BUCKET.head('data/<plan.datasetVersion>/manifest.json')` is null                                                                                                                                                                      | 422 `unknown_dataset_version`               |
| 8   | `body = serializePlan(plan)`, `hash = sha256hex(body)`; a row with that `content_hash` exists                                                                                                                                          | 200 `{ "id": "<existing id>" }`             |
| 9   | Insert (`ON CONFLICT DO NOTHING`)                                                                                                                                                                                                      | 201 `{ "id": "<id>" }`, `Location: /p/<id>` |

- The rate limit runs before the body is read, so a flood costs no parse work. A 4xx still counts against the limit.
- Dedupe makes Publish idempotent: the same plan always gives the same link and D1 does not grow. The title is part of the body, so a retitled plan is a new row. Two identical publishes racing: the loser's insert changes nothing, it finds the winner's row by `content_hash` and returns 200 with that id.
- Size is checked on the received bytes and again by plan-model on the canonical form. `MAX_PLAN_BYTES = 262_144`, `OPS_MAX = 5000` and `TITLE_MAX_CHARS = 120` live in `$lib/plan`.
- **`too_many_ops` is unreachable over HTTP for plans.** 5,001 minimal ops serialize to about 290 KB, which is over the 262,144-byte cap, so step 3/4/5 returns 413 `too_large` first. The `too-many-ops → 422 too_many_ops` mapping is unit-tested on the mapping function. The client handles the code but no plan UI relies on reaching it. **For policies it is reachable:** 5,001 one-point strokes come to about 240 KB, under the cap, so `POST /api/policies` answers 422 `too_many_ops`.

### `GET /api/plans/:id`

| condition               | response                                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| `id` fails `PLAN_ID_RE` | 404 `not_found` (no D1 query)                                                                      |
| row missing             | 404 `not_found`, `no-store`                                                                        |
| found                   | 200, body = stored `body` verbatim, `Cache-Control: public, max-age=3600`, `ETag: "<contentHash>"` |
| `If-None-Match` matches | 304                                                                                                |

Not `immutable`, so a takedown expires from caches within an hour. A row of the other kind is 404 `not_found` on the API (`GET /api/plans/:id` never serves a policy, nor `GET /api/policies/:id` a plan); only the pages redirect.

### Rate limit

10 publishes per 60 s per IP, plans and policies together (one key, `publish:<ip>`), through the Workers rate-limit binding `PUBLISH_RL` (`wrangler.jsonc` `ratelimits`, namespace 4101 production / 4201 staging). `enforceRate` (`src/lib/server/sharing/rate-limit.ts`):

- `ENVIRONMENT === 'development'` (local dev and the e2e preview): always allowed. e2e tests that need a 429 mock it with `page.route`.
- Binding missing in production: **denied** (fail closed), logged with the limiter label only (the key embeds the IP).
- Binding missing in any other environment: allowed.

## Local autosave

`src/lib/sharing/autosave.svelte.ts`. Key `sfhousing:plan:v1`, one working plan per browser profile. Value is `JSON.stringify` of:

```ts
interface LocalPlanRecord {
  v: 1;
  savedAt: string; // ISO 8601
  plan: string; // serializePlan() output
  lastPublished?: { id: string; hash: string }; // drives "Share link"
}
```

- **Write:** every committed plan change (op, undo, redo, title, remix), debounced 500 ms; flushed synchronously on `visibilitychange → hidden` and `pagehide`. Drag previews are never saved. The redo stack is not persisted. Multiple tabs: last write wins.
- **Restore on `/`:** in `onMount` (client only). Missing → empty plan. Unreadable (bad JSON, `v !== 1`, `parsePlan` failure) → the raw string is kept under `sfhousing:plan:corrupt:<ISO>`, start empty, notice N1. A plan from a newer schema → same, notice N2. A different `datasetVersion` → `rebasePlan` to the current version, written back immediately, notice N3.
- **Storage unavailable** (access throws, or `QuotaExceededError`): editing continues; the header shows the **Autosave off** chip (popover N4). Each later change retries; the chip clears on the first successful write.
- **Header indicator:** "Saving…" during the debounce, "Saved" after a write (and until the next change), or "Autosave off". Its live region announces only the off/on transitions.

## Notices

All copy is in `src/lib/sharing/copy.ts`. On `/` a single `role="status"` region (`NoticeStack`) shows N1–N3 and the Remix toast "Remixed from <title or id>. You're editing your own copy." (shown once; the history state is cleared with `replaceState` so a reload does not re-toast).

| id  | where       | when                                                      |
| --- | ----------- | --------------------------------------------------------- |
| N1  | `/`         | autosaved plan unreadable                                 |
| N2  | `/`         | autosaved plan from a newer app build                     |
| N3  | `/`         | autosaved plan rebased to the current dataset             |
| N4  | header chip | storage unavailable                                       |
| N5  | `/p/:id`    | the plan's dataset version exists but is not current      |
| N6  | `/p/:id`    | the plan's dataset version is gone; shown on current data |

N5 and N6 lines end with **Open with current data**, which runs Remix.

## `/p/:id`

The server load (`src/lib/server/sharing/shared-page.ts`) reads the row from D1 directly (no HTTP self-call), parses it, and picks the dataset to render against with `BUCKET.head` on `data/<version>/manifest.json`.

- Found: read-only map + scoreboard, sticky banner "**<title or 'Untitled plan'>** · Shared plan · published <Mon D, YYYY>" (UTC) with **Remix** and **Start your own**. No brush, undo, Publish or autosave; viewing never reads into or writes the local plan.
- **Remix:** if the local plan has ≥ 1 op, a confirm ("Replace your current plan (<n> strokes) …", Replace / Cancel). Then the plan is rebased to the current dataset, written to `localStorage` (title kept, `lastPublished` cleared) and the app goes to `/`. If the write fails, the plan rides along in `history.state`. A corrupt local record is preserved first, as for N1.
- Bad id or missing row: 404 "Plan not found", link **Start your own plan**, `<meta name="robots" content="noindex">`.
- Stored body fails to parse (only after a breaking app change): 500 "This plan can't be shown by this version of the app."

### Caching

`Cache-Control: private, max-age=300` on success only (an error page does not get it). The browser may reuse the page for 5 minutes, so a takedown takes effect within 5 minutes. See the spec deviation below.

## Manual takedown

Takedown is the only deletion; there is no user-facing delete in M1.

```sh
wrangler d1 execute sfhousing --remote --command "DELETE FROM plan WHERE id = '<id>'"
```

The same command takes down a policy: plans and policies share the `plan` table and one id space (`kind` tells them apart). After this the link 404s, and caches expire within 1 h (API, `GET /api/plans/:id` or `GET /api/policies/:id`) / 5 min (page, `/p/:id` or `/s/:id`). For staging use `sfhousing-staging --env staging`.

## Migrations

Schema change: edit `src/lib/server/db/schema/` → `npm run db:generate` → `npm run db:migrate`. Never hand-edit migrations. `db:generate` runs `@planafoot/drizzle-cf-migrations`' `dist/cli.js` directly with `tsx`, because invoking it through the `.bin` symlink makes its entry-point check fail and it silently does nothing.

## Testing

- Unit (server): `src/lib/server/sharing/*.spec.ts`, `src/routes/api/plans/**/server.spec.ts`, `src/routes/p/[id]/page.server.spec.ts` run route code on the real `getDb()` / `drizzle-orm/d1` path over a better-sqlite3 `D1Database` shim (`src/lib/server/test/d1.ts`).
- Unit (client): `src/lib/sharing/*.spec.ts` and `*.svelte.spec.ts`.
- Fixtures: `src/lib/sharing/fixtures/plans/` (`small.json`, `oversize.json` = 262,145 bytes, `schema2.json`, `old-version.json` on the absent `fixture-0000`). They are in `.prettierignore` because byte size matters.
- e2e: `e2e/share-roundtrip.spec.ts`, `e2e/share-states.spec.ts`, `e2e/share-a11y.spec.ts`, and for policies `e2e/sim-share.spec.ts`; helpers in `e2e/helpers/sharing.ts` (`PLAN_KEY`, `SIM_KEY`). States the API refuses to create (N6, an unparsable stored body, a tampered policy) are seeded with `seedPlanRow(request, { body, datasetVersion?, kind? })`, which POSTs to the e2e-only route `POST /api/e2e/plans` (`src/routes/api/e2e/plans/+server.ts`, logic in `src/lib/server/sharing/e2e-seed.ts`). The route inserts the body raw (no strict parse gate) with `kind` defaulting to `'plan'`, `dataset_version` defaulting to `fixture-0000`, `content_hash = sha256Hex('e2e-seed\n' + datasetVersion + '\n' + body)` for a plan (`'e2e-seed\nsim\n' + …` for a policy) and `created_at = 2026-10-01`, and returns 201 `{ id }`. The namespaced hash never equals a publish hash (that is the bare canonical body's), so a seed never collides with a publish and publish never dedupes onto a seeded row (which would hand back an N6 link). Re-seeding the same body and version (the local D1 persists across runs) returns 200 with the existing id; the same body under another version is a separate row.
  - Why a route: the earlier helper shelled out to `wrangler d1 execute DB --local`, a second process writing the SQLite file the running preview holds open, so parallel share specs hit `SQLITE_BUSY`. Seeding through the preview's own D1 binding serialises with every other request.
  - Gate: it 404s unless the build has `VITE_E2E=1` **and** the worker runs with `ENVIRONMENT=development` (the e2e preview passes `--var ENVIRONMENT:development`). The `VITE_E2E` check is first and is replaced at build time, so a normal `npm run build` dead-code-eliminates the seed logic and ships only the 404 branch.

## Policies (`/sim`)

Plan 5 (`docs/superpowers/plans/2026-10-30-sim-publish.md`; "Call n" below is that plan's). The `/sim` policy is a sibling document, not a `Plan` schema: `SimDoc = { schema: 1; kind: 'sim'; datasetVersion; title?; policy: SimPolicy }` (`src/lib/sim-page/sim-doc.ts`). The page side is in [sim-page.md](sim-page.md).

- **Storage:** the same `plan` table with `kind = 'sim'` and one id space. `op_count` is brushes plus protect strokes.
- **API:** `POST /api/policies` runs the `POST /api/plans` steps with `SIM_CODEC`. Step 5 is `parseSimDoc(text, 'strict')` with `simDocProblems` (the limits below). Step 6 refuses the default policy (`isDefaultPolicy`, ignoring the timeline Save snapshot) with 422 `empty_plan`. A 201's `Location` is `/s/<id>`. The server does not check timings against the calibration (Call 10): every load path reconciles. `GET /api/policies/:id` is `GET /api/plans/:id` for `'sim'` rows.
- **Limits** (Call 4, the constants in `$lib/plan`):
  - canonical UTF-8 of at most `MAX_PLAN_BYTES` (262,144);
  - at most `OPS_MAX` (5,000) strokes in total across freehand, erase and protect strokes;
  - 1 to `PATH_MAX_POINTS` points per stroke, each inside `SF_BBOX` after `quantize`;
  - an integer radius from `RADIUS_MIN_M` to `RADIUS_MAX_M`;
  - a title of at most `TITLE_MAX_CHARS`.

  Brushes and name lists are bounded by the byte cap only. `too_many_ops` is reachable (see the POST notes).

- **Canonical form and publish:** sorted keys, coordinates quantized to 1e-6° (Call 5). Publish strips the timeline Save snapshot (`timing.saved = null`, `SIM_CODEC.publishable`; Call 6), so two policies that differ only in it share a link. The seed is not published (Call 17).
- **Strict to publish, lenient to load** (Call 8): `SIM_CODEC.parse` is strict (plan 4's preset-layer check); `SIM_CODEC.load` (`'reconcile'`) accepts any preset id and leaves the preset layer's values to `reconcileTiming`. GET, the shared page, autosave and the Remix hand-off use `load`, so a preset constant revised in code never makes a stored link 500.
- **Reconcile** (`src/lib/sim-page/reconcile.ts`, Call 7) runs on every load path against the calibration the page runs on:
  - an unavailable preset becomes observed;
  - a preset layer that differs from `resolvePreset` is re-resolved;
  - edits on stages with no table are dropped;
  - out-of-bounds edits are clamped (in-bounds scales stay exact);
  - custom route shares are kept.

  When anything moved, one notice "Some permitting timelines were re-fit to the data this simulation runs on." lists the changes behind Details.

- **`/s/<id>`:** the read-only view, on the document's own `datasetVersion`, falling back to current (N6) when that manifest is gone (Call 9). The banner reads "**<title or 'Untitled policy'>** · Shared policy · published <date>", and "Start your own" goes to `/sim`. Remix confirms only when the local policy is non-default, then goes to `/sim`, which shows the toast. Caching and the 404 and 500 pages are as `/p/:id`, in the policy wording.
- **Redirects:** `/p/<id>` whose row is a policy answers 308 to `/s/<id>`, and `/s/<id>` whose row is a plan 308 to `/p/<id>` (`loadSharedDoc`, through `otherCodec`).
- **Autosave:** key `sfhousing:sim:v1`, separate from `/`'s, with the same record shape, debounce and flush. Corrupt records are kept under `sfhousing:sim:corrupt:<ISO>`. Autosave keeps the Save snapshot. An over-limit policy is never written (ruling R4): the header shows "Autosave off" until a valid write succeeds, because an over-limit record would load back as corrupt.
- **Copy:** `copyFor(kind)` (`src/lib/sharing/copy.ts`); the plan's strings are unchanged.

## Spec deviations

- **`/p/:id` page caching is `private, max-age=300`, not the spec's `public, max-age=300`.** adapter-cloudflare edge-caches public HTML, and cached HTML outlives a deploy while referencing hashed assets that then 404. Browser-only caching keeps the 5-minute takedown promise.
- **`too_many_ops` is unreachable over HTTP for plans** (5,001 minimal ops ≈ 290 KB > 262,144 → 413 `too_large` first), but reachable for policies. See the POST notes.
