# Plan Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Autosave the working plan to `localStorage`, publish it to an immutable D1 row behind
`POST /api/plans` / `GET /api/plans/:id`, and show it read-only at `/p/:id` with Remix.

**Architecture:** Server logic lives in plain modules under `src/lib/server/sharing/` (testable
with an in-memory D1 shim over better-sqlite3 and the existing `FakeR2Bucket`); the SvelteKit
`+server.ts` / `+page.server.ts` files are one-line adapters. Client logic lives in
`src/lib/sharing/` (autosave class with runes, publish client, Svelte components that take
callbacks instead of importing `$app/*`, so the Vitest browser project can render them). The
`/` route wires autosave + Publish into BrushEditor's `oneditor` seam and the header-actions
slot; `/p/[id]` composes BrushEditor read-only + Scoreboard + a banner.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, Tailwind 4, Drizzle 1.0 rc (D1 driver), Cloudflare
Workers (D1, R2, rate-limit binding), Vitest (server + browser client projects), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-10-plan-sharing-design.md` (read it; this plan argues
from it). Also: brush-tool spec §4.5/§4.9/§Consumers (`docs/superpowers/specs/2026-10-10-brush-tool-design.md`).

## Global Constraints

Verbatim from spec §3:

- **Free and open source.** No paid APIs and no vendor keys are needed to run or build it. Licence: MIT for code (OD-3). Data attribution is shown in-app (ODbL for the OSM/Protomaps basemap and Overture, PDDL/public domain for DataSF).
- **Determinism.** The same `Plan` + `datasetVersion` gives the same buildings and the same score, on every machine.
- **Overshoot is meaningful.** No readout caps at 100% of a target.
- **Honesty of numbers.** Every unit count is labelled with what it is (M1: *theoretical max buildout*). Net counts are shown, not gross. Sources and vintages are visible.
- **Performance targets.** Existing-city view pans at 60 fps on a 2022-era laptop. Generated buildings appear within 150 ms of pointer-up for strokes covering ≤ 500 parcels. A whole-city repaint (≈150k parcels) finishes within 5 s, off the main thread. The first meaningful paint transfers ≤ 5 MB (parcel chunks load lazily under the brush).
- **Mobile works.** Touch painting uses an explicit mode switch. Layout works at 375 px.
- **Data is static and versioned.** The worker does no geo computation at runtime.
- **Cross-project conventions apply:** Conventional Commits, worktrees for all work, bare-name Cloudflare resources (`sfhousing`), and the migration workflow via Drizzle.

Project/conductor constraints (apply to every task):

- Code style: 2-space indent, single quotes, no trailing commas, 100 columns. `npm run lint` must pass (prettier + eslint).
- Vitest runs with `expect.requireAssertions`: every test calls `expect`.
- Client (browser) tests have no `$app/*` / `$env/*` aliases: components in `src/lib/sharing/` must not import `$app/*`. Route files may.
- CSP: never add `unsafe-eval`. Do not import zod into client code paths of this subsystem (plan-model's `parsePlan` is zod-free; keep it that way).
- `rebasePlan` / `emptyPlan` THROW `TypeError` on an invalid datasetVersion: guard every call.
- `MAX_PLAN_BYTES = 262_144`, `OPS_MAX = 5000`, `TITLE_MAX_CHARS = 120` come from `$lib/plan`; never re-declare them. OPS_MAX is unreachable over HTTP (≈ 290 KB > cap) — handle both `too-large` and `too-many-ops` but never build UI that relies on reaching `too-many-ops`.
- `PUBLIC_DATASET_VERSION` arrives as `datasetVersion` from root layout data (`requireDatasetVersion`); never add a fallback.
- Schema change: edit `src/lib/server/db/schema/` → `npm run db:generate` → `npm run db:migrate`. Never hand-edit migrations.
- No real network: no remote D1, no deploys. Local D1 only.
- Commits: Conventional Commits; no heredoc messages (use `git commit -m … -m …` or `-F file`); never `cd … && …` compounds; never push.
- e2e: kill a stale `:4173` server before Playwright (`lsof -ti :4173 | xargs kill`); the e2e build sets `VITE_E2E=1`. Don't un-fixme map-view's or scoreboard's W6 fixmes. Anything needing unbuilt work → `test.fixme('W6: <reason>')`.
- Keep the brush e2e debug hook (`exposeEditorForDebug`) and scoreboard wiring in `src/routes/+page.svelte` working and separate.

## Spec-silent rulings (decided here; report them)

1. **D1 test shim** is a `D1Database` subset implemented over better-sqlite3 (`src/lib/server/test/d1.ts`) so route code uses the real `getDb()` / `drizzle-orm/d1` path, rather than swapping in `drizzle-orm/better-sqlite3`.
2. **Server logic in `src/lib/server/sharing/*`**, because SvelteKit forbids non-verb exports from `+server.ts`; injection (id generator, clock) is via function params.
3. **`too_many_ops` over HTTP is unreachable** (5001 minimal ops ≈ 290 KB > 262,144). `ops-5001.json` is therefore generated in-test (not committed) and asserted to give 413 `too_large`; the `too-many-ops → 422 too_many_ops` mapping is unit-tested on the mapping function.
4. **Insert uses `ON CONFLICT DO NOTHING`**; zero changes → if a row with the same `content_hash` now exists (concurrent identical publish) return 200 with that id, else it was a PK collision → retry.
5. **Client renders error copy from its own table keyed by `code`** (server `message` is the same copy but the client never depends on it — a 5xx may not be JSON).
6. **Autosave restore happens in `/`'s `onMount`**, not in `+page.ts` (a universal load runs during SSR without `localStorage`). `+page.ts` keeps loading the current manifest: restored plans are always rebased to current, so it is the same manifest.
7. **Remix hand-off** uses `goto('/', { state: { sfhRemix: { from, plan? } } })`: `from` drives the toast; `plan` (serialized) is included only when the `localStorage` write failed. `/` clears the state with `replaceState` after showing the toast so a reload doesn't re-toast.
8. **Remix over a corrupt local record**: the corrupt record is preserved under `sfhousing:plan:corrupt:<ISO>` (same as N1), its op count is treated as 0 (no confirm).
9. **"Saved" indicator** keeps reading "Saved" until the next change (spec: shows "Saved" ≤ 1 s after a write).
10. **Dates** on the banner are formatted in UTC (`Oct 11, 2026`) so SSR and hydration agree.
11. **Title normalisation** everywhere (dialog, `setTitle`, hash): trim; empty → `undefined`; clip to `TITLE_MAX_CHARS`.
12. **`/p/:id` cache header** is set only on success (an error page is not cached by that header).

## Review Focus

1. **Whitespace-only or padded title** — `"  My plan  "` must publish as `"My plan"` and the post-publish button must read "Share link" (client hash of the normalised plan equals the server's content hash). Pinned in Task 5 (server) and Task 8 (client).
2. **Double-clicking Publish** — only one POST is sent; the second click is ignored while publishing. Pinned in Task 8.
3. **`localStorage` present but full while preserving a corrupt record** — the app still starts on an empty plan with N1 and the Autosave-off chip, never throws. Pinned in Task 7.
4. **`Content-Type: application/json; charset=utf-8`** (params) is accepted, and `text/plain` is 415. Pinned in Task 5.
5. **Two identical publishes racing** (second insert hits the `content_hash` unique constraint) return 200 with the first id, not 500. Pinned in Task 5.

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/brush/editor.svelte.ts` (modify) | add `setTitle` (conductor ruling) |
| `src/lib/sharing/ids.ts` | `PLAN_ID_ALPHABET`, `PLAN_ID_RE`, `newPlanId` |
| `src/lib/sharing/api.ts` | `ShareErrorCode`, `ShareError`, `PLAN_PATH(id)` helpers |
| `src/lib/sharing/copy.ts` | every user-facing string of this subsystem (N1–N6, publish errors, banner, 404) |
| `src/lib/sharing/hash.ts` | `sha256Hex(text)` (WebCrypto; worker, browser, node) |
| `src/lib/sharing/title.ts` | `normalizeTitle`, `applyTitle(editor, title)` — single call site of `editor.setTitle` |
| `src/lib/server/db/schema/plan.ts` + `schema/index.ts` | Drizzle `plan` table |
| `migrations/d1/*` | generated by `npm run db:generate` |
| `src/lib/server/test/d1.ts` | in-memory D1 shim + migrations applied |
| `src/lib/server/test/fake-rate-limiter.ts` | `FakeRateLimiter({ allow })` |
| `src/lib/server/sharing/rate-limit.ts` | `enforceRate` (trimmed planafoot copy) |
| `src/lib/server/sharing/read-body.ts` | `readCapped(request, max)` |
| `src/lib/server/sharing/respond.ts` | `json`, `shareError` response helpers |
| `src/lib/server/sharing/store.ts` | `findPlanById`, `findPlanByHash`, `insertPlan` |
| `src/lib/server/sharing/publish.ts` | `handlePublish(event, deps)`, `errorForParse(errors)` |
| `src/lib/server/sharing/get-plan.ts` | `handleGetPlan(event)` |
| `src/lib/server/sharing/shared-page.ts` | `loadSharedPlan(...)` for `/p/[id]` |
| `src/routes/api/plans/+server.ts`, `src/routes/api/plans/[id]/+server.ts` | adapters |
| `src/lib/sharing/fixtures/plans/*.json` | `small.json` (exists), `oversize.json`, `schema2.json`, `old-version.json` |
| `src/lib/sharing/storage.ts` | `PLAN_KEY`, `LocalPlanRecord`, `getStorage`, `readRecord`, `writeRecord`, `preserveCorrupt` |
| `src/lib/sharing/autosave.svelte.ts` | `Autosave` class |
| `src/lib/sharing/remix.ts` | `localOpCount`, `remixToLocal` |
| `src/lib/sharing/publish-client.ts` | `publishPlan(plan, opts)` |
| `src/lib/sharing/SaveIndicator.svelte` | Saved / Saving… / Autosave off chip (N4) |
| `src/lib/sharing/PublishDialog.svelte` | modal dialog: form, publishing, success, errors |
| `src/lib/sharing/PublishButton.svelte` | header button states (disabled / Share link / ready) + dialog |
| `src/lib/sharing/NoticeStack.svelte` | one-line dismissible notices + toast above the map |
| `src/lib/sharing/SharedBanner.svelte` | `/p/:id` banner, N5/N6, Remix confirm |
| `src/routes/+page.svelte` (modify), `src/routes/+page.ts` (comment only) | `/` wiring |
| `src/routes/p/[id]/+page.server.ts`, `+page.ts`, `+page.svelte`, `+error.svelte` | read-only view |
| `e2e/helpers/sharing.ts`, `e2e/share-*.spec.ts` | e2e |
| `docs/dev/plan-sharing.md`, `CLAUDE.md` (link) | docs |

---

### Task 1: `Editor.setTitle` (brush-tool, additive)

**Files:**
- Modify: `src/lib/brush/editor.svelte.ts`
- Test: `src/lib/brush/editor.svelte.spec.ts` (add a `describe('setTitle')`; do not change existing tests except an assertion enumerating interface members, if one exists)

**Interfaces:**
- Produces: `Editor.setTitle(title: string | undefined): void`.

Contract (conductor ruling, DC): replaces `plan` with `{ ...plan, title }` (a new `$state.raw` object) — or with `title` removed when undefined; keeps undo/redo stacks; no-op when `readOnly`; does NOT fire `onLoad` listeners; posts nothing (the editor has no worker reference — BrushEditor only posts from `onLoad`, so not firing `onLoad` is the guarantee). Normalise: trim; empty → undefined; clip to `TITLE_MAX_CHARS` (from `$lib/plan`). If the normalised title equals the current one, do nothing (no new object).

- [ ] **Step 1: Write failing tests** (append to `editor.svelte.spec.ts`; reuse that file's existing plan/op helpers — read the file first):

```ts
describe('setTitle', () => {
  it('replaces plan with the normalised title, keeping ops', () => {
    const e = createEditor(base());
    e.commit(op('a'));
    const before = e.plan;
    e.setTitle('  Mission infill  ');
    expect(e.plan).not.toBe(before);
    expect(e.plan.title).toBe('Mission infill');
    expect(e.plan.ops).toEqual(before.ops);
  });
  it('empty or whitespace removes the title key', () => {
    const e = createEditor({ ...base(), title: 'x' });
    e.setTitle('   ');
    expect('title' in e.plan).toBe(false);
    e.setTitle('y');
    e.setTitle(undefined);
    expect('title' in e.plan).toBe(false);
  });
  it('clips to TITLE_MAX_CHARS', () => {
    const e = createEditor(base());
    e.setTitle('a'.repeat(TITLE_MAX_CHARS + 5));
    expect(e.plan.title).toHaveLength(TITLE_MAX_CHARS);
  });
  it('preserves undo and redo', () => {
    const e = createEditor(base());
    e.commit(op('a'));
    e.commit(op('b'));
    e.undo();
    e.setTitle('t');
    expect(e.canRedo).toBe(true);
    expect(e.redo()?.id).toBe('b');
    expect(e.plan.title).toBe('t');
    expect(e.undo()?.id).toBe('b');
  });
  it('is a no-op when read-only', () => {
    const e = createEditor(base(), { readOnly: true });
    const before = e.plan;
    e.setTitle('t');
    expect(e.plan).toBe(before);
  });
  it('does not fire onLoad', () => {
    const e = createEditor(base());
    const cb = vi.fn();
    e.onLoad(cb);
    e.setTitle('t');
    expect(cb).not.toHaveBeenCalled();
  });
  it('same title is a no-op (no new object)', () => {
    const e = createEditor({ ...base(), title: 't' });
    const before = e.plan;
    e.setTitle(' t ');
    expect(e.plan).toBe(before);
  });
});
```

Also add one BrushEditor-level test (in `src/lib/brush/BrushEditor.load.svelte.spec.ts` style, new file `src/lib/brush/BrushEditor.title.svelte.spec.ts`) that renders BrushEditor with the fake worker used by the existing load spec, waits for ready, records worker messages, calls `getEditor().setTitle('t')`, and asserts no new `load` message was posted. Copy the harness setup from `BrushEditor.load.svelte.spec.ts`.

- [ ] **Step 2: Run** (`.svelte.spec.ts` files run in the client project) `npx vitest --run --project client src/lib/brush/editor.svelte.spec.ts src/lib/brush/BrushEditor.title.svelte.spec.ts`. Expected: FAIL (`setTitle` is not a function).

- [ ] **Step 3: Implement** in `editor.svelte.ts`: add to the `Editor` interface

```ts
  /**
   * Sets the plan title (plan-sharing's Publish dialog). Trims, treats empty as undefined and
   * clips to TITLE_MAX_CHARS. Replaces `plan` with a new object (so an `$effect` on `plan`
   * fires) but keeps undo/redo, never fires `onLoad`, and so never re-sends the plan to the
   * worker (the title does not affect rendering). No-op when read-only or unchanged.
   */
  setTitle(title: string | undefined): void;
