# Plan sharing

Publish a plan to a permanent public link (`/p/<id>`), view it read-only, remix it into your own copy, and keep a working plan in `localStorage`. Spec: `docs/superpowers/specs/2026-10-10-plan-sharing-design.md`.

Code map:

| Where                                                          | What                                                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/lib/server/db/schema/plan.ts`                             | D1 `plan` table                                                                             |
| `src/lib/server/sharing/`                                      | publish, get, rate limit, body reader, `/p/:id` load (`shared-page.ts`), JSON error helpers |
| `src/routes/api/plans/+server.ts`, `src/routes/api/plans/[id]` | thin route wrappers                                                                         |
| `src/routes/p/[id]/`                                           | read-only view, banner, Remix, not-found / unparsable error page                            |
| `src/lib/sharing/`                                             | client: autosave, publish client and dialog, Saved indicator, notices, ids, copy (all text) |

## Data

One row per published plan. No IP, user agent or other personal data is stored. Rows are never updated.

| column            | type               | notes                                                                                                                                        |
| ----------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | text PK            | 8-char base58 id                                                                                                                             |
| `kind`            | text, default plan | `'plan'` or `'sim'` (`DocKind`); `/api/policies` and `/s/<id>` serve `'sim'` rows, a kind mismatch is a 404 on the API and a 308 on the page |
| `schema`          | integer            | `Plan.schema`                                                                                                                                |
| `dataset_version` | text               |                                                                                                                                              |
| `body`            | text               | `serializePlan()` output (canonical JSON)                                                                                                    |
| `content_hash`    | text, unique       | SHA-256 hex of `body`; dedupe key                                                                                                            |
| `op_count`        | integer            |                                                                                                                                              |
| `byte_size`       | integer            | UTF-8 length of `body`                                                                                                                       |
| `created_at`      | integer (ms epoch) | indexed (`plan_created_at_idx`)                                                                                                              |

### Ids

`newPlanId()` (`src/lib/sharing/ids.ts`): 8 characters from the base58 alphabet `123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz`, by rejection sampling (bytes `< 232` only, `byte % 58`), so uniform. `PLAN_ID_RE = /^[1-9A-HJ-NP-Za-km-z]{8}$/`. Space 58⁸ ≈ 1.28 × 10¹⁴. A primary-key collision retries with a new id, 3 attempts in total, then 500 `server_error`. Ids are not secrets: published plans are public.

## API

All JSON responses have `Content-Type: application/json` and, unless noted, `Cache-Control: no-store`. No CORS headers are sent; the API is same-origin only.

### Error body

```json
{
  "error": { "code": "too_large", "message": "This plan is too large to share (…)", "details": [] }
}
```

`code` is one of `invalid_json`, `invalid_plan`, `unsupported_schema`, `too_large`, `too_many_ops`, `empty_plan`, `unknown_dataset_version`, `unsupported_media_type`, `rate_limited`, `not_found`, `server_error`. `message` is the user-facing copy, but the client renders its own copy keyed by `code` (a 5xx from the platform may not be JSON). `details` (plan-model errors, first 20) appears only on `invalid_plan`.

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
- **`too_many_ops` is unreachable over HTTP.** 5,001 minimal ops serialize to about 290 KB, which is over the 262,144-byte cap, so step 3/4/5 returns 413 `too_large` first. The `too-many-ops → 422 too_many_ops` mapping is unit-tested on the mapping function only. The client handles the code but no UI relies on reaching it.

### `GET /api/plans/:id`

| condition               | response                                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| `id` fails `PLAN_ID_RE` | 404 `not_found` (no D1 query)                                                                      |
| row missing             | 404 `not_found`, `no-store`                                                                        |
| found                   | 200, body = stored `body` verbatim, `Cache-Control: public, max-age=3600`, `ETag: "<contentHash>"` |
| `If-None-Match` matches | 304                                                                                                |

Not `immutable`, so a takedown expires from caches within an hour.

### Rate limit

10 publishes per 60 s per IP through the Workers rate-limit binding `PUBLISH_RL` (`wrangler.jsonc` `ratelimits`, namespace 4101 production / 4201 staging). `enforceRate` (`src/lib/server/sharing/rate-limit.ts`):

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

After this the link 404s, and caches expire within 1 h (API, `GET /api/plans/:id`) / 5 min (page, `/p/:id`). For staging use `sfhousing-staging --env staging`.

## Migrations

Schema change: edit `src/lib/server/db/schema/` → `npm run db:generate` → `npm run db:migrate`. Never hand-edit migrations. `db:generate` runs `@planafoot/drizzle-cf-migrations`' `dist/cli.js` directly with `tsx`, because invoking it through the `.bin` symlink makes its entry-point check fail and it silently does nothing.

## Testing

- Unit (server): `src/lib/server/sharing/*.spec.ts`, `src/routes/api/plans/**/server.spec.ts`, `src/routes/p/[id]/page.server.spec.ts` run route code on the real `getDb()` / `drizzle-orm/d1` path over a better-sqlite3 `D1Database` shim (`src/lib/server/test/d1.ts`).
- Unit (client): `src/lib/sharing/*.spec.ts` and `*.svelte.spec.ts`.
- Fixtures: `src/lib/sharing/fixtures/plans/` (`small.json`, `oversize.json` = 262,145 bytes, `schema2.json`, `old-version.json` on the absent `fixture-0000`). They are in `.prettierignore` because byte size matters.
- e2e: `e2e/share-roundtrip.spec.ts`, `e2e/share-states.spec.ts`, `e2e/share-a11y.spec.ts`, helpers in `e2e/helpers/sharing.ts`. States the API refuses to create (N6, an unparsable stored body) are seeded with `seedPlanRow(request, { body, datasetVersion? })`, which POSTs to the e2e-only route `POST /api/e2e/plans` (`src/routes/api/e2e/plans/+server.ts`, logic in `src/lib/server/sharing/e2e-seed.ts`). The route inserts the body raw (no `parsePlan` gate) with `dataset_version` defaulting to `fixture-0000`, `content_hash = sha256Hex('e2e-seed\n' + datasetVersion + '\n' + body)` and `created_at = 2026-10-01`, and returns 201 `{ id }`. The namespaced hash never equals a publish hash (that is the bare canonical body's), so a seed never collides with a publish and publish never dedupes onto a seeded row (which would hand back an N6 link). Re-seeding the same body and version (the local D1 persists across runs) returns 200 with the existing id; the same body under another version is a separate row.
  - Why a route: the earlier helper shelled out to `wrangler d1 execute DB --local`, a second process writing the SQLite file the running preview holds open, so parallel share specs hit `SQLITE_BUSY`. Seeding through the preview's own D1 binding serialises with every other request.
  - Gate: it 404s unless the build has `VITE_E2E=1` **and** the worker runs with `ENVIRONMENT=development` (the e2e preview passes `--var ENVIRONMENT:development`). The `VITE_E2E` check is first and is replaced at build time, so a normal `npm run build` dead-code-eliminates the seed logic and ships only the 404 branch.

## Spec deviations

- **`/p/:id` page caching is `private, max-age=300`, not the spec's `public, max-age=300`.** adapter-cloudflare edge-caches public HTML, and cached HTML outlives a deploy while referencing hashed assets that then 404. Browser-only caching keeps the 5-minute takedown promise.
- **`too_many_ops` is unreachable over HTTP** (5,001 minimal ops ≈ 290 KB > 262,144 → 413 `too_large` first). See the POST notes.
