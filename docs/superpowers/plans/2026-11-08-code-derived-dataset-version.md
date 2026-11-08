# Code-derived Dataset Version Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task (execution method already decided). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app computes `datasetVersion` from its own source tree at build time, so every deploy ships the dataset its code was built for; `PUBLIC_DATASET_VERSION` survives only as a development override, and deploys and signoff refuse a tree whose dataset is not published.

**Architecture:** A Vite plugin calls the pipeline's existing `computeDatasetVersion` + `codeTreeHash` + `TOOL_VERSIONS` (through a new `treeDatasetVersion`) when the config loads and injects the result as the server-only `define` constant `__SFH_DATASET_VERSION__`. The root layout load resolves the version from that constant, or from the override when the environment is development. One shared checker (`pipeline/lib/dataset-check.ts`) answers "is `/data/<v>/manifest.json` served on this origin?" for the deploy workflows, the chreode `dataset` step and `npm run pipeline -- version --check`.

**Tech Stack:** SvelteKit 2 / Vite define, TypeScript run by `tsx`, Vitest (server and pipeline projects), GitHub Actions, chreode.

**Spec:** `docs/superpowers/specs/2026-11-08-code-derived-dataset-version-design.md`

## Global Constraints

- `computeDatasetVersion` (`pipeline/lib/version.ts:15`) stays the single source of truth for pipeline `build` and app build alike. There is no second implementation.
- The version reaches the client only as layout data (`datasetVersion`), never as a global. `__SFH_DATASET_VERSION__` is referenced only from `src/lib/server/**` and `src/routes/+layout.server.ts`.
- `PUBLIC_DATASET_VERSION` is honoured only in development (`npm run dev`, `npm run preview`, e2e) and ignored in deployed environments.
- `wrangler.jsonc` has no `PUBLIC_DATASET_VERSION` in `vars` or `env.staging.vars`.
- Nothing the app build imports may pull in pipeline-only dependencies (`@duckdb/node-api`, tippecanoe, pmtiles). Allowed import chain: `pipeline/lib/version.ts` → `exec.ts`, `lock.ts`, `src/lib/data/dataset-version.ts`; `pipeline/config.ts` → `src/lib/generator/constants.ts`, `pipeline/sb79-config.ts` (type-only imports beyond that; checked at `pipeline/config.ts:1-2`, `pipeline/sb79-config.ts:22-23`).
- The deploy guard fails before `wrangler deploy` when the manifest is missing; the running version stays up. No R2 credentials in CI.
- `release-please.yml` is unchanged.
- Vitest runs with `expect.requireAssertions`: every test calls `expect`.
- Every `docs/dev/*.md` stays linked from `CLAUDE.md` (`scripts/docs-index.spec.ts`).
- Conventional Commits, no Claude attribution of any kind in commits, PRs or files.
- Never compound `cd … && cmd`; run from the worktree root.

## Review Focus

1. **A stray `PUBLIC_DATASET_VERSION` in a deployed environment** (someone adds `--var` to a workflow, or a dashboard var): the site keeps serving the built version, it does not 500 and does not switch datasets. Pinned in Task 3 (`ignores the override outside development`).
2. **A dirty tree on a local `npm run build`, `npm run preview` or e2e:** the build still succeeds (it bakes a version that does not exist), and preview/e2e still serve `fixture-0` through the override. Pinned in Task 1 (`treeDatasetVersion succeeds on a dirty tree and differs from the clean one`) and Task 3 (e2e run).
3. **Staging unreachable or 5xx while checking:** the check reports "unreachable" and fails, without printing the build/upload recipe (which would send someone on an 8-minute detour for a network blip); only a 404 means "not published". A 404 cached for 60 s (`docs/dev/data-serving.md:21`) must not mask a fresh upload. Pinned in Task 2 (`datasetServed` tests incl. cache-buster).
4. **The guarded version differs from the version baked into the build** (something dirties the checkout between the guard and `npm run build`, or the define is not applied in SSR): the deploy notices. Pinned in Task 2 (`--check` refuses a dirty tree) and Task 5 (post-deploy smoke greps `/about` HTML for `<v>`); Task 3 checks the constant is absent from the client bundle.
5. **A malformed override in development** (`.dev.vars` typo): a 500 that names `PUBLIC_DATASET_VERSION`, not a silent fall-back to the built version. Pinned in Task 3 (`throws 500 on a malformed override in development`).