```

and in `createEditor`:

```ts
    setTitle(title) {
      if (readOnly) return;
      const t = title?.trim().slice(0, TITLE_MAX_CHARS) || undefined;
      if (t === plan.title) return;
      const next: Plan = { ...plan };
      if (t === undefined) delete next.title;
      else next.title = t;
      plan = next;
    },
```

(import `TITLE_MAX_CHARS` from `$lib/plan`; trim before slice, then trim again is unnecessary.)

- [ ] **Step 4: Run** the two spec files plus all brush client specs: `npx vitest --run --project client src/lib/brush` — all PASS.
- [ ] **Step 5: Commit** `git add src/lib/brush` then `git commit -m "feat(brush): add Editor.setTitle for plan-sharing" -m "Additive: replaces plan with the normalised title, keeps undo/redo, no onLoad, no worker post. Conductor ruling."`

---

### Task 2: Shared sharing primitives — ids, api types, copy, hash, title

**Files:**
- Create: `src/lib/sharing/ids.ts`, `src/lib/sharing/ids.spec.ts`
- Create: `src/lib/sharing/api.ts`
- Create: `src/lib/sharing/copy.ts`, `src/lib/sharing/copy.spec.ts`
- Create: `src/lib/sharing/hash.ts`, `src/lib/sharing/hash.spec.ts`
- Create: `src/lib/sharing/title.ts`, `src/lib/sharing/title.spec.ts`

**Interfaces:**
- Consumes: `Editor.setTitle` (Task 1); `MAX_PLAN_BYTES`, `OPS_MAX`, `TITLE_MAX_CHARS`, `PlanError`, `Plan` from `$lib/plan`.
- Produces:

```ts
// ids.ts
export const PLAN_ID_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const PLAN_ID_RE = /^[1-9A-HJ-NP-Za-km-z]{8}$/;
export function newPlanId(rand?: (n: number) => Uint8Array): string;

// api.ts
export type ShareErrorCode = 'invalid_json' | 'invalid_plan' | 'unsupported_schema' | 'too_large'
  | 'too_many_ops' | 'empty_plan' | 'unknown_dataset_version' | 'unsupported_media_type'
  | 'rate_limited' | 'not_found' | 'server_error';
export interface ShareError { error: { code: ShareErrorCode; message: string; details?: PlanError[] } }
export const SHARE_ERROR_CODES: readonly ShareErrorCode[];
export function isShareError(v: unknown): v is ShareError;
export const planPath = (id: string) => `/p/${id}`;

// hash.ts
export async function sha256Hex(text: string): Promise<string>; // lowercase hex of UTF-8 bytes

// title.ts
export function normalizeTitle(t: string | undefined): string | undefined; // trim, ''→undefined, clip TITLE_MAX_CHARS
export function withTitle(plan: Plan, title: string | undefined): Plan;     // pure; key removed when undefined
export function applyTitle(editor: Pick<Editor, 'setTitle'>, title: string | undefined): void; // the ONLY setTitle call site

