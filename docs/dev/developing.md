# Developing

## Setup

```bash
nvm use                 # Node 24
npm install             # prepare: husky, `wrangler types --strict-vars=false`, `svelte-kit sync`
npx playwright install chromium   # needed by `npm run test:unit` (client project) and `test:e2e`; the one download beyond npm
echo 'PUBLIC_DATASET_VERSION=fixture-0' > .dev.vars   # dev-only override: serve the fixture, see below
npm run data:fixture
npm run db:migrate
npm run dev
```

- `wrangler types --strict-vars=false` makes `wrangler.jsonc` vars type as `string` (not string literals), so the dev-only `PUBLIC_DATASET_VERSION` override can be set. `worker-configuration.d.ts` is generated and gitignored; `npm run types` regenerates it.
- `.npmrc` sets `legacy-peer-deps=true` because the drizzle release candidates declare an optional `effect` peer. The lockfile pins `drizzle-orm` 1.0.0-rc.4-5d5b77c and `drizzle-kit` 1.0.0-rc.4-ca0f029 (the versions planafoot resolves) while `package.json` keeps caret ranges. Do not run a blind `npm update` on drizzle; bump both deliberately and re-run `npm run db:generate` to check.
- `@types/node` is a devDependency so the `scripts/*.ts` files (run with `tsx`) type-check.

## `.dev.vars`