---

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `pipeline/lib/version.ts` | modify | add `treeDatasetVersion`, `codePathsDirty` |
| `pipeline/config.ts` | modify | gains `STAGING_ORIGIN`, `PRODUCTION_ORIGIN` (import-light home) |
| `pipeline/steps/upload.ts` | modify | import `STAGING_ORIGIN` from config; drop the `"PUBLIC_DATASET_VERSION": …` hint |
| `pipeline/lib/dataset-check.ts` | create | `manifestUrl`, `datasetServed`, `missingDatasetHelp`, `versionCommand` |
| `pipeline/cli.ts` | modify | `version [--check [<origin>]]` command; upload help text |
| `pipeline/test/version.test.ts` | modify | tests for the two new version functions |
| `pipeline/test/dataset-check.test.ts` | create | tests for the checker |
| `scripts/dataset-version.ts` | rewrite | light CI/chreode entry: `[--check [<origin>]]` → `versionCommand` |
| `scripts/dataset-version.spec.ts` | rewrite | arg parsing; the `/sim` minimum-dataset test moved here |
| `scripts/lib/dataset-version-plugin.ts` | create | Vite plugin injecting `__SFH_DATASET_VERSION__` |
| `vite.config.ts` | modify | register the plugin |
| `src/app.d.ts` | modify | `declare const __SFH_DATASET_VERSION__: string` |
| `src/lib/server/config/dataset-version.ts` (+spec) | modify | `resolveDatasetVersion`, `devOverride`; messages no longer mention `wrangler.jsonc` |
| `src/routes/+layout.server.ts` (+`layout.server.spec.ts`) | modify | use `resolveDatasetVersion` |
| `src/routes/attribution/page.server.spec.ts` | modify | drop the now-meaningless `PUBLIC_DATASET_VERSION` env key |
| `src/lib/brush/BrushEditor.svelte:61` | modify | doc comment: "layout `datasetVersion`" |
| `wrangler.jsonc`, `scripts/wrangler-config.spec.ts`, `scripts/lib/wrangler-config.ts` | modify | var removed; spec requires absence |
| `.github/workflows/deploy-staging.yml`, `deploy-prod.yml` | modify | guard before build; smoke uses guarded `<v>` |
| `chreode.config.ts` | modify | `dataset` step and rules |
| `docs/dev/{deploy,pipeline,developing,testing,sim-page}.md`, `CLAUDE.md`, `README.md` | modify | docs per spec §5 |

Untouched on purpose: `pipeline/steps/build.ts:170-180` (already calls `computeDatasetVersion`; it takes `opts.lockPath`, which may be a fixture lock, so it does not switch to `treeDatasetVersion`), `scripts/data-transit.ts` / `scripts/lib/data-transit-helpers.ts` (still read the `.dev.vars` override, which keeps its meaning), `playwright.config.ts:44` (already passes `--var ENVIRONMENT:development --var PUBLIC_DATASET_VERSION:fixture-0`), `package.json` `preview` (already passes `ENVIRONMENT:development`; `.dev.vars` supplies the override).

## Decisions the spec left to the builder