// copy.ts — exact strings from spec §4.6–§4.8
export const kb: (bytes: number) => number;                       // Math.ceil(bytes / 1024)
export const LIMIT_KB: number;                                     // MAX_PLAN_BYTES / 1024 = 256
export const COPY: {
  disabledHint: 'Paint something first.';
  dialogHeading: 'Publish this plan';
  dialogBody: 'Published plans are public and permanent. Anyone with the link can view and remix it. You can keep editing your own copy afterward.';
  successHeading: 'Published';
  tooManyOps: 'This plan has more than 5,000 strokes, the most a shared plan can hold.';
  unknownDataset: "This plan uses map data the server doesn't recognise. Reload the page and try again.";
  rateLimited: 'Too many plans published from your network. Try again in a minute.';
  network: "Couldn't publish. Check your connection and try again.";
  notFoundHeading: 'Plan not found';
  notFoundBody: "This link doesn't match a published plan. It may have been mistyped or removed.";
  startOwn: 'Start your own plan';
  unparsable: "This plan can't be shown by this version of the app.";
  autosaveOff: 'Autosave off';
  n1: "Your saved plan couldn't be read, so we started a new one. The old data was kept in this browser in case it can be recovered.";
  n2: 'Your saved plan was made by a newer version of this app. We started a new one; the old plan was kept in this browser.';
  n4: "Your browser isn't letting this site save. Changes will be lost when you close the tab. Publish to keep a copy.";
};
export function sizeLine(bytes: number): string;      // `Size: ${kb} KB of 256 KB`
export function tooLarge(bytes: number): string;      // `This plan is too large to share (${kb} KB of the 256 KB limit). Try fewer or shorter strokes.`
export function cannotRead(code: string): string;     // `The server couldn't read this plan (code: ${code}). Please report this.`
export function n3(oldV: string, newV: string): string;
export function n5(planV: string, current: string): string;
export function n6(planV: string, current: string): string;
export function remixedToast(label: string): string;  // `Remixed from ${label}. You're editing your own copy.`
export function remixConfirm(n: number): string;      // `Replace your current plan (${n} strokes) with a copy of this one? Your current plan will be lost unless you publish it first.`
export function serverMessage(code: ShareErrorCode, bytes?: number): string; // message field in API error bodies
export function ogDescription(n: number): string;     // `A plan for San Francisco housing with ${n} brush strokes. Open it to see the buildings and net new units.`
export function formatPublished(iso: string): string; // UTC, en-US {month:'short',day:'numeric',year:'numeric'} → 'Oct 11, 2026'
```

`serverMessage`: `too_large` → `tooLarge(bytes)` if bytes known else `This plan is too large to share (over the 256 KB limit). Try fewer or shorter strokes.`; `too_many_ops` → `COPY.tooManyOps`; `unknown_dataset_version` → `COPY.unknownDataset`; `rate_limited` → `COPY.rateLimited`; `not_found` → `COPY.notFoundHeading + '.'`; `server_error` → `COPY.network`; every other code → `cannotRead(code)`.

- [ ] **Step 1: Write failing tests**

`ids.spec.ts` (server project):

```ts
import { describe, expect, it } from 'vitest';
import { PLAN_ID_ALPHABET, PLAN_ID_RE, newPlanId } from './ids';

function seeded(seed: number) {
  let s = seed >>> 0;
  return (n: number) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      s = (s * 1664525 + 1013904223) >>> 0; // LCG
      out[i] = s >>> 24;
    }
    return out;
  };
}

describe('newPlanId', () => {
  it('alphabet is 58 distinct base58 chars matched by PLAN_ID_RE', () => {
    expect(new Set(PLAN_ID_ALPHABET).size).toBe(58);
    expect(PLAN_ID_RE.test(PLAN_ID_ALPHABET.slice(0, 8))).toBe(true);
    for (const bad of ['0', 'O', 'I', 'l']) expect(PLAN_ID_RE.test(bad.repeat(8))).toBe(false);
  });
  it('10k ids all match PLAN_ID_RE', () => {
    for (let i = 0; i < 10_000; i++) expect(newPlanId()).toMatch(PLAN_ID_RE);
  });
  it('skips bytes >= 232 (rejection sampling)', () => {
    const bytes = [232, 255, 0, 240, 1, 2, 3, 4, 5, 6, 57, 58];
    let i = 0;
    const rand = (n: number) => Uint8Array.from({ length: n }, () => bytes[i++ % bytes.length]);
    // accepted: 0,1,2,3,4,5,6,57 → indices; 58 % 58 = 0 would be next
    expect(newPlanId(rand)).toBe([0, 1, 2, 3, 4, 5, 6, 57].map((k) => PLAN_ID_ALPHABET[k]).join(''));
  });
  it('is uniform within ±20% over 58k chars (seeded)', () => {
    const counts = new Map<string, number>();
    const rand = seeded(42);
    for (let i = 0; i < 58_000 / 8; i++)
      for (const c of newPlanId(rand)) counts.set(c, (counts.get(c) ?? 0) + 1);
    for (const c of PLAN_ID_ALPHABET) {
      const n = counts.get(c) ?? 0;
      expect(n).toBeGreaterThanOrEqual(800);
      expect(n).toBeLessThanOrEqual(1200);
    }
  });
});
```

`hash.spec.ts`: `sha256Hex('abc')` → `'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'`; `sha256Hex('é')` equals the node `crypto.createHash('sha256').update('é','utf8').digest('hex')`.

`title.spec.ts`: `normalizeTitle('  a ')==='a'`, `normalizeTitle('   ')===undefined`, `normalizeTitle(undefined)===undefined`, clip to 120; `withTitle(plan,'  ')` has no `title` key and does not mutate input; `applyTitle({ setTitle: vi.fn() }, ' x ')` calls `setTitle('x')`.

`copy.spec.ts`: assert each function's exact output for sample inputs (e.g. `tooLarge(41 * 1024 + 1)` → `'This plan is too large to share (42 KB of the 256 KB limit). Try fewer or shorter strokes.'`, `sizeLine(41_000)` → `'Size: 41 KB of 256 KB'`, `formatPublished('2026-10-11T23:30:00Z')` → `'Oct 11, 2026'`, `n3('fixture-0','fixture-1')` → `"Your plan was made with an older map dataset (fixture-0). It's now shown on the current data (fixture-1), so some numbers may differ."`, `n5`/`n6` per spec §4.8 verbatim, `serverMessage('invalid_plan')` → `cannotRead('invalid_plan')`, `LIMIT_KB === 256`).

- [ ] **Step 2: Run** `npx vitest --run --project server src/lib/sharing` → FAIL (modules missing).
- [ ] **Step 3: Implement.** `newPlanId`:

```ts
export function newPlanId(
  rand: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))
): string {
  let id = '';
  while (id.length < 8) {
    for (const b of rand(16)) {
      if (b >= 232) continue; // 232 = 4 × 58: keeps byte % 58 uniform
      id += PLAN_ID_ALPHABET[b % 58];
      if (id.length === 8) break;
    }
  }
  return id;
}
```

(The rejection test supplies 12-byte cycles; `rand(16)` reading 16 bytes is fine because the test's `rand` cycles.) `sha256Hex` via `crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))` → hex. Copy strings verbatim from spec §4.6–§4.8; `copy.ts` imports only `$lib/plan` constants.

- [ ] **Step 4: Run** → PASS. `npm run lint` clean for these files.
- [ ] **Step 5: Commit** `git add src/lib/sharing` → `git commit -m "feat(sharing): ids, api types, copy, hash and title helpers"`.

---

### Task 3: D1 `plan` table, generated migration, in-memory D1 shim

**Files:**
- Create: `src/lib/server/db/schema/plan.ts`; Modify: `src/lib/server/db/schema/index.ts`
- Generated: `migrations/d1/*` (via `npm run db:generate`; remove `migrations/d1/.gitkeep` only if the tool does)
- Create: `src/lib/server/test/d1.ts`, `src/lib/server/test/d1.spec.ts`
- Create: `src/lib/server/test/fake-rate-limiter.ts`

**Interfaces:**
- Produces:

```ts
// schema/plan.ts — exactly spec §4.1
export const plan = sqliteTable('plan', {
  id: text('id').primaryKey(),
  schema: integer('schema').notNull(),
  datasetVersion: text('dataset_version').notNull(),
  body: text('body').notNull(),
  contentHash: text('content_hash').notNull().unique(),
  opCount: integer('op_count').notNull(),
  byteSize: integer('byte_size').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
}, (t) => [index('plan_created_at_idx').on(t.createdAt)]);
export type PlanRow = typeof plan.$inferSelect;

// schema/index.ts
export * from './plan';

// test/d1.ts
export interface TestD1 { d1: D1Database; sqlite: import('better-sqlite3').Database; close(): void }
export function createTestD1(): TestD1;   // ':memory:', every migrations/d1/**/*.sql applied in sorted order
export function testPlatform(over: Partial<Env> & { d1?: D1Database }): App.Platform; // { env: {...}, ctx, caches } cast