`.dev.vars` is gitignored and read by the local worker (`wrangler dev` and `vite dev` via the adapter's platform proxy). `PUBLIC_DATASET_VERSION` there is a development-only override of the dataset version. It is honoured under `vite dev` and when `ENVIRONMENT=development`, and ignored when deployed (`resolveDatasetVersion`, `src/lib/server/config/dataset-version.ts`). Without it, dev serves the version the tree computes (`npm run pipeline -- version`), which is in local R2 only if you copy it (`npm run data:local -- <v>`). For day-to-day local dev on the fixture, create `.dev.vars` with:

```
PUBLIC_DATASET_VERSION=fixture-0
```

and run `npm run data:fixture`. Without the override and without the tree's dataset in local R2, the map's data loads 404; there is deliberately no code fallback. e2e builds set `PUBLIC_DATASET_VERSION=fixture-0` (with `ENVIRONMENT=development`) on the `wrangler dev` command line instead, so they do not depend on `.dev.vars`.

Sign-in also reads `.dev.vars`:

```
BETTER_AUTH_SECRET=<any long random string>
```

`BETTER_AUTH_SECRET` is required. `SES_FROM` must be set even with no mail provider; the `wrangler.jsonc` var covers local dev.

Magic link is on only while mail can be delivered (see [auth.md](auth.md)). With no provider in `.dev.vars`, `npm run dev` and `npm run preview` have no magic link: the header shows no `Sign in` to a signed-out visitor, and `/signin` offers only `Start fresh without an account`. Mail runs in log mode (from, recipient and subject only, never the link), so an emailed invite cannot be read either. To get sign-in back locally, add a provider: `SES_ACCESS_KEY_ID` and `SES_SECRET_ACCESS_KEY`, or `EMAIL_PROVIDER=resend` and `RESEND_API_KEY`. Real mail is then sent.

`AUTH_METHODS` (optional) overrides the `wrangler.jsonc` value, for example `AUTH_METHODS=magic-link,password` to try password sign-in. `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (with `google` in `AUTH_METHODS`) turn on Google sign-in. These are read through a typed cast of `platform.env`, so do not add them to generate types.

The e2e server ignores these for the settings the suite depends on: `playwright.config.ts` passes `AUTH_METHODS=magic-link`, empty `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY` and `RESEND_API_KEY`, the secret and the URL as `--var` flags, which override `.dev.vars`. So an e2e run sends no real mail even with provider keys in `.dev.vars`; it keeps magic link anyway, and its mail sink holds the links. Specs turn other methods on per browser context with `enableAuthMethods`.

## Local data

- `npm run data:fixture` loads `e2e/fixtures/data/fixture-0/` into local R2 under `data/fixture-0/`. Today this is a platform placeholder; the data-pipeline's `pipeline fixture` command will overwrite it under the same version name.
- `npm run data:local -- <version> [--from <origin>]` fetches `<origin>/data/<version>/manifest.json` (default origin `https://sfhousing.mindlace.net`), then every file the manifest names (including the scenario files, `gross.bin` and every glyph range of every font stack), and writes each into local R2. It skips (404) glyph ranges and sprite variants the source does not ship, and prints how many glyph ranges it skipped. Needs no credentials.
- `npm run data:transit [-- <version>]` adds live transit to the local dataset named in `.dev.vars` (or `<version>`). Run it after `data:local` of a dataset older than transit support, or to see current service. It fetches the Muni, BART and Caltrain GTFS feeds directly from the agencies, builds `transit.json` and rewrites the local manifest to name it. A sha256 mismatch with the committed `pipeline/sources.lock.json` is only a warning (the feed rolled over); the lock is never modified. It clips to the loaded dataset's `neighborhoods.geojson`, so on `fixture-0` it yields only a handful of stops: load a real dataset with `npm run data:local` first.

Both write to the Miniflare R2 state in `.wrangler/`; delete that directory to reset local state.

## The sim object

The per-sim Durable Object does not run under `npm run dev`. The stream route answers 503 under dev, but a websocket upgrade request does not reach it there: the connection gets no answer (observed; Vite's dev server likely handles upgrades itself). Use `npm run preview` (build, then `wrangler dev` on port 4173). Under dev the roster hook does nothing, a rename answers 503 (it needs the object), and the operator takedown route answers 503 before it writes anything, but only to a request with a valid token: without an at-least-32-character `SIM_TAKEDOWN_TOKEN` in `.dev.vars` it answers 404 first. `SIM_TAKEDOWN_TOKEN` is not needed locally except to try the takedown under `npm run preview` (put an at-least-32-character value of your own in `.dev.vars`). See [sim-object.md](sim-object.md) and [auth.md](auth.md).

## Migrations

1. Edit `src/lib/server/db/schema/` (the index re-exports tables).
2. `npm run db:generate` (generate → classify → flatten into `migrations/d1`).
3. `npm run db:migrate`.

The sim object has its own track: edit `src/lib/server/sim-object/schema.ts`, run `npm run db:generate:sim`, commit what it writes. Nothing to apply: each object migrates on open. Never delete `migrations/sim` or regenerate it from scratch. See [sim-object.md](sim-object.md).

Never hand-edit files in `migrations/`. CI applies migrations to remote D1 before each deploy.

## Signoff

`npm run signoff` runs the local gate with chreode: it merges `origin/main`, runs the checks the changes since the last signoff need (`chreode.config.ts`), pushes, and posts the `chreode/signoff` status that branch protection requires; `npm run signoff -- --dry-run` prints the plan without running it. See [deploy.md](deploy.md).

## Header actions

The header has a right-aligned slot pages can fill. The root layout calls `provideHeaderActions()` once; a page calls `useHeaderActions(snippet)` (both from `$lib/shell/header-actions.svelte`) during component init. The snippet is shown while the page is mounted and cleared on destroy. The snippet is registered during page init, so it is not present in SSR HTML: header actions appear after hydration. Below lg (1024 px) the two steps (Paint, Simulate: `nav` "Steps", an ordered list with visible numbers 1 and 2, hidden from lg to xl) and the actions move into the header's Menu.

On `/` the header has no Paint button: the page's dock (`DockState`, open from md, a closed sheet below md) folds by its own collapse button and opens again from the rail (the handle below md); the header score flips it to Results. The dock itself renders inside `BrushEditor` (`src/lib/brush/BrushEditor.svelte`): the shared Paint tab (`src/lib/paint/`), and the phone palette strip. `/` has no painted-areas list (that is `/sim`'s): no rows, lot counts, outlines or Remove. Paint comes off by Erase strokes over it or by Undo, stroke by stroke. Its tab, rail and Results-flip buttons are named so none is just "Paint" (the rail's "Paint tools", the flip's "Back to painting", or "Back to the Paint tab" on the read-only `/p/:id`, where nothing can be painted); the collapse button is "Collapse Paint". When the dock folds, focus goes to the rail's "Paint tools" button (md and up) or the sheet handle. What a stroke did ("6 stories on 42 lots", "Erased 42 lots", "No lots under that stroke", then " · 3 not eligible", " · 2 in the Bay", " · still loading" as they apply; `strokeMessage` in `src/lib/brush/messages.ts`), a refusal ("Plan too large to save. Undo some strokes.") and an undo or redo ("Undid paint, 6 stories") show in the stroke chip: a pill over the map's top, centred right of the dock, inside a polite status mounted empty. It never moves the map and takes no presses, so a stroke can start under it; while map-view's "Some parcels didn't load" chip shows it sits one row lower, clear of Retry. It clears after 4 s (6 s for a refusal), and a new message replaces it.

Undo and Redo on `/` follow the primary pointer (`usePrimaryPointer`, `src/lib/paint/pointer.svelte.ts`, the media query `(pointer: coarse)`, reactive: docking a keyboard swaps them live, and neither is rendered until the client has read it). A coarse one (a phone or tablet) has Undo and Redo buttons above the Paint tab; on a phone the strip over the map also has Undo, and Redo is in the open sheet. A fine one has Ctrl+Z and Ctrl+Shift+Z (the stroke chip says what they did; they do nothing in a text field or under a modal dialog) and the Keyboard shortcuts button (`ShortcutsButton`, visible \"Shortcuts\"), the last control in the Paint tab. A touch laptop whose main pointer is the trackpad counts as fine. `/sim` keeps its header Undo, Redo and Shortcuts and a strip without Undo.

On `/` and `/p/:id` the header score (`TimelineHeaderScore`, pinned, fed by `paintHeadline` in `src/lib/paint/headline.ts`) flips the dock to its Results face (`ScoreboardPanel`, the scoreboard) and back, as `/sim`'s does; the floating scoreboard card is gone. Line 1 is the capacity ("Room for 47,335 homes", compact from 1,000,000: "Room for 1.2M homes"); line 2 its share of the goal ("57% of the goal", "Goal reached" at or over it; hidden below sm), with the goal's name on hover and focus. It is undated and has no effect line or meter. `/p/:id` has the same dock on a read-only Paint tab: "Read-only. Remix to edit." and one summary line ("6 and 8 stories · 1,204 lots rebuilt", or "Nothing painted"), no tools.

`useHeaderActions(snippet, { pinned, status })` also fills two other slots. `pinned` is one item always in the header (the header score, on `/`, `/p/:id`, `/sim` and `/s/<id>`; the `/lesscars` headline). Below sm a page that pins an item has the site name in the Menu, so the bar keeps room for it. On `/sim` the pinned headline has two lines: line 1, the button, is the homes simulated from today to the playhead's month ("47,335 homes by Apr 2040"); line 2, its description, is "+N from your policy" and the share of the goal (only line 1 shows below sm). `status` is the page's one status cell on the left, after the steps from lg and after the site name below it, never in the Menu: the save state on `/` and `/sim` ("Saving…" or "Autosave off"; nothing visible when saved), and on `/sim` "Updating", with its explanation, covers the save state in the same cell while the numbers are stale. The latest page to register owns all three slots; its destroy clears them only if no later page has registered since.