- **Injection: Vite `define` of `__SFH_DATASET_VERSION__`, set by a plugin's `config` hook** (builder's call: one string, no generated file to keep in sync or gitignore, `svelte-check` needs only an ambient `declare const`, and `define` only lands where referenced, which is server-only code).
- **Repo root for the plugin: `userConfig.root ?? process.cwd()`** (builder's call: Vite bundles the config file, so `import.meta.url` is not a reliable anchor).
- **Pipeline deps stay out:** the plugin imports only `pipeline/lib/version.ts` (`treeDatasetVersion`), whose chain is listed in Global Constraints (builder's call: the existing modules are already light; no refactor needed).
- **Dev override rule: honoured when `dev` (`$app/environment`, i.e. `vite dev`) or `platform.env.ENVIRONMENT === 'development'` (preview, e2e); ignored otherwise** (builder's call: under `vite dev` the platform proxy reports `ENVIRONMENT=production` from `wrangler.jsonc:25` unless `.dev.vars` sets it, and ignoring rather than refusing means a stray var cannot 500 production; the wrangler-config spec guards the config).
- **Override read through `devOverride(env: unknown)`** (builder's call: once the var leaves `wrangler.jsonc`, `wrangler types` no longer puts it on `Env`, and augmenting `Env` would clash when a local `.dev.vars` makes wrangler emit it).
- **Shallow clone: keep `actions/checkout`'s default depth 1** (builder's call: `git ls-tree -r HEAD`, `git status` and `git diff HEAD` need only HEAD's tree).
- **Dirty tree in CI and signoff: `--check` refuses when `codePathsDirty` is true, naming the paths; plain `version` and the build only compute** (builder's call: a dirty CI checkout means something wrote into the code-hash paths, which is a bug to surface, while local builds must keep working dirty).
- **Origin constants move to `pipeline/config.ts`** (builder's call: `upload.ts` imports zod/R2 helpers; `config.ts` is import-light and already holds `R2_BUCKET`).
- **Checker: `HEAD <origin>/data/<v>/manifest.json?check=<ms>`; 200 = served, 404 = missing (no retry), anything else = retry 3 times 5 s apart, then unreachable** (builder's call: the query defeats the 60 s cached 404; only a 404 should trigger the build/upload advice).
- **chreode: `dataset` is the first step; a new rule for `pipeline/**`** (builder's call: one HTTP request should fail before 15 minutes of e2e).
- **The `/sim` minimum-dataset test moves to `scripts/dataset-version.spec.ts`, checking `treeDatasetVersion(root)`'s date** (builder's call: the date comes from the lock, which is what the old wrangler test was approximating).
- **Prod guard checks the production host; staging guard checks the staging host** (spec: "the currently deployed host"; both serve any version).

---

### Task 1: Tree version and dirtiness helpers

**Files:**
- Modify: `pipeline/lib/version.ts` (after `codeTreeHash`, `:68-97`)
- Modify: `pipeline/config.ts` (next to `R2_BUCKET`, `:76`)
- Modify: `pipeline/steps/upload.ts:17,210-211`
- Test: `pipeline/test/version.test.ts`

**Interfaces:**
- Consumes: `computeDatasetVersion`, `codeTreeHash` (`pipeline/lib/version.ts:15,77`), `readLock` (`pipeline/lib/lock.ts`), `TOOL_VERSIONS` (`pipeline/config.ts:6`).
- Produces:
  - `export async function treeDatasetVersion(repoRoot: string): Promise<string>` — reads `<repoRoot>/pipeline/sources.lock.json`; throws `Error('no pipeline/sources.lock.json under <root>')` when missing.
  - `export async function codePathsDirty(repoRoot: string): Promise<string[]>` — the `git status --porcelain` lines for `PATHS` + `EXCLUDES` (empty = clean). `codeTreeHash` uses it internally instead of its own status call.
  - `export const STAGING_ORIGIN = 'https://sfhousing-staging.mindlace.net'` and `export const PRODUCTION_ORIGIN = 'https://sfhousing.mindlace.net'` in `pipeline/config.ts`.

- [ ] **Step 1: Write the failing tests** in `pipeline/test/version.test.ts`, reusing `tempRepo()` and `lock()`. Add a `writeLock(dir)` helper that writes `JSON.stringify(lock())` to `pipeline/sources.lock.json` (untracked is fine: the lock is excluded from the code hash).

```ts
describe('treeDatasetVersion', () => {
  it('equals computeDatasetVersion over the repo lock, code hash and TOOL_VERSIONS', async () => {
    const { dir } = tempRepo(); writeLock(dir);
    expect(await treeDatasetVersion(dir)).toBe(
      computeDatasetVersion({ lock: lock(), codeHash: await codeTreeHash(dir), toolVersions: TOOL_VERSIONS })
    );
    expect(await treeDatasetVersion(dir)).toMatch(/^2026-10-10-[0-9a-f]{8}$/);
  });
  it('succeeds on a dirty tree and differs from the clean one', async () => {
    const { dir } = tempRepo(); writeLock(dir);
    const clean = await treeDatasetVersion(dir);
    writeFileSync(join(dir, 'pipeline/a.ts'), 'export const a = 2;\n');
    const dirty = await treeDatasetVersion(dir);
    expect(dirty).toMatch(DATASET_VERSION_RE);
    expect(dirty).not.toBe(clean);
  });
  it('throws naming the lock when it is missing', async () => {
    const { dir } = tempRepo();
    await expect(treeDatasetVersion(dir)).rejects.toThrow(/sources\.lock\.json/);
  });
});
describe('codePathsDirty', () => {
  it('is empty for a clean tree, an untracked lock, and changes outside the code paths', async () => {
    const { dir } = tempRepo(); writeLock(dir);
    writeFileSync(join(dir, 'README.md'), 'x\n');
    expect(await codePathsDirty(dir)).toEqual([]);
  });
  it('lists a modified code file and an untracked one', async () => {
    const { dir } = tempRepo();
    writeFileSync(join(dir, 'pipeline/a.ts'), 'export const a = 2;\n');
    writeFileSync(join(dir, 'src/lib/data/new.ts'), 'export {};\n');
    const lines = await codePathsDirty(dir);
    expect(lines.some((l) => l.endsWith('pipeline/a.ts'))).toBe(true);
    expect(lines.some((l) => l.endsWith('src/lib/data/new.ts'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest --run --project pipeline pipeline/test/version.test.ts`
Expected: FAIL, `treeDatasetVersion` / `codePathsDirty` not exported.

- [ ] **Step 3: Implement** `treeDatasetVersion` and `codePathsDirty` in `pipeline/lib/version.ts`; refactor `codeTreeHash` to call `codePathsDirty` (behaviour unchanged). Add the two origin constants to `pipeline/config.ts`; in `upload.ts` import `STAGING_ORIGIN` from `../config` and keep `export { STAGING_ORIGIN }` only if a grep finds other importers (`rg -n STAGING_ORIGIN`). Replace the `log(\`"PUBLIC_DATASET_VERSION": "${v}"\`)` line (`upload.ts:210`) with `log('next: npm run signoff (the dataset step checks staging serves this version)')`, keeping the `verify` hint line.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest --run --project pipeline pipeline/test/version.test.ts pipeline/test/upload.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pipeline/lib/version.ts pipeline/config.ts pipeline/steps/upload.ts pipeline/test/version.test.ts
git commit -m "feat(pipeline): treeDatasetVersion and codePathsDirty"
```

### Task 2: Served check, `pipeline version`, and the CI entry script

**Files:**
- Create: `pipeline/lib/dataset-check.ts`
- Create: `pipeline/test/dataset-check.test.ts`
- Modify: `pipeline/cli.ts` (`steps` map `:89`; `upload.help` `:155`)
- Rewrite: `scripts/dataset-version.ts`, `scripts/dataset-version.spec.ts`

**Interfaces:**
- Consumes: Task 1's `treeDatasetVersion`, `codePathsDirty`, `STAGING_ORIGIN`.
- Produces (in `pipeline/lib/dataset-check.ts`):
  - `export function manifestUrl(origin: string, v: string, now?: number): string` → `${origin without trailing /}/data/${v}/manifest.json?check=${now}` (`now` defaults to `Date.now()`).
  - `export type Served = 'served' | 'missing' | 'unreachable'`
  - `export async function datasetServed(v: string, origin: string, opts?: { fetch?: typeof fetch; attempts?: number; delayMs?: number }): Promise<Served>` — `HEAD`; defaults `attempts: 3`, `delayMs: 5000`.
  - `export function missingDatasetHelp(v: string, origin: string): string` — multi-line text naming, in order: `npm run pipeline -- build`, `npm run pipeline -- upload <v>`, `npm run pipeline -- verify <v> --origin <origin>`, then "re-run npm run signoff"; and a line pointing at `docs/dev/pipeline.md` "Finishing a branch that changes the dataset".
  - `export async function versionCommand(a: { repoRoot: string; check?: string; fetch?: typeof fetch; delayMs?: number; out: (s: string) => void; err: (s: string) => void }): Promise<number>` — always `out(v)`; without `check` returns 0 (and `err`s a one-line note if `codePathsDirty` is non-empty: "uncommitted changes under the code-hash paths; the committed tree computes a different version"). With `check`: dirty → `err` the dirty lines, return 1; `served` → 0; `missing` → `err(missingDatasetHelp(v, check))`, 1; `unreachable` → `err("could not reach <origin> to check <v>")`, 1.
- Produces (in `scripts/dataset-version.ts`): `export function parseVersionArgs(argv: string[]): { check?: string } | { usage: string }` — `[]` → `{}`; `['--check']` → `{ check: STAGING_ORIGIN }`; `['--check', 'https://x']` → `{ check: 'https://x' }`; anything else → `{ usage }`. `main` runs `versionCommand` with `repoRoot` = repo root (`fileURLToPath(new URL('..', import.meta.url))`), exits with its code (2 on usage).
- CLI: `npm run pipeline -- version [--check [<origin>]]`; help `'print the datasetVersion this tree computes [--check [<origin>]: fail unless <origin> serves it]'`. `--check` given as a bare flag means `STAGING_ORIGIN` (`parseArgs` yields `true`).

- [ ] **Step 1: Write the failing tests**

`pipeline/test/dataset-check.test.ts` (fake `fetch` returning `new Response(null, { status })` and recording calls; `delayMs: 0`):

```ts
it('manifestUrl adds a cache-busting query and tolerates a trailing slash', () => {
  expect(manifestUrl('https://h/', '2026-10-10-3fa9c2d1', 5)).toBe('https://h/data/2026-10-10-3fa9c2d1/manifest.json?check=5');
});
it('200 is served, with one HEAD request', async () => {
  expect(await datasetServed(V, O, { fetch: f([200]), delayMs: 0 })).toBe('served');
  expect(calls).toEqual([{ method: 'HEAD' }]);
});
it('404 is missing without retrying', async () => { /* f([404]) → 'missing', calls.length 1 */ });
it('5xx then 200 retries and is served', async () => { /* f([503, 200]) → 'served', calls.length 2 */ });
it('network errors on every attempt are unreachable', async () => { /* throwing fetch, attempts 3 → 'unreachable', 3 calls */ });
it('missingDatasetHelp names build, upload <v> and verify <v> --origin <origin> in order', () => {
  const t = missingDatasetHelp(V, O);
  expect(t.indexOf('pipeline -- build')).toBeLessThan(t.indexOf(`upload ${V}`));
  expect(t.indexOf(`upload ${V}`)).toBeLessThan(t.indexOf(`verify ${V} --origin ${O}`));
});
```

`versionCommand` tests use a `tempRepo()` + lock like Task 1 (extract both helpers to `pipeline/test/helpers/temp-repo.ts` and import them from both test files):

```ts
it('prints the version and returns 0 without --check', ...)          // out === [treeDatasetVersion(dir)], code 0
it('--check returns 0 when served', ...)                               // fetch 200
it('--check prints the recipe and returns 1 when missing', ...)        // fetch 404; err joined contains `upload ${v}`
it('--check returns 1 on a dirty tree without requesting', ...)        // modify pipeline/a.ts; fetch calls 0; err contains 'pipeline/a.ts'
it('--check reports unreachable without the recipe', ...)              // fetch throws; err contains 'could not reach', not 'upload'
```

`scripts/dataset-version.spec.ts` (replace the old `datasetVersionFor` tests):

```ts
it.each([[[], {}], [['--check'], { check: STAGING_ORIGIN }], [['--check', 'https://x'], { check: 'https://x' }]])(
  'parses %j', (argv, want) => expect(parseVersionArgs(argv)).toEqual(want));
it('rejects unknown arguments', () => expect(parseVersionArgs(['staging'])).toHaveProperty('usage'));
// Moved from scripts/wrangler-config.spec.ts. Versions are date-prefixed, so the date orders them.
const MIN_SIM_DATASET = '2026-10-29-0fd62c4d';
it('this tree computes a dataset /sim can run', async () => {
  const v = await treeDatasetVersion(root);
  expect(v.slice(0, 10) >= MIN_SIM_DATASET.slice(0, 10)).toBe(true);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest --run --project pipeline pipeline/test/dataset-check.test.ts` and `npx vitest --run --project server scripts/dataset-version.spec.ts`
Expected: FAIL, modules/exports missing.

- [ ] **Step 3: Implement** `pipeline/lib/dataset-check.ts`, the `version` step in `pipeline/cli.ts` (calls `versionCommand` with `repoRoot: ROOT`, `check: args.flags.check === true ? STAGING_ORIGIN : str(args.flags.check)`, `out: console.log`, `err: console.error`), and rewrite `scripts/dataset-version.ts` (keep the `import.meta.url === pathToFileURL(process.argv[1]).href` main guard at `:22-23`). Change `upload.help` (`cli.ts:155`) to `'publish out/<v>/ to R2, manifest last [--local]'`.

- [ ] **Step 4: Run to verify they pass**, plus the live commands

Run: the two vitest commands above → PASS.
Run: `npm run pipeline -- version` → prints one `YYYY-MM-DD-<8 hex>` line, exit 0.
Run: `npx tsx scripts/dataset-version.ts --check` → exits 1 and prints the recipe (this branch's version is not uploaded yet; that is expected until Task 7).

- [ ] **Step 5: Commit**

```bash
git add pipeline/lib/dataset-check.ts pipeline/test/dataset-check.test.ts pipeline/test/helpers/temp-repo.ts pipeline/test/version.test.ts pipeline/cli.ts scripts/dataset-version.ts scripts/dataset-version.spec.ts
git commit -m "feat(pipeline): version command and published-dataset check"
```

### Task 3: The app bakes in the tree's version

**Files:**
- Create: `scripts/lib/dataset-version-plugin.ts`
- Modify: `vite.config.ts:31` (plugins), `src/app.d.ts`
- Modify: `src/lib/server/config/dataset-version.ts`, `src/lib/server/config/dataset-version.spec.ts`
- Modify: `src/routes/+layout.server.ts`, `src/routes/layout.server.spec.ts`
- Modify: `src/routes/attribution/page.server.spec.ts:17`, `src/lib/brush/BrushEditor.svelte:61-62`

**Interfaces:**
- Consumes: Task 1's `treeDatasetVersion(repoRoot)`.
- Produces:
  - `export function datasetVersionPlugin(): Plugin` (Vite) — `name: 'sfh-dataset-version'`; async `config(userConfig, { command })` computes `treeDatasetVersion(userConfig.root ?? process.cwd())` and returns `{ define: { __SFH_DATASET_VERSION__: JSON.stringify(v) } }`; on `command === 'build'` logs `dataset version <v>`. Errors propagate (no git, no lock → the build fails loudly).
  - `src/app.d.ts`: inside `declare global`, `const __SFH_DATASET_VERSION__: string;` with a one-line comment naming the plugin.
  - `export function requireDatasetVersion(value: string | undefined, name?: string): string` — `name` defaults to `'PUBLIC_DATASET_VERSION'`; messages become `${name} is not set; refusing to fall back to a default dataset` and `${name} "<shown>" does not match …` (no mention of `wrangler.jsonc`).
  - `export function devOverride(env: unknown): string | undefined` — `env.PUBLIC_DATASET_VERSION` when `env` is an object and the value is a string, else `undefined`.
  - `export function resolveDatasetVersion(a: { built: string; override: string | undefined; development: boolean }): string` — `development && override` non-empty → `requireDatasetVersion(override)`; otherwise `requireDatasetVersion(built, 'built dataset version')`.
  - Layout: `datasetVersion: resolveDatasetVersion({ built: __SFH_DATASET_VERSION__, override: devOverride(platform?.env) ?? publicEnv.PUBLIC_DATASET_VERSION, development: dev || platform?.env?.ENVIRONMENT === 'development' })` with `dev` from `$app/environment`. `appRelease` unchanged.

- [ ] **Step 1: Write the failing tests**

`dataset-version.spec.ts` (keep the existing `requireDatasetVersion` cases; they still pass with the default name):

```ts
describe('resolveDatasetVersion', () => {
  const built = '2026-10-10-3fa9c2d1';
  it('serves the built version outside development, ignoring the override', () =>
    expect(resolveDatasetVersion({ built, override: 'fixture-0', development: false })).toBe(built));
  it('honours the override in development', () =>
    expect(resolveDatasetVersion({ built, override: 'fixture-0', development: true })).toBe('fixture-0'));
  it('falls back to the built version in development without an override', () =>
    expect(resolveDatasetVersion({ built, override: '', development: true })).toBe(built));
  it('throws 500 naming PUBLIC_DATASET_VERSION on a malformed override in development', ...);  // status 500, message contains 'PUBLIC_DATASET_VERSION'
  it('throws 500 naming the built version when it is malformed', ...);                          // built 'bogus', development false; message contains 'built dataset version'
});
describe('devOverride', () => {
  it.each([[undefined, undefined], [{}, undefined], [{ PUBLIC_DATASET_VERSION: 7 }, undefined], [{ PUBLIC_DATASET_VERSION: 'fixture-0' }, 'fixture-0']])(
    'reads %j', (env, want) => expect(devOverride(env)).toBe(want));
});
```

`layout.server.spec.ts` (add `vi.mock('$app/environment', () => ({ dev: false }))`; `__SFH_DATASET_VERSION__` is defined by the plugin in the server project, which extends `vite.config.ts`):

```ts
it('serves the built version', ...)                                   // load({}) → { datasetVersion: __SFH_DATASET_VERSION__, appRelease: 'dev' }; and it matches DATASET_VERSION_RE
it('ignores the override outside development', ...)                   // env { ENVIRONMENT: 'production', PUBLIC_DATASET_VERSION: 'fixture-0' } → built
it('honours the override when ENVIRONMENT is development', ...)       // env { ENVIRONMENT: 'development', PUBLIC_DATASET_VERSION: 'fixture-0' } → 'fixture-0'
it('throws 500 on a malformed override in development', ...)          // env { ENVIRONMENT: 'development', PUBLIC_DATASET_VERSION: 'bogus' } → 500
```

Delete the old `throws 500 when no dataset version is configured` case (there is always a built version now).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest --run --project server src/lib/server/config/dataset-version.spec.ts src/routes/layout.server.spec.ts`
Expected: FAIL (`resolveDatasetVersion` missing; `__SFH_DATASET_VERSION__` is not defined).

- [ ] **Step 3: Implement** the plugin, register it in `vite.config.ts` as `plugins: [datasetVersionPlugin(), tailwindcss(), sveltekit()]`, the ambient declaration, the server functions and the layout change. Remove `PUBLIC_DATASET_VERSION: 'fixture-0'` from `attribution/page.server.spec.ts:17` (the page reads `parent().datasetVersion`). Reword the `BrushEditor.svelte` comment to "The layout's `datasetVersion`."

- [ ] **Step 4: Run to verify they pass**, then the checks

Run: the vitest command above → PASS.
Run: `npm run check` → 0 errors.
Run: `npm run build` → log contains `dataset version <v>` equal to `npm run pipeline -- version`.
Run: `rg -l "<v>" .svelte-kit/output/client` (substitute the printed `<v>`) → no matches (the constant stays out of the client bundle).
Run: `npm run test:unit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/dataset-version-plugin.ts vite.config.ts src/app.d.ts src/lib/server/config src/routes/+layout.server.ts src/routes/layout.server.spec.ts src/routes/attribution/page.server.spec.ts src/lib/brush/BrushEditor.svelte
git commit -m "feat: bake the tree's dataset version into the build"
```

### Task 4: Drop the var from `wrangler.jsonc`

**Files:**
- Modify: `wrangler.jsonc:24-29,53-58`
- Modify: `scripts/wrangler-config.spec.ts`, `scripts/lib/wrangler-config.ts:1-2`

**Interfaces:**
- Consumes: nothing new.
- Produces: `export type WranglerConfig = { vars: Record<string, string>; env: { staging: { vars: Record<string, string> } } }` (replacing `Vars`; `rg -n "WranglerConfig|Vars\b" scripts` to update any remaining importer).

- [ ] **Step 1: Write the failing test** — replace the `wrangler.jsonc PUBLIC_DATASET_VERSION` describe block (and the now-unused `REAL_DATASET_VERSION_RE` describe, `MIN_SIM_DATASET`, `DATASET_VERSION_RE` import) with:

```ts
describe('wrangler.jsonc', () => {
  const config = parseJsonc(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  it('sets no PUBLIC_DATASET_VERSION for production (the build computes it)', () =>
    expect(config.vars).not.toHaveProperty('PUBLIC_DATASET_VERSION'));
  it('sets no PUBLIC_DATASET_VERSION for staging', () =>
    expect(config.env.staging.vars).not.toHaveProperty('PUBLIC_DATASET_VERSION'));
});
```

Keep the `parseJsonc` unterminated-string test.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest --run --project server scripts/wrangler-config.spec.ts`
Expected: FAIL on both new cases.

- [ ] **Step 3: Remove** both `PUBLIC_DATASET_VERSION` entries and their `// bumped by the data-pipeline upload PR` comments. If `git merge origin/main` conflicts on these lines (main bumped production to `2026-11-08-3b7fa918` in #72), resolve by deleting them. Update the type. Run `npm run types` so `worker-configuration.d.ts` drops the var.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest --run --project server scripts/wrangler-config.spec.ts` → PASS.
Run: `npm run check` → 0 errors (proves nothing still reads the var off `Env`).

- [ ] **Step 5: Commit**

```bash
git add wrangler.jsonc scripts/wrangler-config.spec.ts scripts/lib/wrangler-config.ts
git commit -m "feat: drop PUBLIC_DATASET_VERSION from wrangler.jsonc"
```

### Task 5: Deploy guard and the chreode `dataset` step

**Files:**
- Modify: `.github/workflows/deploy-staging.yml`, `.github/workflows/deploy-prod.yml`
- Modify: `chreode.config.ts`

**Interfaces:**
- Consumes: `npx tsx scripts/dataset-version.ts --check <origin>` (Task 2): prints `<v>` on stdout, exit 0 only when served.

- [ ] **Step 1: Add the guard** to both workflows, after `npm ci` and before `npm run build`:

```yaml
- name: 'Guard: this commit''s dataset is published'
  id: dataset
  run: |
    V="$(npx tsx scripts/dataset-version.ts --check https://sfhousing-staging.mindlace.net)"
    echo "v=${V}" >> "$GITHUB_OUTPUT"
```

(production uses `https://sfhousing.mindlace.net`). The assignment on its own line matters: under the runner's `bash -e`, `V="$(…)"` fails the step, while `echo "v=$(…)"` would not. Leave `actions/checkout` at its default depth.

- [ ] **Step 2: Rewrite the smoke step** in both workflows to use `${{ steps.dataset.outputs.v }}` instead of `scripts/dataset-version.ts <env>`, keep the `curl -fsS -o /dev/null -I --retry …` manifest check, and add a second check that the deployed build serves that version: `curl -fsS --retry 5 --retry-delay 10 --retry-all-errors "https://<host>/about" | grep -qF "${V}"`.

- [ ] **Step 3: chreode** — add the step first in `steps`:

```ts
{ label: 'dataset', run: 'npx tsx scripts/dataset-version.ts --check', when: ['dataset'] },
```

Add `'dataset'` to the triggers of the code-hash rule (`chreode.config.ts:15-28`). Add, directly after it, `{ match: ['pipeline/**'], triggers: ['lint', 'check', 'unit', 'e2e', 'pipeline', 'dataset'] }` with a comment: the pipeline and the lock feed `codeTreeHash`/the version, so a change needs its dataset published on staging (docs/dev/pipeline.md). Update the trailing "Everything else" comment to drop `pipeline/`. Update the rule comment at `:14` to say the code hash is now load-bearing for deploys.

- [ ] **Step 4: Verify**

Run: `npm run lint:workflows` → no findings.
Run: `npx prettier --check chreode.config.ts .github/workflows` → clean.
Run: `npm run signoff -- --dry-run` → the plan lists `dataset` first and includes it (this branch touches `pipeline/**`).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/deploy-staging.yml .github/workflows/deploy-prod.yml chreode.config.ts
git commit -m "ci: refuse to deploy or sign off a tree whose dataset is unpublished"
```

### Task 6: Docs

**Files:**
- Modify: `docs/dev/deploy.md` (`## Promoting a datasetVersion`, `:31-39`; bootstrap item `:56` stays as history)
- Modify: `docs/dev/pipeline.md` (`## Release run order` `:37-44`, `## Commands` table, `## Lock and datasetVersion` `:66-68`, `## Partner actions` item 4 `:386`)
- Modify: `docs/dev/developing.md` (Setup comment `:9`, `:15`, `## .dev.vars` `:19-27`)
- Modify: `docs/dev/testing.md:35`, `docs/dev/sim-page.md:132`
- Modify: `CLAUDE.md` (Setup `:15`, Architecture `:79`, Conventions), `README.md:13`

- [ ] **Step 1: deploy.md** — replace "Promoting a datasetVersion" with "## Datasets ship with their code": the build computes `<v>` from the tree; each deploy workflow's guard checks `/data/<v>/manifest.json` before building and fails without deploying; the smoke step re-checks the manifest and that `/about` serves `<v>`; a release tag's tree computes its own version, so cutting a release is what moves prod; rollback is a code revert (the reverted tree computes the old version, still in R2); versions immutable, retained forever; no `chore(data)`/`data:` pointer PRs any more.
- [ ] **Step 2: pipeline.md** — rewrite "Release run order" as "Finishing a branch that changes the dataset" (keep a `## Release run order` heading or anchor only if something links it: `rg -n "release-run-order|promoting-a-datasetversion" docs CLAUDE.md README.md` and fix every hit). Content: how to tell (`npm run pipeline -- version`; `npx tsx scripts/dataset-version.ts --check` exits 1), refreshing sources (`fetch`, commit the lock) as an optional step 0, then spec §4 steps 1-7 verbatim in substance, including the loop back to build when signoff's merge changes `<v>`, the cache/tippecanoe/pmtiles prerequisite and `fetch --restore` in a fresh worktree. Add `version [--check [<origin>]]` to the Commands table. In "Lock and datasetVersion", add: the code-hash paths now decide what deploys serve, so any change under them needs a build and upload before merge (spec "Costs"). Partner action 4 becomes "nothing to bump; see Finishing a branch…".
- [ ] **Step 3: developing.md, testing.md, sim-page.md, README.md** — `.dev.vars`'s `PUBLIC_DATASET_VERSION` is a development-only override (honoured under `vite dev` and when `ENVIRONMENT=development`, ignored when deployed); without it, dev serves the tree's computed version, which is in local R2 only via `npm run data:local -- <v>`. testing.md: the `webServer` command as in `playwright.config.ts:44`. sim-page.md: the minimum-dataset test now lives in `scripts/dataset-version.spec.ts` and checks the tree's computed version.
- [ ] **Step 4: CLAUDE.md** — Setup comment: "dev override; the build computes the real dataset version". Architecture: replace the `PUBLIC_DATASET_VERSION` sentence with "The build computes the dataset version from the source tree (`treeDatasetVersion`, injected as `__SFH_DATASET_VERSION__`); `PUBLIC_DATASET_VERSION` is a development-only override. The version reaches the client as data from the root layout load, never as a global." Conventions: add "A branch that changes the dataset version uploads its dataset before signoff: see [docs/dev/pipeline.md](docs/dev/pipeline.md) (Finishing a branch that changes the dataset)." Add `version` to the `npm run pipeline` row of the Commands table.
- [ ] **Step 5: Verify**

Run: `rg -n "PUBLIC_DATASET_VERSION" CLAUDE.md README.md docs/dev` → every hit describes the dev override (or `--var` use in a local bench), none says it lives in `wrangler.jsonc` or gets bumped.
Run: `npx vitest --run --project server scripts/docs-index.spec.ts` → PASS.
Run: `npx vitest --run --project pipeline pipeline/test/quality.test.ts` → PASS (the generated Data quality section in pipeline.md is untouched).
Run: `npx prettier --check CLAUDE.md README.md docs/dev` → clean.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md README.md docs/dev
git commit -m "docs: datasets ship with their code"
```

### Task 7: Publish this branch's dataset and sign off

This branch edits `pipeline/**` (Tasks 1-2), so it changes `<v>` itself: it is the first branch to go through spec §4. Run by the controller after the whole-branch review, not by a task implementer. Needs `pipeline/.cache` (or `fetch --restore`), tippecanoe, pmtiles and R2 credentials (`wrangler login`).

- [ ] **Step 1:** `git merge origin/main` (resolve `wrangler.jsonc` per Task 4 Step 3).
- [ ] **Step 2:** `npm run pipeline -- version` → note `<v>`.
- [ ] **Step 3:** `npm run pipeline -- build` → every invariant OK; `wrote …/pipeline/out/<v>`.
- [ ] **Step 4:** `npm run pipeline -- upload <v>` → `published … under data/<v>/`.
- [ ] **Step 5:** `npm run pipeline -- verify <v> --origin https://sfhousing-staging.mindlace.net` → `OK   <v> verified`.
- [ ] **Step 6:** `npm run signoff` → `dataset` passes, all steps green. If `origin/main` moved and `dataset` fails, return to Step 2.
- [ ] **Step 7:** Open the PR and squash-merge it; watch `deploy-staging.yml` pass the guard and both smoke checks. Then remove the worktree.

## Open questions

1. **Who runs Task 7?** It needs the source cache, tippecanoe/pmtiles and R2 write credentials. Recommendation: the controller runs it on the owner's machine (as `bench:map` is run locally); if credentials are missing it stops and hands the owner the exact commands from Steps 2-6.
2. **Unmatched paths now run `dataset` too.** A change to `package.json` or a root config matches no chreode rule and runs every step, so it needs network access to staging and a published dataset for the merged tree. Recommendation: accept (the version is unchanged from `main`, so it is already served; one HEAD request).
3. **Prod deploy right after this merges:** the next release tag computes this branch's new `<v>`; Task 7 uploads it, so prod is covered. Recommendation: none needed, but do not cut a release from a commit before Task 7's upload lands.