// test/fake-rate-limiter.ts
export class FakeRateLimiter { calls: string[]; constructor(opts: { allow: number }); limit(o: { key: string }): Promise<{ success: boolean }> }
```

The shim implements the D1 surface `drizzle-orm/d1` uses (verified at `node_modules/drizzle-orm/d1/session.js`: `prepare(sql)`, `.bind(...params)`, `.all()` → `{ results, success: true, meta }`, `.run()` → `{ success: true, meta: { changes, last_row_id }, results: [] }`, `.raw()` → row arrays, `.first()`, and `batch(stmts)`). Use better-sqlite3 `stmt.reader` to choose `.all()` vs `.run()`; `raw()` uses `stmt.raw(true).all()`. Bind `undefined` as `null`.

- [ ] **Step 1:** Write the schema files. Run `npm run db:generate`. If it prompts interactively, answer for a new table; if it needs a migration name use `plan`. Inspect the generated SQL: one `CREATE TABLE plan` with the `content_hash` unique index and `plan_created_at_idx`. Run `npm run db:migrate` (local only) — expect success.
- [ ] **Step 2: Write failing test** `d1.spec.ts`:

```ts
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import * as schema from '$lib/server/db/schema';
import { createTestD1 } from './d1';

describe('createTestD1', () => {
  it('applies the generated migration and round-trips a plan row through drizzle-orm/d1', async () => {
    const t = createTestD1();
    const db = drizzle(t.d1, { schema });
    const createdAt = new Date('2026-10-11T00:00:00Z');
    const res = await db.insert(schema.plan).values({ id: 'abcdefgh', schema: 1, datasetVersion: 'fixture-0',
      body: '{}', contentHash: 'h', opCount: 0, byteSize: 2, createdAt }).onConflictDoNothing().run();
    expect(res.meta.changes).toBe(1);
    const again = await db.insert(schema.plan).values({ id: 'zzzzzzzz', schema: 1, datasetVersion: 'fixture-0',
      body: '{}', contentHash: 'h', opCount: 0, byteSize: 2, createdAt }).onConflictDoNothing().run();
    expect(again.meta.changes).toBe(0);
    const row = await db.query.plan.findFirst({ where: eq(schema.plan.id, 'abcdefgh') }) // if relational query API differs in this drizzle rc, use db.select().from(schema.plan).where(...).get()
    expect(row?.createdAt).toEqual(createdAt);
    const cols = t.sqlite.prepare('PRAGMA table_info(plan)').all().map((c: any) => c.name);
    expect(cols.sort()).toEqual(['body','content_hash','created_at','dataset_version','byte_size','id','op_count','schema'].sort());
    t.close();
  });
});
```

(Use `db.select().from(schema.plan).where(eq(...)).get()` — the plain query builder — in the final code; it is what the route code uses.)

- [ ] **Step 3: Run** → FAIL; implement `d1.ts` and `fake-rate-limiter.ts` (`limit` pushes the key and returns `{ success: calls.length <= allow }`). Run → PASS.
- [ ] **Step 4:** `npm run check` passes (schema types). Acceptance criterion 4: the table has no IP/client-identifier column — the `PRAGMA` assertion above pins it.
- [ ] **Step 5: Commit** `git add src/lib/server migrations` → `git commit -m "feat(sharing): plan table, generated D1 migration and in-memory D1 shim"`.

---

### Task 4: Rate limit and capped body reader

**Files:**
- Create: `src/lib/server/sharing/rate-limit.ts`, `rate-limit.spec.ts`
- Create: `src/lib/server/sharing/read-body.ts`, `read-body.spec.ts`

**Interfaces:**
- Produces:

```ts
export type RateLimiter = { limit(opts: { key: string }): Promise<{ success: boolean }> };
/** true = allowed. development → always true. Missing binding: production → false (fail closed, console.error with label only), other envs → true. */
export async function enforceRate(limiter: RateLimiter | undefined, key: string, env: { ENVIRONMENT?: string }): Promise<boolean>;

export type CappedBody = { ok: true; text: string } | { ok: false; reason: 'too_large' };
/** Reads request.body as a stream; cancels and returns too_large once more than `max` bytes are read. Never trusts Content-Length. Empty body → ok ''. */
export async function readCapped(request: Request, max: number): Promise<CappedBody>;
```

Port from planafoot `src/lib/server/security/rate-limit.ts:43–74` (read it at `/Users/mindlace/Projects/planafoot/src/lib/server/security/rate-limit.ts`), trimmed: no analytics, no breach logging, no `silent`/`ctx`; always critical; test bypass is `env.ENVIRONMENT === 'development'`. Never log the key (it embeds the IP) — log `key.split(':')[0]` only.

- [ ] **Step 1: Failing tests.** rate-limit: development + denying limiter → true and limiter not called; production + undefined → false (and `console.error` called with a string not containing `1.2.3.4` for key `publish:1.2.3.4`); staging + undefined → true; production + `FakeRateLimiter({allow:1})` → true then false; key forwarded verbatim. read-body: 10-byte body with max 10 → ok; 11 bytes → too_large; a `ReadableStream` that enqueues 300 KB in 1 KB chunks and records how many chunks were pulled — with max 262,144 it returns too_large and pulled ≤ 258 chunks (stopped early); multibyte UTF-8 split across chunks decodes correctly (`'é'.repeat(1000)` in 3-byte chunks); `new Request(url, { method: 'POST' })` with no body → `{ ok: true, text: '' }`.
- [ ] **Step 2: Run** `npx vitest --run --project server src/lib/server/sharing` → FAIL.
- [ ] **Step 3: Implement** `readCapped` with `request.body.getReader()`, summing `value.byteLength`, `await reader.cancel()` when over, `TextDecoder` with `{ stream: true }`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(sharing): fail-closed publish rate limit and capped body reader"`.

---

### Task 5: `POST /api/plans`

**Files:**
- Create: `src/lib/server/sharing/respond.ts`, `src/lib/server/sharing/store.ts`, `src/lib/server/sharing/publish.ts`
- Create: `src/routes/api/plans/+server.ts`
- Create fixtures: `src/lib/sharing/fixtures/plans/oversize.json` (exactly 262,145 bytes; a valid-looking JSON object whose `title`-free plan is padded with ops — generate with a one-off node snippet, commit the file, add it to `.prettierignore` next to `small.json`), `schema2.json` (`{"schema":2,"datasetVersion":"fixture-0","ops":[…one op…]}`), `old-version.json` (`small.json` with `"datasetVersion":"fixture-0000"`; canonical, also in `.prettierignore`)
- Test: `src/routes/api/plans/server.spec.ts`, `src/lib/server/sharing/publish.spec.ts` (mapping unit tests)

**Interfaces:**
- Consumes: Tasks 2–4 (`newPlanId`, `ShareErrorCode`, `serverMessage`, `sha256Hex`, `createTestD1`, `testPlatform`, `FakeRateLimiter`, `enforceRate`, `readCapped`), `FakeR2Bucket` (`src/lib/server/test/fake-r2.ts`), `getDb`, `parsePlan`, `serializePlan`, `MAX_PLAN_BYTES`, `PlanError`.
- Produces:

```ts
// respond.ts
export function json(status: number, body: unknown, headers?: Record<string, string>): Response; // content-type application/json, cache-control no-store unless overridden
export function shareError(status: number, code: ShareErrorCode, opts?: { message?: string; details?: PlanError[]; headers?: Record<string, string> }): Response;

// store.ts
type Db = ReturnType<typeof getDb>;
export async function findPlanById(db: Db, id: string): Promise<PlanRow | undefined>;
export async function findPlanByHash(db: Db, hash: string): Promise<PlanRow | undefined>;
export async function insertPlan(db: Db, row: PlanRow): Promise<boolean>; // true = inserted; uses onConflictDoNothing().run(), meta.changes

// publish.ts
export interface PublishDeps { newId?: () => string; now?: () => Date }
export function errorForParse(errors: PlanError[]): { status: number; code: ShareErrorCode; details?: PlanError[] };
export async function handlePublish(event: { request: Request; platform: App.Platform | undefined }, deps?: PublishDeps): Promise<Response>;

// +server.ts
export const POST: RequestHandler = (event) => handlePublish(event);
```

Steps exactly per spec §4.3 table, in order:
1. media type: `(request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() !== 'application/json'` → 415.
2. `enforceRate(env.PUBLISH_RL, 'publish:' + (request.headers.get('cf-connecting-ip') ?? 'unknown'), env)` false → 429 `rate_limited`, header `Retry-After: 60`. The body must not be touched before this point.
3. `Content-Length` present and `Number(cl) > MAX_PLAN_BYTES` → 413.
4. `readCapped(request, MAX_PLAN_BYTES)` too_large → 413.
5. `parsePlan(text)`; failure → `errorForParse(errors)`: first error's code decides — `not-json` → 400 `invalid_json`; `future-schema`/`unknown-schema` → 422 `unsupported_schema`; `too-many-ops` → 422 `too_many_ops`; `too-large` → 413 `too_large`; else 422 `invalid_plan` with `details = errors.slice(0, 20)`.
6. `ops.length === 0` → 422 `empty_plan`.
7. `await env.BUCKET.head('data/' + plan.datasetVersion + '/manifest.json')` null → 422 `unknown_dataset_version`.
8. `body = serializePlan(plan)`, `hash = await sha256Hex(body)`; `findPlanByHash` → 200 `{ id }`.
9. up to 3 attempts: `id = newId()`; `insertPlan(...)` true → 201 `{ id }` + `Location: /p/<id>`; false → `findPlanByHash(hash)` exists → 200 `{ id: existing.id }` (race), else continue. After 3 → 500 `server_error`.
Wrap everything after step 1 in try/catch → 500 `server_error` (and `console.error` the error, no key/IP). Every response: `content-type: application/json`, `cache-control: no-store`, no CORS headers. Error `message` = `serverMessage(code, bytes?)`.

- [ ] **Step 1: Failing tests** in `server.spec.ts`. Harness:

```ts
const small = readFileSync(fileURLToPath(new URL('../../../lib/sharing/fixtures/plans/small.json', import.meta.url)), 'utf8');
function setup(opts: { allow?: number; env?: string; noLimiter?: boolean } = {}) {
  const t = createTestD1();
  const bucket = new FakeR2Bucket();
  bucket.put('data/fixture-0/manifest.json', '{}');
  const limiter = new FakeRateLimiter({ allow: opts.allow ?? 100 });
  const platform = testPlatform({ d1: t.d1, BUCKET: bucket as never, ENVIRONMENT: opts.env ?? 'production',
    PUBLISH_RL: opts.noLimiter ? undefined : (limiter as never) });
  return { t, bucket, limiter, platform };
}
const post = (body: BodyInit | null, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
  new Request('https://sfhousing.test/api/plans', { method: 'POST', body, headers, duplex: 'half' } as RequestInit);
```

Cases (each its own `it`, each asserting status + `error.code` + `content-type`/`cache-control: no-store` where relevant):
- 201 + `{ id }` matching `PLAN_ID_RE` for `small.json`; `Location: /p/<id>`; row: `schema 1`, `dataset_version 'fixture-0'`, `body === serializePlan(parsePlan(small).value)`, `content_hash === sha256Hex(body)`, `op_count 3`, `byte_size === utf8 length`, `created_at` = injected `now`.
- same body again → 200, same id, `SELECT count(*)` = 1; `JSON.stringify({ ...JSON.parse(small), extra: 1 }, null, 2)` → same id (non-canonical equivalent).
- **Review Focus 1:** small with `title: '  My plan  '` → 201; row body has `"title":"My plan"`; `content_hash === await sha256Hex(serializePlan(withTitle(plan, normalizeTitle('  My plan  '))))`.
- **Review Focus 4:** `content-type: application/json; charset=utf-8` → 201; `text/plain` → 415 `unsupported_media_type`; no content-type → 415.
- 413 by `Content-Length: 262145` header with a tiny body (assert the limiter was called first: `limiter.calls.length === 1`).
- 413 by streamed body without `Content-Length`: body is a `ReadableStream` over `oversize.json` bytes (a stream prevents Request from setting Content-Length).
- 413 for an in-test generated 5001-op plan (ruling 3): build `{schema:1,datasetVersion:'fixture-0',ops:[...5001 × {id:'o'+i,kind:'erase',radiusM:5,path:[[-122.42,37.76]]}]}` and assert its JSON is > 262,144 bytes and the response is 413 `too_large`.
- 400 `invalid_json` for `not json`; 422 `unsupported_schema` for `schema2.json`; 422 `empty_plan` for `{"schema":1,"datasetVersion":"fixture-0","ops":[]}`; 422 `invalid_plan` with `details` array (non-empty, ≤ 20, each `{path, code, message}`) for a plan whose op has `stories: 0`; 422 `unknown_dataset_version` for `old-version.json`.
- 429 with `Retry-After: 60` when `allow: 0`; body never read: pass a `ReadableStream` whose `pull` sets a flag and assert the flag stayed false.
- PK collision: pre-insert a row with id `'AAAAAAAA'`; `newId` returns `'AAAAAAAA'`, `'AAAAAAAA'`, then `'BBBBBBBB'` → 201 `{ id: 'BBBBBBBB' }`; returning `'AAAAAAAA'` forever → 500 `server_error`, exactly 3 calls.
- **Review Focus 5 (race):** stub `findPlanByHash` path: pre-insert a row with the same `content_hash` but call `handlePublish` with a `deps` hook… simplest: wrap `t.d1` so the *first* `SELECT … content_hash` returns no row (proxy `prepare` that, for the first statement whose SQL contains `content_hash` and starts with `select`, returns an empty `all()`), with the row already present → insert conflicts on `content_hash` → 200 with the existing id.
- production with `PUBLISH_RL` undefined → 429; `ENVIRONMENT: 'development'` with `allow: 0` → 201.
- DB binding missing → 500 `server_error` JSON.

`publish.spec.ts`: `errorForParse` for each `PlanErrorCode` (`not-json`, `future-schema`, `unknown-schema`, `too-many-ops`, `too-large`, `bad-field`) → expected status/code; details clipped to 20 when 25 errors are passed.

- [ ] **Step 2: Run** `npx vitest --run --project server src/routes/api/plans src/lib/server/sharing` → FAIL.
- [ ] **Step 3: Implement** per the step list above. Add fixtures; add `oversize.json` and `old-version.json` and `schema2.json` to `.prettierignore` beside `small.json`.
- [ ] **Step 4: Run** → PASS; `npm run check` and `npm run lint` clean.
- [ ] **Step 5: Commit** `git commit -m "feat(sharing): POST /api/plans with caps, dedupe and rate limit"`.

---

### Task 6: `GET /api/plans/:id` and the `/p/[id]` server load

**Files:**
- Create: `src/lib/server/sharing/get-plan.ts`, `src/routes/api/plans/[id]/+server.ts`, test `src/routes/api/plans/[id]/server.spec.ts`
- Create: `src/lib/server/sharing/shared-page.ts`, `src/routes/p/[id]/+page.server.ts`, test `src/routes/p/[id]/page.server.spec.ts`

**Interfaces:**
- Consumes: Task 3 shim, Task 5 `findPlanById`, `json`, `shareError`, `PLAN_ID_RE`, `parsePlan`.
- Produces:

```ts
export async function handleGetPlan(event: { params: { id: string }; request: Request; platform: App.Platform | undefined }): Promise<Response>;

export type DatasetNotice = 'none' | 'remix' /* N5: plan's version exists, differs from current */ | 'gone' /* N6: plan's version 404s */;
export interface SharedPlanData {
  id: string; plan: Plan; createdAt: string /* ISO */; currentDatasetVersion: string;
  renderVersion: string; /* plan.datasetVersion, or current when gone */ datasetNotice: DatasetNotice;
}
/** Throws SvelteKit error(404, COPY.notFoundHeading) for bad id / missing row, error(500, COPY.unparsable) for a body parsePlan rejects. */
export async function loadSharedPlan(args: { id: string; platform: App.Platform | undefined; current: string }): Promise<SharedPlanData>;
```

GET: id fails `PLAN_ID_RE` → 404 `not_found` with **no DB access**; missing row → 404 `not_found`, `cache-control: no-store`; found → 200, body = stored `body` verbatim, `content-type: application/json`, `cache-control: public, max-age=3600`, `etag: "<contentHash>"`; `If-None-Match` containing that etag (or `*`) → 304, empty body, same etag + cache-control. DB failure → 500 `server_error`.

`/p/[id]/+page.server.ts`:

```ts
export const load: PageServerLoad = async ({ params, platform, parent, setHeaders }) => {
  const { datasetVersion } = await parent();
  const data = await loadSharedPlan({ id: params.id, platform, current: datasetVersion });
  setHeaders({ 'cache-control': 'public, max-age=300' });
  return data;
};
```

`loadSharedPlan`: datasetNotice = `'none'` when `plan.datasetVersion === current` (no R2 call); else `BUCKET.head('data/<v>/manifest.json')` → present `'remix'` / null `'gone'`. Validate id before any DB call.

- [ ] **Step 1: Failing tests.** GET: 200 verbatim (insert via `handlePublish` from Task 5, then GET; body byte-identical to `serializePlan(parsed small)` — acceptance 1); ETag and cache header; 304 on matching `If-None-Match`; 404 for `'0OIl0OIl'` with a `d1` proxy whose `prepare` is a `vi.fn` asserted not called; 404 for a well-formed missing id with `no-store`. Page load: found → data fields (`createdAt` ISO, `datasetNotice 'none'`, no `head` call on `FakeR2Bucket.calls`); plan version `fixture-1` with `data/fixture-1/manifest.json` present and current `fixture-0` → `'remix'`, renderVersion `fixture-1`; absent → `'gone'`, renderVersion `fixture-0`; bad id → throws an HttpError with status 404 (`expect(...).rejects.toMatchObject({ status: 404 })`); missing → 404; a row whose body is `{"schema":9}` (inserted raw via `t.sqlite`) → 500.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS, check + lint.
- [ ] **Step 5: Commit** `git commit -m "feat(sharing): GET /api/plans/:id and /p/[id] server load"`.

---

### Task 7: Local storage and autosave

**Files:**
- Create: `src/lib/sharing/storage.ts`, `src/lib/sharing/storage.spec.ts` (server project; inject a fake `Storage`)
- Create: `src/lib/sharing/autosave.svelte.ts`, `src/lib/sharing/autosave.svelte.spec.ts` (client project)
- Create: `src/lib/sharing/remix.ts`, `src/lib/sharing/remix.spec.ts` (server project)

**Interfaces:**
- Consumes: `parsePlan`, `serializePlan`, `rebasePlan`, `emptyPlan`, `Plan` from `$lib/plan`.
- Produces:

```ts
// storage.ts
export const PLAN_KEY = 'sfhousing:plan:v1';
export const corruptKey = (iso: string) => `sfhousing:plan:corrupt:${iso}`;
export interface LocalPlanRecord { v: 1; savedAt: string; plan: string; lastPublished?: { id: string; hash: string } }
/** window.localStorage, or null when access throws / is undefined (SSR). */
export function getStorage(): Storage | null;
export type ReadResult =
  | { kind: 'missing' }
  | { kind: 'ok'; record: LocalPlanRecord; plan: Plan }
  | { kind: 'corrupt'; raw: string }
  | { kind: 'future'; raw: string };
export function readRecord(storage: Storage): ReadResult; // JSON error, v!==1, missing fields, parsePlan !ok → corrupt; first error code 'future-schema' → future
export function writeRecord(storage: Storage, record: LocalPlanRecord): boolean; // false on any throw (QuotaExceededError)
export function preserveCorrupt(storage: Storage, raw: string, now: Date): boolean;

// remix.ts
export function localOpCount(storage: Storage | null): number; // ok → ops.length, else 0
/** Preserves a corrupt/future local record, then writes rebasePlan(plan, current) (title kept, no lastPublished). Returns the serialized plan and whether the write succeeded. Throws TypeError only if `current` is invalid. */
export function remixToLocal(plan: Plan, current: string, storage: Storage | null, now?: Date): { planText: string; stored: boolean };

// autosave.svelte.ts
export type SaveStatus = 'saved' | 'saving' | 'off';
export type AutosaveNotice = { kind: 'corrupt' } | { kind: 'future' } | { kind: 'rebased'; from: string; to: string };
export interface RestoreResult { plan: Plan; notice: AutosaveNotice | null }
export class Autosave {
  status: SaveStatus;                                  // $state
  lastPublished: { id: string; hash: string } | undefined; // $state.raw
  constructor(opts: { currentVersion: string; storage?: () => Storage | null; debounceMs?: number; now?: () => Date });
  /** Reads (or, when `handoff` is given — Remix via history.state — parses that instead), rebases, writes back, and returns the plan to load. Never throws. */
  restore(handoff?: string): RestoreResult;
  /** Debounced write (500 ms). Skips a plan whose serialization equals the last written one. Sets status 'saving' while pending. */
  schedule(plan: Plan): void;
  /** Writes any pending plan now (visibilitychange→hidden, pagehide). */
  flush(): void;
  /** Stores lastPublished and writes the record for `plan` immediately. */
  setLastPublished(lp: { id: string; hash: string }, plan: Plan): void;
  /** Adds visibilitychange/pagehide flush listeners; returns the remover (also clears the debounce timer). */
  attach(): () => void;
}
```

Behaviour (spec §4.5): restore — missing → `emptyPlan(current)`, no notice; `ok` → if `plan.datasetVersion !== current` → `rebasePlan`, write back immediately, notice `{ kind: 'rebased', from, to }`; same version → no notice; `lastPublished` loaded from the record. `corrupt` → `preserveCorrupt`, empty plan, `{ kind: 'corrupt' }`; `future` → preserve, empty plan, `{ kind: 'future' }`. Storage unavailable (`storage()` null or any throw) → empty plan, status `'off'`. `emptyPlan`/`rebasePlan` throwing (invalid current) → let it propagate? No: `currentVersion` comes from `requireDatasetVersion`, but guard anyway — catch TypeError and rethrow with context (the page would be broken regardless; don't mask). Write = `writeRecord`; success → status `'saved'`; failure → `'off'` and retry on the next `schedule`. The live drag preview never reaches autosave because it never changes `editor.plan`.

- [ ] **Step 1: Failing tests.** `storage.spec.ts` with a `MemoryStorage` class implementing `Storage` (+ a `failWrites` flag throwing `new DOMException('full', 'QuotaExceededError')`): read missing/ok/corrupt JSON/`v:2` → corrupt/`parsePlan` failure → corrupt/`schema: 2` plan → future; writeRecord false on quota. `remix.spec.ts`: `localOpCount` for empty, 3-op, corrupt (0), null storage (0); `remixToLocal` writes rebased plan (datasetVersion = current, title kept, no lastPublished), preserves an existing corrupt record under `corruptKey`, returns `stored:false` when writes fail.
  `autosave.svelte.spec.ts` (client project, `vi.useFakeTimers()`):
  - 3 `schedule` calls within 500 ms → exactly 1 `setItem(PLAN_KEY, …)` after 500 ms, containing the last plan; status `'saving'` before, `'saved'` after.
  - `flush` on `document.dispatchEvent(new Event('visibilitychange'))` with `document.visibilityState` stubbed to `'hidden'` (`vi.spyOn(document, 'visibilityState', 'get')`) writes immediately; `pagehide` too.
  - corrupt record → preserved under a `sfhousing:plan:corrupt:` key + notice `corrupt`; `v: 2` record → corrupt.
  - **Review Focus 3:** corrupt record AND storage whose writes all throw → `restore()` returns an empty plan with notice `corrupt`, status `'off'`, does not throw.
  - `setItem` throwing QuotaExceededError → status `'off'`; next `schedule` with writes succeeding → `'saved'`.
  - record with `datasetVersion: 'fixture-0'`, current `'fixture-1'` → returned plan's datasetVersion `'fixture-1'`, written back immediately (before any timer), notice `{ kind: 'rebased', from: 'fixture-0', to: 'fixture-1' }`; a second `restore()` → no notice (once).
  - same version → notice null.
  - `restore(handoffText)` uses the handoff plan (rebased) even when storage holds another plan.
  - `localStorage` getter throwing (`storage: () => { throw new Error('denied') }`) → status `'off'`, empty plan.
- [ ] **Step 2: Run** server + client specs → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(sharing): localStorage autosave, restore and remix storage"`.

---

### Task 8: Publish client, Publish button, Publish dialog, Save indicator

**Files:**
- Create: `src/lib/sharing/publish-client.ts`, `publish-client.spec.ts` (server project, stub fetch)
- Create: `src/lib/sharing/SaveIndicator.svelte`, `SaveIndicator.svelte.spec.ts`
- Create: `src/lib/sharing/PublishDialog.svelte`, `src/lib/sharing/PublishButton.svelte`, `PublishDialog.svelte.spec.ts`

**Interfaces:**
- Consumes: Task 2 copy/hash/title/api, Task 7 `SaveStatus`, `planByteSize`, `MAX_PLAN_BYTES`, `REPO_URL` from `$lib/config`.
- Produces:

```ts
// publish-client.ts
export type PublishOutcome =
  | { ok: true; id: string }
  | { ok: false; code: ShareErrorCode | 'network'; retryAfter?: number };
/** POSTs serializePlan(plan) with content-type application/json; 15 s AbortController timeout → network. 200/201 with {id} → ok. Non-2xx: code from a ShareError body if parseable, else 5xx → 'network', other → 'server_error'. 429 → retryAfter = Number(Retry-After) || 60. */
export async function publishPlan(plan: Plan, opts?: { fetchFn?: typeof fetch; timeoutMs?: number }): Promise<PublishOutcome>;
/** The error copy for an outcome (spec §4.6 exactly). */
export function publishErrorMessage(o: Exclude<PublishOutcome, { ok: true }>, bytes: number): string;
```

`publishErrorMessage`: `too_large` → `tooLarge(bytes)`; `too_many_ops` → `COPY.tooManyOps`; `unknown_dataset_version` → `COPY.unknownDataset`; `invalid_plan`/`unsupported_schema`/`invalid_json`/`unsupported_media_type`/`empty_plan` → `cannotRead(code)`; `rate_limited` → `COPY.rateLimited`; `network`/`server_error`/`not_found` → `COPY.network`.

Components (props; Svelte 5 runes; no `$app/*` imports):

```ts
// SaveIndicator.svelte
{ status: SaveStatus }
// Visible text 'Saved' | 'Saving…' | 'Autosave off'. When 'off', a button "Autosave off" toggles a popover paragraph with COPY.n4 (aria-expanded, aria-controls). A separate sr-only role="status" aria-live="polite" element whose text changes ONLY on off↔on transitions ('Autosave off' / 'Autosave on'); initial render announces nothing.

// PublishButton.svelte
{ plan: Plan; lastPublished?: { id: string; hash: string }; onpublished(r: { id: string; hash: string; plan: Plan }): void; fetchFn?: typeof fetch; origin?: string /* default location.origin */ }
// States: plan.ops.length === 0 → disabled button "Publish" with aria-describedby → hint COPY.disabledHint (visible sr-only-ok text);
// sha256Hex(serializePlan(plan)) === lastPublished?.hash → button "Share link" opening the dialog in success mode with lastPublished.id, no POST;
// else "Publish" opening the dialog in form mode. Hash computed in an $effect; until it resolves, the button reads "Publish".
// Size classes: min-h-6 min-w-6 pointer-coarse:min-h-11 pointer-coarse:min-w-11.

// PublishDialog.svelte
{ open: boolean ($bindable); plan: Plan; mode: 'form' | 'success'; publishedId?: string; onpublished(r: { id: string; hash: string; plan: Plan }): void; fetchFn?: typeof fetch; origin: string; now?: () => number }
```

Dialog behaviour (spec §4.6): native `<dialog>` opened with `showModal()` when `open` becomes true (inert background + focus containment), `cancel` (Escape) and Cancel/Done set `open = false`. Form: `<h2>` COPY.dialogHeading; label "Title" input `maxlength=120` prefilled from `plan.title`; COPY.dialogBody; `sizeLine(planByteSize(withTitle(plan, normalizeTitle(title))))`; buttons Publish / Cancel. Preflight: that size > `MAX_PLAN_BYTES` → Publish disabled + `tooLarge(bytes)` inline (no request). Publishing: guard flag so a second click is ignored (Review Focus 2); button text "Publishing…", `aria-busy="true"`, input and buttons disabled; `publishPlan(withTitle(plan, normalizeTitle(title)))`. Success: `hash = await sha256Hex(serializePlan(sent))`, call `onpublished({ id, hash, plan: sent })`, switch to success: `<h2>` "Published", readonly input labelled "Link" with value `${origin}/p/${id}` that selects on focus, Copy link (→ "Copied" for 2 s, announced via a `role="status"` live region; `navigator.clipboard.writeText`), Open (`<a href target="_blank" rel="noopener">`), Done, and Share… only when `'share' in navigator` (calls `navigator.share({ url, title })`, ignoring AbortError). Errors: `role="alert"` region with `publishErrorMessage`; for `invalid_plan`/`unsupported_schema`/`invalid_json`/`unsupported_media_type`/`empty_plan` also a link "Report an issue" → `${REPO_URL}/issues`; `too_large` keeps Publish disabled until `plan` or title changes; `rate_limited` disables Publish and shows "You can publish again in N s." counting down each second from `retryAfter`, re-enabling at 0.

- [ ] **Step 1: Failing tests.** `publish-client.spec.ts`: posts `serializePlan(plan)` with the JSON content type; 201 → ok id; 413/422 bodies → code; 429 with `Retry-After: 5` → retryAfter 5, without header → 60; 502 non-JSON → network; fetch rejecting → network; a fetch that never resolves + `timeoutMs: 20` → network (real timers); `publishErrorMessage` for every code.
  `PublishDialog.svelte.spec.ts` (render `PublishButton`, mocked `fetchFn = vi.fn()`):
  - empty plan → button disabled, `aria-describedby` points at text "Paint something first.".
  - oversize preflight: a plan whose `planByteSize` > 262,144 (construct ≈ 4,500 ops of 60 bytes; or 1 op + a big plan via the `oversize` generator) → dialog Publish disabled, inline too-large copy, `fetchFn` not called.
  - publishing busy state: `fetchFn` returns a pending promise → button "Publishing…", `aria-busy=true`, title input disabled; **Review Focus 2**: clicking Publish twice → `fetchFn` called once.
  - success → heading "Published", link field value `https://example.test/p/AbCdEfGh` (pass `origin`), Copy link → "Copied" (stub `navigator.clipboard.writeText`), `onpublished` called with `{ id, hash, plan }` where `plan.title === 'My plan'` for typed `'  My plan  '` and `hash === await sha256Hex(serializePlan(plan))` (**Review Focus 1**).
  - already published: `lastPublished.hash = await sha256Hex(serializePlan(plan))` → button text "Share link", clicking opens success view with the stored id, `fetchFn` not called.
  - 413 → `tooLarge(bytes)` exact text in `role=alert`, Publish disabled; 422 `too_many_ops` copy; 422 `unknown_dataset_version` copy; 422 `invalid_plan` → `cannotRead('invalid_plan')` + issues link href `${REPO_URL}/issues`; 429 with `Retry-After: 2` (fake timers) → rate-limited copy, Publish disabled, "You can publish again in 2 s." then enabled after advancing 2 s; fetch rejecting → network copy.
  - Escape closes the dialog (`userEvent.keyboard('{Escape}')`).
  `SaveIndicator.svelte.spec.ts`: text per status; live region empty on first render with `'saved'`; rerender `'off'` → live text "Autosave off"; rerender `'saving'` → live text still "Autosave off" (recovery is only known once a write succeeds); rerender `'saved'` → live text "Autosave on"; N4 popover toggles.
- [ ] **Step 2: Run** `npx vitest --run --project client src/lib/sharing` and server spec → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; check + lint.
- [ ] **Step 5: Commit** `git commit -m "feat(sharing): publish client, Publish dialog and Saved indicator"`.

---

### Task 9: Wire `/` — restore, autosave, notices, header actions, remix toast

**Files:**
- Create: `src/lib/sharing/NoticeStack.svelte`, `NoticeStack.svelte.spec.ts`
- Modify: `src/routes/+page.svelte`; `src/routes/+page.ts` (replace the "plan-sharing (W5) will supply…" comment with one pointing at the onMount restore — ruling 6; no logic change)
- Test: extend `src/routes/page.svelte.spec.ts` only if it already renders the page component and can run with mocks; otherwise rely on e2e (Task 11) and note it.

**Interfaces:**
- Consumes: `Autosave` (Task 7), `PublishButton`, `SaveIndicator` (Task 8), `applyTitle` (Task 2), `n3`, `COPY.n1/n2`, `remixedToast` (Task 2), `useHeaderActions` (`$lib/shell/header-actions.svelte`), `exposeEditorForDebug` (keep), `page` from `$app/state`, `replaceState` from `$app/navigation`, `browser` from `$app/environment`.
- Produces: `NoticeStack` props `{ notices: { id: string; text: string; tone?: 'info' | 'toast' }[]; ondismiss(id: string): void }` — absolutely positioned at the top of `#map-region` (z-20, `left-1/2 -translate-x-1/2`, `max-w-[calc(100%-2rem)]`, wraps at 375 px), each a one-line item with a Dismiss button (`aria-label="Dismiss"`, ≥ 24 px / 44 px coarse); notices `role="status"`. A `'toast'` auto-dismisses after 8 s.

Wiring in `+page.svelte` (keep the existing scoreboard block untouched and separate; keep `exposeEditorForDebug`):

```svelte
  const autosave = new Autosave({ currentVersion: data.datasetVersion });
  let editor = $state.raw<Editor>();
  let notices = $state<{ id: string; text: string; tone?: 'info' | 'toast' }[]>([]);

  function onEditor(e: Editor) {
    disposeDebugEditor = exposeEditorForDebug(e);
    editor = e;
  }
  onMount(() => {
    if (!editor) return;
    const remix = (page.state as { sfhRemix?: { from: string; plan?: string } }).sfhRemix;
    const r = autosave.restore(remix?.plan);
    editor.load(r.plan);
    if (r.notice?.kind === 'corrupt') notices.push({ id: 'n1', text: COPY.n1 });
    else if (r.notice?.kind === 'future') notices.push({ id: 'n2', text: COPY.n2 });
    else if (r.notice?.kind === 'rebased') notices.push({ id: 'n3', text: n3(r.notice.from, r.notice.to) });
    if (remix) {
      notices.push({ id: 'remix', text: remixedToast(remix.from), tone: 'toast' });
      replaceState('', {}); // ruling 7: no re-toast on reload
    }
    return autosave.attach();
  });
  $effect(() => {
    if (editor) autosave.schedule(editor.plan);
  });
  useHeaderActions(headerActions);
```

```svelte
{#snippet headerActions()}
  <SaveIndicator status={autosave.status} />
  {#if editor}
    <PublishButton
      plan={editor.plan}
      lastPublished={autosave.lastPublished}
      onpublished={(r) => { applyTitle(editor!, r.plan.title); autosave.setLastPublished({ id: r.id, hash: r.hash }, r.plan); }}
    />
  {/if}
{/snippet}
```

and `oneditor={onEditor}` on BrushEditor, `<NoticeStack {notices} ondismiss={(id) => (notices = notices.filter((n) => n.id !== id))} />` inside `#map-region`. Verify that `editor.load` in `onMount` runs after BrushEditor's own `onMount` (children mount first) so the worker's `onReady` sends the restored plan, or `onLoad` posts it if already ready. Verify `autosave.schedule` on the initial restored plan is skipped (same serialization as written) or harmless. Verify the hydrated toolbar reflects the restored plan (undo enabled after restore of a non-empty plan).

- [ ] **Step 1: Failing test** `NoticeStack.svelte.spec.ts`: renders texts; Dismiss calls `ondismiss(id)`; a `'toast'` calls `ondismiss` after 8 s (fake timers); each Dismiss button has an accessible name.
- [ ] **Step 2: Run** → FAIL. **Step 3:** Implement NoticeStack and the page wiring. **Step 4:** `npx vitest --run --project client src/lib/sharing src/routes` PASS; `npm run check`; `npm run lint`; then a manual smoke with `npm run preview` is optional — Task 11's e2e covers it.
- [ ] **Step 5: Commit** `git commit -m "feat(sharing): autosave, restore notices and Publish on the editor page"`.

---

### Task 10: `/p/[id]` page — banner, Remix, read-only map, 404/500 page, meta

**Files:**
- Create: `src/lib/sharing/SharedBanner.svelte`, `SharedBanner.svelte.spec.ts`
- Create: `src/routes/p/[id]/+page.ts`, `src/routes/p/[id]/+page.svelte`, `src/routes/p/[id]/+error.svelte`

**Interfaces:**
- Consumes: `SharedPlanData` (Task 6), `localOpCount`, `remixToLocal`, `getStorage` (Task 7), copy (Task 2), `loadManifest` (`$lib/sim/manifest`), `BrushEditor`, `Scoreboard`, `frameLatest` (as `/` uses them), `goto` (`$app/navigation`).
- Produces:

```ts
// SharedBanner.svelte props
{ title?: string; id: string; createdAt: string; datasetNotice: DatasetNotice; planVersion: string; currentVersion: string;
  localOpCount: () => number; onremix: () => void }
```

Banner (spec §4.7): `<section aria-label="Shared plan">` sticky at the top of the page column, wraps at 375 px: `<strong>{title ?? 'Untitled plan'}</strong> · Shared plan · published {formatPublished(createdAt)}`, buttons **Remix** (primary) and **Start your own** (`<a href="/">`). `datasetNotice === 'remix'` → second line `n5(planVersion, currentVersion)`; `'gone'` → `n6(...)`; each line ends with a button **Open with current data** that runs the same Remix flow. Remix flow: `n = localOpCount()`; `n >= 1` → native modal `<dialog>` with `remixConfirm(n)` and **Replace** / **Cancel**; Replace or `n === 0` → `onremix()`.

`+page.ts`:

```ts
export const load: PageLoad = async ({ data, fetch }) => {
  try {
    const { manifest, fellBack } = await loadManifest(data.plan.datasetVersion, data.currentDatasetVersion, fetch);
    return { ...data, manifest, fellBack, manifestError: false };
  } catch (e) {
    console.error('[sharing] manifest load failed', e);
    return { ...data, manifest: null, fellBack: false, manifestError: true };
  }
};
```

`+page.svelte`: `<svelte:head>` title `${data.plan.title ?? 'Shared plan'} · SF Housing Simulator`, `og:title` same, `og:description` `ogDescription(data.plan.ops.length)`, `og:url` `https://sfhousing.mindlace.net/p/${data.id}`; `<h1 class="sr-only">` with the title; layout `<div class="flex h-full flex-col"><SharedBanner …/><div id="map-region" class="relative min-h-0 flex-1"><BrushEditor readOnly plan={data.plan} manifest manifestError currentVersion={data.currentDatasetVersion} reloadManifest onscore onchunks bind:this /><Scoreboard … /></div></div>` — copy the scoreboard wiring block from `src/routes/+page.svelte` (`frameLatest`, `chunkState`, `scoreStatus` with `datasetVersion: data.manifest?.datasetVersion ?? data.currentDatasetVersion`, `planDatasetVersion: data.plan.datasetVersion`). No `oneditor`, no autosave, no header actions. `onremix`:

```ts
function remix() {
  const { planText, stored } = remixToLocal(data.plan, data.currentDatasetVersion, getStorage());
  const from = data.plan.title ?? data.id;
  void goto('/', { state: { sfhRemix: stored ? { from } : { from, plan: planText } } });
}
```

`+error.svelte` (route-level): status 404 → `<h1>` COPY.notFoundHeading, `<p>` COPY.notFoundBody, `<a href="/">` COPY.startOwn, `<svelte:head><title>Plan not found · SF Housing Simulator</title><meta name="robots" content="noindex" /></svelte:head>`; otherwise `<h1>` COPY.unparsable with link home. Wrap in the same `mx-auto max-w-3xl px-4 py-6` container as the root error page (the layout is full-height on `/p/[id]`; make sure the content scrolls/fits).

- [ ] **Step 1: Failing tests** `SharedBanner.svelte.spec.ts`: title / 'Untitled plan' fallback and `published Oct 11, 2026`; `'none'` shows no notice line; `'remix'` shows exact N5 text + "Open with current data"; `'gone'` shows N6 + button; clicking "Open with current data" with `localOpCount: () => 0` calls `onremix` immediately; Remix with `localOpCount: () => 3` shows the dialog with `remixConfirm(3)`, Cancel → `onremix` not called, Replace → called once; a title `<b>"x"</b>` renders as literal text.
- [ ] **Step 2: Run** → FAIL. **Step 3:** Implement banner, routes, error page. **Step 4:** client specs PASS; `npm run check`; `npm run lint`.
- [ ] **Step 5: Commit** `git commit -m "feat(sharing): read-only /p/[id] with banner, Remix and not-found page"`.

---

### Task 11: e2e, docs, final verification

**Files:**
- Create: `e2e/helpers/sharing.ts` (editor navigation + `mouseDrag`, copied from `e2e/scoreboard.spec.ts` helpers — do not edit brush's or scoreboard's specs), `e2e/share-roundtrip.spec.ts`, `e2e/share-states.spec.ts`, `e2e/share-a11y.spec.ts`
- Create: `docs/dev/plan-sharing.md`; Modify: `CLAUDE.md` (scoped-docs list: add "**Plan sharing (API contract, rate limit, autosave, manual takedown)** — [docs/dev/plan-sharing.md](docs/dev/plan-sharing.md)"); check `scripts/docs-index.spec.ts` passes (it may assert the index).

**Interfaces:**
- Consumes: everything above; `window.__sfhBrush` / `window.__sfhMap` debug hooks; fixture `small.json`; `expectNoA11yViolations`.

e2e (both `chromium` and `mobile` projects unless noted; header actions appear only after hydration, so always wait for the Publish button to be visible/enabled):
- `share-roundtrip.spec.ts` (chromium; mobile may `test.skip` with reason if the 375 px header can't fit — prefer making it fit): gotoEditor → jumpAndIdle(FRAME) → mouseDrag(FROM, TO) → `__sfhBrush.ops === 1` → wait `score-net` settled (same 3-poll loop as scoreboard e2e) and record its text → click header **Publish** → fill Title "Roundtrip" → dialog **Publish** → read the Link field value → `browser.newContext()` → open the path → banner shows "Roundtrip" and "Shared plan" → wait map ready + `score-net` settled → equals the author's text → localStorage in that context is unchanged by the visit (acceptance 6: `localStorage.getItem('sfhousing:plan:v1')` null before and after) → click **Remix** (no confirm: empty local) → URL `/` → toast "Remixed from Roundtrip. You're editing your own copy." visible → `__sfhBrush.ops === 1`.
- `share-states.spec.ts`: `/p/zzzzzzzz` → response status 404 (`page.goto` returns the response), heading "Plan not found", link "Start your own plan", `meta[name=robots][content=noindex]`; `page.route('**/api/plans', r => r.fulfill({ status: 429, headers: { 'retry-after': '5', 'content-type': 'application/json' }, body: JSON.stringify({ error: { code: 'rate_limited', message: '' } }) }))` → paint, open dialog, Publish → rate-limited copy in the alert, Publish disabled, enabled again within ~5–7 s; reload restores the autosaved plan: paint → wait until the header shows "Saved" → `page.reload()` → `__sfhBrush.ops === 1`; Remix confirm when local plan non-empty: publish `small.json` via `request.post('/api/plans', { data: smallText, headers: { 'content-type': 'application/json' } })` (rate limit is bypassed in the development preview), paint locally, open `/p/<id>`, Remix → confirm dialog text with "(1 strokes)" → Cancel keeps you on `/p/<id>`.
- `share-a11y.spec.ts`: `expectNoA11yViolations` on `/p/<id>` (id from `request.post`), the 404 page, the open Publish dialog in success state (real publish) and in an error state (route-mocked 429), at both viewports. Use the same include/exclude scoping the other specs use for the map canvas if needed (read `e2e/pages-a11y.spec.ts` / `e2e/brush.spec.ts`).
- Old-dataset share link (N6) with real R2: post `old-version.json` is rejected by design (unknown dataset), so N6 cannot be produced end-to-end without inserting a row directly → `test.fixme('W6: N6 end-to-end needs a published row whose datasetVersion is absent from R2 (insert via wrangler d1 execute --local)')`. Leave scoreboard's own W6 fixme alone.

`docs/dev/plan-sharing.md`: API contract (§4.3 table, §4.4), error body shape and codes, ids, rate limit (10/60 s per IP via `PUBLISH_RL`, fail closed in production, bypassed when `ENVIRONMENT=development`), autosave key and record shape, notices, `/p/:id` caching, the manual takedown runbook verbatim (`wrangler d1 execute sfhousing --remote --command "DELETE FROM plan WHERE id = '<id>'"`, link 404s, caches expire within 1 h API / 5 min page), and the "too_many_ops is unreachable over HTTP" note.

- [ ] **Step 1:** Write the e2e specs. Kill stale server: `lsof -ti :4173 | xargs kill` (ignore "no process"). Run `npx playwright test e2e/share-roundtrip.spec.ts e2e/share-states.spec.ts e2e/share-a11y.spec.ts`. Fix failures in the owning code (not by loosening assertions).
- [ ] **Step 2:** Write the docs + CLAUDE.md link.
- [ ] **Step 3: Full verification:** `npm run check`, `npm run lint`, `npm run test:unit`, `npm run test:e2e` (kill :4173 first), `npm run test:pipeline` (if its tools are installed; report if not). All green except pre-existing fixmes.
- [ ] **Step 4: Commit** `git commit -m "test(sharing): share roundtrip, states and a11y e2e; docs"`.
