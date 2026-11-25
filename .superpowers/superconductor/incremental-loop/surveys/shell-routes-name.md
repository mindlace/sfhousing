# Survey: shell, routes and the site name

Read-only survey of the worktree `/Users/mindlace/Projects/sfhousing/.claude/worktrees/incremental-feel` (branch `worktree-incremental-feel`). Paths below are relative to that root. Nothing was edited, run or started.

Marks: **V** = verified at a file:line I read. **I** = inferred. Tailwind breakpoints are taken as the defaults (sm 640 px, md 768 px, lg 1024 px, xl 1280 px): **I**, supported by `src/routes/layout.css` having no `breakpoint` override (grep, V) and by the header's own `WIDE = '(min-width: 1024px)'` (`src/lib/shell/SiteHeader.svelte:47`, V).

Context read first: `docs/superpowers/specs/2026-11-24-incremental-feel-design.html` (skimmed as text).

---

## (a) The header

### a.1 `SiteHeader.svelte` props

`src/lib/shell/SiteHeader.svelte:27-45` (V):

| Prop | Type | Default | Meaning |
| --- | --- | --- | --- |
| `actions` | `Snippet` | none | right-hand actions |
| `pinned` | `Snippet` | none | the one always-visible item |
| `status` | `Snippet` | none | the page's status cell |
| `user` | `{ handle: string } \| null` | `null` | signed-in account's handle |
| `signInAvailable` | `boolean` | `true` | whether any sign-in method is in effect |
| `routeId` | `string \| null` | `null` | the current route id |

Other inputs it reads itself (V):
- `useGame()` (`:68`): `game.open`, `game.progress`, `game.offer`, `game.sync.account`.
- `simLocked` from `$lib/game/allowed` (`:21`), `roundComplete` from `$lib/game/progress` (`:22`), `AUTH_COPY.signIn` (`:20`, `:264`).
- `matchMedia('(min-width: 1024px)')` into `wide` (`:47`, `:133-140`); `mounted` set in `onMount` (`:132`).

Derived state (V):
- `onSim = routeId === '/sim'` (`:51`).
- `locked = mounted && !game.open && simLocked(game.progress)` (`:71`). `simLocked(p)` is `p.level === 1` (`src/lib/game/allowed.ts:76-78`).
- `account = user ?? (mounted ? game.sync.account : null)` (`:72`).
- `ready = mounted && !game.open && game.offer !== null && !roundComplete(game.progress)` (`:77-79`).

### a.2 Elements rendered, in DOM order

The `<header>` is `h-12`, flex, `justify-between gap-2`; with a pinned item it becomes `lg:grid lg:grid-cols-[1fr_auto_1fr]` (`:175-184`, V).

| # | Element | Lines | Shown when | Needs |
| --- | --- | --- | --- | --- |
| 1 | Left wrapper `<div>`: a flex row when `pinned`, else `display: contents` | 185 | always | `pinned` |
| 1a | Site name link `<a href="/">SF Housing <span class="sr-only xl:not-sr-only">Simulator</span></a>` | 187-189 | every width; `max-sm:hidden` when `pinned` | `pinned` |
| 1b | `<nav aria-label="Steps">` (bar copy), `max-lg:hidden` | 190-192 | from lg | `routeId`, `locked` |
| 1c | `<LevelCell inMenu={false} />` | 193 | `mounted && !game.open && wide` (from lg) | game store |
| 1d | Status `<div data-header-status>` rendering `status?.()` | 197-205 | every width | `status` |
| 2 | Pinned `<div>` rendering `pinned()` | 207-209 | every width, only if `pinned` | `pinned` |
| 3 | Menu `<button data-header-menu>`, hamburger SVG; `aria-label` `'Menu'` or `'Menu, level up ready'`; `aria-expanded`, `aria-controls` | 210-230 | below lg (`lg:hidden`) | `ready`, `open` |
| 3a | Dot `<span data-level-dot>` on the Menu button | 223-229 | `ready` | game store |
| 4 | Panel `<div id={panelId}>`: `lg:contents`; below lg `max-lg:hidden` unless `open`, then absolute under the header, flex column `gap-3`, `z-50` | 232-242 | from lg its children sit in the header row; below lg only while open | `open` |
| 4a | Site name link `<a href="/">SF Housing Simulator</a>`, `sm:hidden` | 243-249 | below sm, in the open Menu, only if `pinned` | `pinned` |
| 4b | `<nav aria-label="Steps">` (Menu copy), `lg:hidden` | 250-252 | below lg, in the open Menu | `routeId`, `locked` |
| 4c | `<LevelCell inMenu />` | 253 | `mounted && !game.open && !wide` | game store |
| 4d | Group `<div>`: `actions?.()` | 256-257 | every width (in Menu below lg) | `actions` |
| 4e | Account link `<a data-header-account>`: `href` `/account` or `/signin`; text `@handle` or `AUTH_COPY.signIn`; `title` `@handle`; `max-w-40`, `lg:max-xl:max-w-24` | 258-266 | `account \|\| signInAvailable` | `user`, `signInAvailable`, `game.sync.account` |
| 4f | About link `<a href="/about" data-header-about>`; `aria-current="page"` when `routeId === '/about'` | 267-272 | always | `routeId` |

All rows V at the lines given.

### a.3 By breakpoint (V from the classes above; breakpoint pixel values I)

- **Below sm (<640)**: bar holds status (1d), pinned (2), Menu button (3). Site name 1a is in the bar only when the page pins nothing; with a pinned item it is hidden in the bar and appears as 4a in the Menu. Visible name text is "SF Housing" (1a) or "SF Housing Simulator" (4a). Menu holds 4a, steps (4b), level cell (4c), actions, account, About.
- **sm to lg (640-1023)**: bar holds site name 1a (visible text "SF Housing"; "Simulator" is `sr-only`), status, pinned, Menu button. Menu holds steps, level cell, actions, account, About. 4a is hidden (`sm:hidden`).
- **lg to xl (1024-1279)**: no Menu button. Row: site name ("SF Housing"), steps nav 1b, level cell 1c, status, pinned (centred by the grid when pinned), actions, account (capped `max-w-24`), About. Status padding: `lg:pl-2 lg:max-xl:pl-0` (`:199`).
- **xl and up (>=1280)**: as lg, with "Simulator" visible (`xl:not-sr-only`, `:188`) and the account cap at `max-w-40`.

The link's accessible name is "SF Housing Simulator" at every width (the span is `sr-only`, not removed). Test expectation: `src/lib/shell/SiteHeader.svelte.spec.ts:302-327` (V: test names and the `textContent` assertion at `:307`, `:317`).

Doc vs code:
- `docs/dev/sim-page.md:81` says "from lg to xl the site name drops 'Simulator'". Code hides "Simulator" at every width below xl, not only from lg (`SiteHeader.svelte:188`, V).
- The header's own comment (`SiteHeader.svelte:2-16`) matches the markup (V).

### a.4 The steps "1 Paint" and "2 Simulate"

Snippet `steps()` at `src/lib/shell/SiteHeader.svelte:147-168`, rendered twice (bar `:191`, Menu `:251`) (V).

- An `<ol>` of two `<li>` (`:148-167`).
- Step 1: `<a href="/" class={tab(routeId === '/')} aria-current={routeId === '/' ? 'page' : undefined}>` with `stepNumber(1)` then the text `Paint` (`:150-152`). Always a link.
- Step 2, when `locked`: `<span data-step-locked class={lockedStep}>` holding `stepNumber(2)`, `<span aria-hidden="true">Simulate</span>` and `<span class="sr-only">Simulate. Unlocks when you level up</span>` (`:155-160`). No link.
- Step 2, otherwise: `<a href="/sim" class={tab(onSim)} aria-current={onSim ? 'page' : undefined}>` with `stepNumber(2)` then `Simulate` (`:161-164`).
- `stepNumber(n)`: `<span aria-hidden="true" data-step-number class="mr-1 font-semibold tabular-nums">{n}</span>` (`:171-173`).
- Styles: `tab(current)` fills the current step with the accent, the other gets a grey border (`:55-62`); `lockedStep` is the same shape with a dashed border and muted ink (`:65-66`).

**When Simulate is a link** (V, `:71` and `:155`): whenever `locked` is false, that is when any of these holds:
1. Before mount, including the server render (`mounted` false). Test: `src/lib/shell/SiteHeader.ssr.spec.ts:13-14` expects `href="/sim"` and no `data-step-locked` for a level 1 game.
2. The game is the open game (`game.open`). `useGame()` returns `openGame()` when no game is provided (`src/lib/game/store.svelte.ts:805-807`); the root layout provides the open game on the server and under the e2e seam (`src/routes/+layout.svelte:19-22`).
3. The game's level is above 1.

Doc vs code: `CLAUDE.md:101` says "Simulate is not a link while the current game is at level 1"; `docs/dev/fzp-mode.md:5` says "a link once the current game is past level 1". The code adds cases 1 and 2 above.

### a.5 Header-actions API

`src/lib/shell/header-actions.svelte.ts` (V, whole file read):

```ts
export class HeaderActions {
  current = $state<Snippet | null>(null);   // :7
  pinned = $state<Snippet | null>(null);    // :12
  status = $state<Snippet | null>(null);    // :17
  owner: object | null = null;              // :23
}
export function provideHeaderActions(): HeaderActions            // :27
export function useHeaderActions(
  snippet: Snippet | null,
  opts?: { pinned?: Snippet; status?: Snippet }
): void                                                          // :36-39
export function focusHeaderMenu(): boolean                       // :63
export function headerOverlay(id: string, close: () => void): () => void  // :77
```

- `provideHeaderActions` sets a context under a module `Symbol` and returns the instance (`:27-29`).
- `useHeaderActions` returns silently with no context (`:40-41`); sets `owner`, `current`, `pinned`, `status` (`:44-48`); on destroy clears all four only if it is still the owner (`:49-55`). A later mount replaces all three slots.
- `pinned`: "The page's one always-visible item ... in the header at every width" (`:8-11`).
- `status`: "The page's non-interactive status ... on the left at every width ... Never among the actions" (`:13-16`).
- `focusHeaderMenu` focuses `[data-header-menu]` (`:63-67`). Caller: `src/lib/about/AboutDialog.svelte:167`.
- `headerOverlay` uses a window `CustomEvent` named `sfh-header-overlay-open` so at most one header overlay is open (`:69-86`). Callers: `SiteHeader.svelte:86`, `LevelCell.svelte:33`, `src/lib/dock/Dock.svelte:152`.

**Callers of `provideHeaderActions`** (V, grep over `src` and `e2e`):
- Production: `src/routes/+layout.svelte:17`.
- Test hosts: `src/routes/test/PageHost.svelte:10`, `src/routes/test/PaintHeaderHost.svelte:9`, `src/routes/sim/test/SimPageHost.svelte:9`, `src/routes/sim/test/GameSimHost.svelte:17`, `src/routes/p/[id]/test/PageHost.svelte:10`, `src/routes/s/[id]/test/PageHost.svelte:12`, `src/lib/shell/test/Host.svelte:24`, `src/lib/sim-page/test/SimPageHost.svelte:15`, `src/lib/timeline/test/TimelineModeHost.svelte:76`.

**Census of `useHeaderActions` callers** (V, grep over `src` and `e2e`; four call sites):

| Call site | Route(s) it serves | `snippet` (actions) | `pinned` | `status` |
| --- | --- | --- | --- | --- |
| `src/routes/+page.svelte:104` | `/` | `headerActions` (`:280-290`): `PublishButton` with `PLAN_CODEC`, once `editor` is set | `scoreBar` (`:243-255`): `TimelineHeaderScore` with `paintHeadline(shown.netUnits, goal)` | `saveState` (`:292-294`): `SaveIndicator status={autosave.status}` |
| `src/routes/p/[id]/+page.svelte:91` | `/p/[id]` | `null` | `scoreBar` (`:137-149`): `TimelineHeaderScore` with `paintHeadline(shown.netUnits)` | none |
| `src/lib/timeline/TimelineMode.svelte:1506` | `/sim` and `/s/[id]` (through `SimRoute` -> `SimPage` -> `TimelineMode`) | `headerActions` (`:1545-1549`): the `actions` prop unless `noScenario` | `scoreBar` (`:1596-1609`): `TimelineHeaderScore` with `headText`, once `session && calibration` | `statusSlot` (`:1561-1594`): the `status` prop's save state in one cell, with "Updating" over it or beside it when `saveOff` |
| `src/lib/shell/test/ActionsChild.svelte:15` | test only | a raw-snippet button | optional raw button | optional raw span |

What `SimPage` hands `TimelineMode` (V, `src/lib/sim-page/SimPage.svelte`; outside my scope, read in part): `actions` (`:1162-1189`) is a "Stop painting"/"Stop erasing" button while `toolOff`, then, when not read-only, `HistoryButtons` while `pointer.touch`, then `PublishButton`; `status` is `saveState` (`:1191-1195`) unless read-only (`:1267`).

Pinned content on Paint (V, `src/lib/paint/headline.ts:13-35`): line 1 `Room for N homes`, line 2 `N% of the goal` or `Goal reached`, `effect: null`. The box is `src/lib/timeline/TimelineHeaderScore.svelte` (`:60-102` read): a button (`data-testid="score-bar"`) with line 1, a second line (`max-sm:hidden`) of effect and goal, the goal part `lg:max-xl:hidden` while an effect shows (`:38`).

### a.6 `LevelCell.svelte`

`src/lib/shell/LevelCell.svelte` (V, whole file read).

- Props: `{ inMenu: boolean }` (`:16`). No others. Reads `useGame()` (`:18`).
- Shows:
  - A button `data-testid="header-level"`, class `BUTTON`, with `aria-expanded` and `aria-controls` (`:92-100`). Its text is `label`: `'Round complete'` when `roundComplete(game.progress)`, else `levelText(game.progress.level)` = `Level N` (`:28-30`; `src/lib/game/copy.ts:37-39`).
  - A "Level up" button `data-testid="header-level-up"`, class `BUTTON_PRIMARY`, while `game.offer !== null && !roundComplete(game.progress)` (`:31`, `:101-105`). Pressing it calls `game.levelUp()` and refocuses the cell button if the offer is gone (`:50-54`).
- Opens: `<LevelPanel />` from `$lib/game/LevelPanel.svelte` inside `<div data-testid="header-level-panel">` (`:107-121`).
  - Not in the Menu: a pop-over, `SURFACE_POP`, `absolute top-full z-50 mt-1 w-80 max-w-[calc(100vw-2rem)]`, `left` measured from the button to the `<header>` at open (`:40-44`, `:114-117`). Opening it announces `openOnly()` so other header overlays close (`:47`).
  - In the Menu: rendered in place under the cell, no overlay announcement (`:46-47`, `:114`).
- Closes on: toggle, Escape (prevents default, refocuses the button, `:56-66`), a pointer press outside the root (`:68-72`), a click on any link in the panel (`:78-80`), another header overlay opening (`:33`).
- The root carries `data-header-keep-open` (`:88`); `SiteHeader` keeps its Menu open for a button press inside it (`SiteHeader.svelte:127`).
- `SiteHeader` mounts exactly one instance, chosen by `wide` (`SiteHeader.svelte:193`, `:253`), and none before mount or for the open game.

What the panel holds (V, `src/lib/game/LevelPanel.svelte:184-296`; outside my scope, read in part): heading `Level N` (`:192-194`); `aimText` (`:195`) and `nextText` (`:196`); "Level up" while offered (`:198-200`); the sync line, a link to `/signin?returnTo=...` when the state is `sign-in` (`:201-209`, `:36-38`); heading "Saved games" (`:210`) and a list of saves with switch, Rename, Delete (`:211-287`); "New game" (`:289-291`); an alert line (`:294`). Switching or creating a game calls `loadPage(gamePath(game.progress.level))` (`:55`, `:172`), a full page load to `/` or `/sim`. The whole panel renders nothing for the open game (`:184`).

---

## (b) The route map

`isFullHeightRoute`, quoted in full from `src/lib/shell/layout.ts:1-10` (V):

```ts
/** Routes that fill the viewport (map pages) instead of flowing as documents. */
export function isFullHeightRoute(routeId: string | null): boolean {
  return (
    routeId === '/' ||
    routeId === '/sim' ||
    routeId === '/lesscars' ||
    (routeId?.startsWith('/p/[id]') ?? false) ||
    (routeId?.startsWith('/s/[id]') ?? false)
  );
}
```

Notes (V):
- There is no `src/routes/lesscars` directory (directory listing). The rule still names `/lesscars`, and `src/lib/shell/layout.spec.ts:29-31` tests it as full height. `e2e/pages-a11y.spec.ts:39` expects `/lesscars` and `/fzp` to answer 404.
- `src/lib/shell/layout.spec.ts:24` is titled "/fzp is no longer a page (it redirects to /sim)". I found no redirect: no `src/routes/fzp`, and `src/hooks.server.ts`, `src/hooks.client.ts` and `svelte.config.js` have no `fzp` or redirect (grep). The e2e test above expects a 404. Doc (the test title) and code disagree.

There is one layout: `src/routes/+layout.svelte` and `src/routes/+layout.server.ts`. No `+layout.ts`, no nested layouts (find, V). No route exports `prerender`, `ssr`, `csr` or `trailingSlash` (grep, V).

Root layout load, `src/routes/+layout.server.ts:10-29` (V): returns `{ datasetVersion, appRelease, user, signInAvailable }`. `datasetVersion` from `resolveDatasetVersion` (`:12-16`); `appRelease` from `PUBLIC_APP_RELEASE` or `'dev'` (`:17`); `user` is `locals.user ?? null` (`:18`); `signInAvailable` is `enabledAuthMethods(...).size > 0` (`:21`). With a session it awaits `refreshKnownDevice` first (`:25-28`).

### Page routes

| Route dir | Files | Load: returns | Mounts | Full height |
| --- | --- | --- | --- | --- |
| `src/routes` (`/`) | `+page.svelte`, `+page.ts`, `+error.svelte`, `+layout.svelte`, `+layout.server.ts`, `layout.css`, specs `page.spec.ts`, `page.svelte.spec.ts`, `page.game.svelte.spec.ts`, `page.header.svelte.spec.ts`, `page.rest-text.svelte.spec.ts`, `page.undo.svelte.spec.ts`, `page.view.svelte.spec.ts`, `layout.server.spec.ts` | `+page.ts:8-25` universal: `{ plan, manifest, fellBack, manifestError }`; `plan = emptyPlan(datasetVersion)`; on a manifest failure `manifest: null, manifestError: true`; `error(500)` on a bad dataset version | `BrushEditor` in `<div id="map-region">` (`+page.svelte:304-324`); `WinCard` inside the notice stack while won (`:263-273`) | yes |
| `src/routes/sim` (`/sim`) | `+page.svelte`, `+page.ts`, specs `page.spec.ts`, `page.svelte.spec.ts`, `game.svelte.spec.ts`, `test/GameSimHost.svelte`, `test/SimPageHost.svelte` | `+page.ts:9-17` universal: `SimPageData` = `{ manifest, manifestError, calibration, calibrationError, noScenario }` from `loadSimScenario(datasetVersion, datasetVersion, fetch)` with `fellBack` dropped | `<SimRoute {data} mode="edit" persist="restore" />` (`+page.svelte:14`) | yes |
| `src/routes/p/[id]` | `+page.server.ts`, `+page.ts`, `+page.svelte`, `+error.svelte`, specs `page.server.spec.ts`, `page.view.svelte.spec.ts`, `test/PageHost.svelte` | server (`+page.server.ts:4-12`): `loadSharedPlan` -> `{ id, plan, createdAt, currentDatasetVersion, datasetNotice }` (`src/lib/server/sharing/shared-page.ts:30-37`, `:86-93`), sets `cache-control: private, max-age=300`. Universal (`+page.ts:6-18`): adds `{ manifest, fellBack, manifestError }` | `SharedBanner kind="plan"` then read-only `BrushEditor` keyed on `data.id` (`+page.svelte:163-200`) | yes |
| `src/routes/s/[id]` | `+page.server.ts`, `+page.ts`, `+page.svelte`, `+error.svelte`, specs `page.server.spec.ts`, `page.spec.ts`, `page.view.svelte.spec.ts`, `test/PageHost.svelte` | server (`+page.server.ts:8-19`): `loadSharedDoc(SIM_SERVER_CODEC4, ...)` -> `{ id, doc, createdAt, currentDatasetVersion, datasetNotice, upgradedFrom? }` (`shared-page.ts:19-28`); a plan id redirects 308 to `/p/<id>` (`shared-page.ts:57`); same cache header. Universal (`+page.ts:13-32`): `{ ...data, ...scenario, datasetVersion, opened }`; `error(500)` if the text will not open | `SharedBanner kind="sim"` then `<SimRoute mode="view" persist="off" initialText opened upgradedFrom />` (`+page.svelte:81-105`) | yes |
| `src/routes/about` | `+page.server.ts`, `+page.svelte`, specs `page.server.spec.ts`, `page.svelte.spec.ts` | server (`+page.server.ts:5-8`): `{ datasetVersion, manifest }`, `manifest` the R2 `manifest.json` parsed by `ManifestSourcesSchema`, or `null` | `AboutMeanings`, `AboutAssumptions`, `AboutData`, `AboutUsing`, all `level={2}` (`+page.svelte:29-32`) | no |
| `src/routes/account` | `+page.server.ts`, `+page.svelte`, specs `page.server.spec.ts`, `page.svelte.spec.ts` | server (`+page.server.ts:32-52`): redirect 303 to `/signin?returnTo=/account` when signed out; else `{ user: { id, handle, name, email, emailVerified, pseudonymous }, methods, hasPasskey, hasOAuthAccount, canSignOut, linkError }`. Action `signOut` (`:60-67`) redirects to `/` | `ProfilePane`, `AuthenticationPane`, `DeleteAccountPane`, `FormStatus` (imports, `+page.svelte:6-11`) | no |
| `src/routes/signin` | `+page.server.ts`, `+page.svelte`, specs `page.server.spec.ts`, `page.svelte.spec.ts` | server (`+page.server.ts:18-42`): a signed-in user is redirected 303 to `safeReturnTo(returnTo)`; else `{ signup, linkError, googleError, pendingIdentifier, reset, methods }`. Actions `sendLink` (`:45`), `signInPassword` (`:141`) | form with `FieldError`, `FormStatus` (`+page.svelte:6-7`) | no |
| `src/routes/forgot-password` | `+page.server.ts`, `+page.svelte`, specs `page.server.spec.ts`, `page.svelte.spec.ts` | server (`+page.server.ts:10-13`): `requireMethod(event, 'password')`, returns `{}`. Action `requestReset` (`:27`) | form | no |
| `src/routes/reset-password` | `+page.server.ts`, `+page.svelte`, specs `page.server.spec.ts`, `page.svelte.spec.ts` | server (`+page.server.ts:20-26`): `{ token, invalid }`. Action `resetPassword` (`:29`), redirect to `/signin?reset=1` (`:86`) | form | no |
| `src/routes/attribution` | `+page.server.ts`, `page.server.spec.ts` (no `+page.svelte`) | server (`+page.server.ts:5-7`): `redirect(308, '/about#about-data')` | nothing | no |
| `src/routes/test` | `page-worker.ts`, `PageHost.svelte`, `PaintHeaderHost.svelte` | none. Not a route: no `+` files (V). Test hosts for `/` | - | - |

All rows V at the lines given; "Mounts" for account, signin, forgot-password and reset-password is from their import lines and headings only (those `+page.svelte` files were read in part).

Error pages (V): `src/routes/+error.svelte` (title `{heading}` with no site name, link "Go to the home page" to `/`, `:8`, `:15`); `src/routes/p/[id]/+error.svelte` (links to `/`, `:28`, `:30`); `src/routes/s/[id]/+error.svelte` (`SIM.startHref` = `/sim`, `:28`; `/`, `:30`). Both nested error pages scroll inside `<main>` because the route is full height (`p/[id]/+error.svelte:22-23`, `s/[id]/+error.svelte:22-23`).

### Endpoint routes (V: exported handlers by grep; bodies not read)

| Route dir | File(s) | Handlers |
| --- | --- | --- |
| `src/routes/data/[version]/[...path]` | `+server.ts`, `server.spec.ts` | `GET` (`:81`), `HEAD` (`:134`) |
| `src/routes/api/account` | `+server.ts`, `server.spec.ts`, `delete-pseudonymous.spec.ts` | `GET` (`:11`), `DELETE` (`:24`) |
| `src/routes/api/account/email` | `+server.ts`, `server.spec.ts` | `PATCH` (`:10`) |
| `src/routes/api/account/email/verify` | `+server.ts`, `server.spec.ts` | `POST` (`:11`) |
| `src/routes/api/account/password` | `+server.ts`, `server.spec.ts` | `POST` (`:27`), `DELETE` (`:139`) |
| `src/routes/api/account/profile` | `+server.ts`, `server.spec.ts` | `PATCH` (`:9`) |
| `src/routes/api/auth/[...all]` | `+server.ts`, `server.spec.ts` | `GET`, `POST` (`:126-127`) |
| `src/routes/api/e2e/login` | `+server.ts`, `login.spec.ts` | `POST` (`:13`) |
| `src/routes/api/e2e/mail` | `+server.ts`, `mail.spec.ts` | `GET` (`:15`) |
| `src/routes/api/e2e/plans` | `+server.ts` | `POST` (`:8`) |
| `src/routes/api/game` | `+server.ts`, `server.spec.ts` | `GET` (`:6`) |
| `src/routes/api/game/[id]` | `+server.ts`, `server.spec.ts` | `GET` (`:15`), `PUT` (`:23`), `DELETE` (`:87`) |
| `src/routes/api/plans` | `+server.ts`, `server.spec.ts` | `POST` -> `handlePublish(event, PLAN_CODEC)` (`:5`) |
| `src/routes/api/plans/[id]` | `+server.ts`, `server.spec.ts` | `GET` -> `handleGetPlan(event, PLAN_CODEC)` (`:5`) |
| `src/routes/api/policies` | `+server.ts`, `server.spec.ts` | `POST` -> `handlePublish(event, CODECS.sim)` (`:5`) |
| `src/routes/api/policies/[id]` | `+server.ts`, `server.spec.ts` | `GET` -> `handleGetPlan(event, CODECS.sim)` (`:5`) |

Directories with no files of their own (V): `src/routes/api`, `src/routes/api/auth`, `src/routes/api/e2e`, `src/routes/data`, `src/routes/data/[version]`, `src/routes/p`, `src/routes/s`.

### The `/sim` gate inside `SimRoute`

`src/lib/sim-page/SimRoute.svelte` (V, whole file read; outside my scope but it is what `/sim` mounts):
- `game = mode === 'edit' && !store.open ? store : null` (`:56`).
- View mode renders `SimPage` with no game (`:100-101`). Edit mode renders nothing until mounted (`:102`), then the locked page `data-testid="sim-locked"` while `game && simLocked(game.progress)`: a line from `lockedSim(amount, unit)` and `<a href="/">Go to Paint</a>` (`:103-110`; copy at `src/lib/timeline/game-copy.ts:43-47`). Otherwise `SimPage` with the game (`:111-113`).
- `afterNavigate` drops a `?seed=` with `replaceState` (`:66-74`).

### How `/` leaves for `/sim`

`src/routes/+page.svelte:226-232` (V): when `locked` goes from true to false (the level leaves 1) the page calls `goto('/sim')`.

---

## (c) Census of the site name

Search: `rg --hidden --no-ignore "Housing Simulator"` over the worktree, excluding `node_modules`, `.svelte-kit`, `build`, `.wrangler`, `CHANGELOG.md`, `.claude/worktrees`. In a worktree `.git` is a file, so nothing under it is searched. **84 lines** match, with or without `.gitignore` honoured (V). Every match is "SF Housing Simulator"; "Housing Simulator" never appears without "SF" (V: all 84 lines printed and read). No match is split over a line break (`rg -U "Housing\s*\n\s*Simulator"`: none, V). `CHANGELOG.md` has no match either (V), though the brief excludes it.

### c.1 Shown to users (14 lines)

| File:line | Text | Where it shows |
| --- | --- | --- |
| `src/lib/shell/SiteHeader.svelte:247` | `>SF Housing Simulator</a` | header Menu, site name below sm |
| `src/routes/+page.svelte:296` | `<svelte:head><title>SF Housing Simulator</title></svelte:head>` | page title of `/` |
| `src/routes/+page.svelte:303` | `<h1 class="sr-only">SF Housing Simulator</h1>` | `<h1>` of `/` |
| `src/routes/sim/+page.svelte:11` | `<svelte:head><title>Policy simulation · SF Housing Simulator</title></svelte:head>` | page title of `/sim` |
| `src/routes/p/[id]/+page.svelte:38` | ``const pageTitle = $derived(`${data.plan.title ?? 'Shared plan'} · SF Housing Simulator`);`` | title and `og:title` (`:156-157`) |
| `src/routes/p/[id]/+error.svelte:15` | `<title>Plan not found · SF Housing Simulator</title>` | error page title |
| `src/routes/p/[id]/+error.svelte:18` | `<title>{heading} · SF Housing Simulator</title>` | error page title |
| `src/routes/s/[id]/+page.svelte:26` | ``const pageTitle = $derived(`${heading} · SF Housing Simulator`);`` | title and `og:title` (`:74-75`) |
| `src/routes/s/[id]/+error.svelte:16` | `<title>{heading} · SF Housing Simulator</title>` | error page title |
| `src/lib/config.ts:2` | `export const APP_NAME = 'SF Housing Simulator';` | constant; its one user is the `/about` title, `src/routes/about/+page.svelte:19` |
| `src/lib/server/auth/brand.ts:2` | `export const PRODUCT_NAME = 'SF Housing Simulator';` | constant; emails and the passkey prompt (below) |
| `src/lib/plan/schema.ts:33` | `'This plan was made with a newer version of SF Housing Simulator. Reload the page to get the latest version.';` | plan load error message |
| `wrangler.jsonc:40` | `"SES_FROM": "SF Housing Simulator <noreply@sfhousing.mindlace.net>",` | From display name of sent mail, production. Also infrastructure config |
| `wrangler.jsonc:95` | `"SES_FROM": "SF Housing Simulator <noreply@sfhousing.mindlace.net>",` | same, staging |

`config.ts:2` and `brand.ts:2` are identifiers whose value is shown, so they are counted here and not in c.2. The places that show the name only through those constants follow; they hold no literal and are not among the 84.

Places that show the name through a constant, with no literal (V):
- `src/routes/about/+page.svelte:19`: `<title>{ABOUT_TITLE} · {APP_NAME}</title>`.
- `src/lib/server/email-templates/copy.ts`: `PRODUCT_NAME` at `:5` (wordmark), `:6` (footer), `:10-12` (sign-in subject, preview, heading), `:17-18` (reset subject, preview), `:24-25`, `:28` (change-approve subject, preview, body), `:34-35`, `:37` (confirm subject, preview, body). The wordmark renders at `src/lib/server/email-templates/Layout.svelte:27`, the footer at `:35`.
- `src/lib/server/auth/brand.ts:8`: `PASSKEY_RP_NAME = PRODUCT_NAME`, used at `src/lib/server/auth/better-auth.ts:336` (`rpName`).

The split form in the header, not matched by the search (V): `src/lib/shell/SiteHeader.svelte:187-189`, `>SF Housing <span class="sr-only xl:not-sr-only">Simulator</span></a`.

Pages whose title carries no site name (V): `src/routes/+error.svelte:8` (`{heading}`), `src/routes/account/+page.svelte:51` (`ACCOUNT_COPY.pageTitle`, "Account"), `src/routes/signin/+page.svelte:112` ("Sign in"/"Sign up"), `src/routes/forgot-password/+page.svelte:18` ("Reset your password"), `src/routes/reset-password/+page.svelte:19` ("Choose a new password").

No manifest, favicon or `static/` (V): the directory `static/` does not exist; `src/app.html` (11 lines, read in full) has no `<title>`, no description meta, no icon link; grep for `webmanifest|favicon|apple-touch|theme-color|application-name` in `src`, `svelte.config.js`, `vite.config.ts` finds nothing.

`package.json` (V): `"name": "sfhousing"` (`:2`). It has no `description`, `homepage` or `repository` field (grep).

### c.2 Code identifier or test expectation (22 lines)

| File:line | Text |
| --- | --- |
| `src/lib/shell/SiteHeader.svelte.spec.ts:20` | `const link = banner.getByRole('link', { name: 'SF Housing Simulator' });` |
| `src/lib/shell/SiteHeader.svelte.spec.ts:298` | `const link = page.getByRole('banner').getByRole('link', { name: 'SF Housing Simulator' });` |
| `src/lib/shell/SiteHeader.svelte.spec.ts:305` | same |
| `src/lib/shell/SiteHeader.svelte.spec.ts:307` | `expect(link.element().textContent).toBe('SF Housing Simulator');` |
| `src/lib/shell/SiteHeader.svelte.spec.ts:315` | as `:298` |
| `src/lib/shell/SiteHeader.svelte.spec.ts:317` | as `:307` |
| `src/lib/shell/SiteHeader.svelte.spec.ts:321` | `it('shows "SF Housing Simulator" at 1280px', async () => {` |
| `src/lib/shell/SiteHeader.svelte.spec.ts:325` | `.element(page.getByRole('banner').getByRole('link', { name: 'SF Housing Simulator' }))` |
| `src/lib/shell/SiteHeader.svelte.spec.ts:431` | `const name = () => page.getByRole('link', { name: 'SF Housing Simulator' });` |
| `src/lib/shell/SiteHeader.svelte.spec.ts:450` | `const name = page.getByRole('link', { name: 'SF Housing Simulator' });` |
| `src/lib/shell/SiteHeader.svelte.spec.ts:459` | `expect(page.getByRole('link', { name: 'SF Housing Simulator' }).elements()).toHaveLength(` |
| `src/routes/page.svelte.spec.ts:64` | `.toHaveTextContent('SF Housing Simulator');` |
| `src/routes/page.header.svelte.spec.ts:75` | `await expect.element(page.getByRole('link', { name: 'SF Housing Simulator' })).toBeVisible();` |
| `src/routes/sim/page.svelte.spec.ts:122` | `await expect.poll(() => document.title).toBe('Policy simulation · SF Housing Simulator');` |
| `src/routes/s/[id]/page.view.svelte.spec.ts:172` | `await expect.poll(() => document.title).toBe('SD permits · SF Housing Simulator');` |
| `src/lib/timeline/TimelineMode.svelte.spec.ts:2178` | `const name = page.getByRole('banner').getByRole('link', { name: 'SF Housing Simulator' });` |
| `src/lib/plan/schema.spec.ts:213` | `'This plan was made with a newer version of SF Housing Simulator. Reload the page to get the latest version.'` |
| `e2e/helpers/chrome.ts:70` | `await expect(banner.getByRole('link', { name: 'SF Housing Simulator' })).toBeVisible();` |
| `e2e/transit.spec.ts:81` | `await page.getByRole('banner').getByRole('link', { name: 'SF Housing Simulator' }).click();` |
| `e2e/fzp.spec.ts:602` | `await expect(page).toHaveTitle('Policy simulation · SF Housing Simulator');` |
| `e2e/sim.spec.ts:1539` | `await expect(banner.getByRole('link', { name: 'SF Housing Simulator' })).toBeVisible();` |
| `pipeline/lidar-raster/sfh_lidar/__init__.py:1` | `"""Fetch-time LiDAR rasterizer for the SF Housing Simulator pipeline (sfhl/1 tiles)."""` (a docstring) |

Tests that match the shorter name by regex, so they pass under either name (V): `/SF Housing/` at `e2e/helpers/chrome.ts:44`, `e2e/sim.spec.ts:1531`, `src/routes/page.header.svelte.spec.ts:73`, `:98`, `src/lib/shell/SiteHeader.svelte.spec.ts:632`, `:696`, `:767`; `/^SF Housing/` at `e2e/layout.spec.ts:933`, `:1000`. Test names quoting "SF Housing": `src/lib/shell/SiteHeader.svelte.spec.ts:302`, `:312`.

The email specs assert on `EMAIL_COPY`, not the literal (V): `src/lib/server/email-templates/sign-in.spec.ts:21-24`, `reset-password.spec.ts:21`, `change-approve.spec.ts:18`, `confirm-email.spec.ts:18-20`. `src/lib/server/auth/better-auth.methods.spec.ts:324` asserts on `PASSKEY_RP_NAME`.

### c.3 Documentation (48 lines)

Project docs (3):

| File:line | Text |
| --- | --- |
| `README.md:1` | `# SF Housing Simulator` |
| `CLAUDE.md:7` | `SF Housing Simulator: a free, open-source educational game on a map of San Francisco. Level 1 paints zoning ...` |
| `docs/dev/deploy.md:177` | ``1. Google Auth Platform, Branding: app name `SF Housing Simulator`, the owner's support and developer contact address, home page `https://sfhousing.mindlace.net`, authorised domain `mindlace.net`.`` (also names an external setting: see c.4) |

Other docs (1): `docs/lesscars/plan-v1.md:2059`: ``| D3  | SF Housing Simulator dataset `2026-10-29-14e0eccb`: ...``.

Design, spec and plan history under `docs/superpowers/` (39 lines; text abbreviated, and where a row says "name later in the line" my capture cut the line before the name):

| File:line | Text (abbreviated) |
| --- | --- |
| `docs/superpowers/design/2026-10-10-1749-sf-housing-sim.md:1` | `# SF Housing Simulator — Composition Design` |
| `docs/superpowers/design/2026-10-16-1903-fzp-timelapse.md:5` | `Source model: [the SF Housing Simulator design](...)` |
| `docs/superpowers/design/2026-11-09-1911-sim-financing.md:9` | `... [the SF Housing Simulator design](...)` |
| `docs/superpowers/specs/2026-10-10-platform-design.md:260` | `"SF Housing Simulator" (link to `/`) on the left and a right-aligned `headerActions` snippet` |
| `docs/superpowers/specs/2026-10-10-plan-model-design.md:214` | the `future-schema` message |
| `docs/superpowers/specs/2026-10-10-plan-sharing-design.md:264` | `- **Meta:** <title> "<title or 'Shared plan'> · SF Housing Simulator"; og:title same;` |
| `docs/superpowers/specs/2026-10-16-fzp-mode-design.md:125` | the `+page.svelte` description (name later in the line) |
| `docs/superpowers/specs/2026-10-28-sim-policy-levers-design.md:5` | `Source designs: [the SF Housing Simulator design](...)` |
| `docs/superpowers/specs/2026-11-22-closing-design.html:345` | `What This Is becomes: SF Housing Simulator is a free, open-source educational game ...` |
| `docs/superpowers/specs/2026-11-22-mail-setup-design.html:38` | `Its subject is Your SF Housing Simulator sign in link` |
| `docs/superpowers/specs/2026-11-22-mail-setup-design.html:46` | `SES_FROM is SF Housing Simulator <noreply@sfhousing.mindlace.net> in production ... and in staging` |
| `docs/superpowers/specs/2026-11-22-mail-setup-design.html:249` | subject and From |
| `docs/superpowers/specs/2026-11-22-mail-setup-design.html:320` | Google Auth Platform branding app name |
| `docs/superpowers/plans/2026-10-10-platform.md:154` | `+page.svelte` title and `<h1>` |
| `docs/superpowers/plans/2026-10-10-platform.md:155` | `APP_NAME` definition |
| `docs/superpowers/plans/2026-10-10-platform.md:188` | `'SF Housing Simulator'` |
| `docs/superpowers/plans/2026-10-10-platform.md:733` | `SiteHeader.svelte.spec.ts` link name |
| `docs/superpowers/plans/2026-10-10-platform.md:815` | `About · SF Housing Simulator` title |
| `docs/superpowers/plans/2026-10-10-platform.md:875` | `Data & licences · SF Housing Simulator` title |
| `docs/superpowers/plans/2026-10-10-plan-model.md:1667` | the `future-schema` message |
| `docs/superpowers/plans/2026-10-10-plan-model.md:1825` | the `future-schema` message |
| `docs/superpowers/plans/2026-10-11-brush-tool.md:5` | `**Goal:** Build the brush editor ... for SF Housing Simulator.` |
| `docs/superpowers/plans/2026-10-11-brush-tool.md:1440` | `<svelte:head><title>SF Housing Simulator</title></svelte:head>` |
| `docs/superpowers/plans/2026-10-11-brush-tool.md:1442` | `<h1 class="sr-only">SF Housing Simulator</h1>` |
| `docs/superpowers/plans/2026-10-11-plan-sharing.md:834` | `/p` title |
| `docs/superpowers/plans/2026-10-11-plan-sharing.md:844` | `Plan not found · SF Housing Simulator` |
| `docs/superpowers/plans/2026-10-11-scoreboard-stage2-ui.md:1484` | title |
| `docs/superpowers/plans/2026-10-11-scoreboard-stage2-ui.md:1486` | `<h1>` |
| `docs/superpowers/plans/2026-10-18-fzp-mode.md:356` | brand's visible text and accessible name by width |
| `docs/superpowers/plans/2026-10-18-fzp-mode.md:369` | `SiteHeader` nav description (name later in the line) |
| `docs/superpowers/plans/2026-10-18-fzp-mode.md:685` | `Family Zoning Plan timelapse · SF Housing Simulator` |
| `docs/superpowers/plans/2026-10-29-sim-page.md:502` | `Title: "Policy simulation · SF Housing Simulator".` |
| `docs/superpowers/plans/2026-10-30-sim-publish.md:556` | `The page title is "<title or 'Shared policy'> · SF Housing Simulator".` |
| `docs/superpowers/plans/2026-11-01-lesscars-2-page.md:1275` | `Fewer cars · SF Housing Simulator` |
| `docs/superpowers/plans/2026-11-14-planafoot-auth-port.html:227` | `PASSKEY_RP_NAME = 'SF Housing Simulator'` |
| `docs/superpowers/plans/2026-11-14-planafoot-auth-port.html:294` | `SES_FROM` value |
| `docs/superpowers/plans/2026-11-14-planafoot-auth-port.html:318` | email builders (name later in the line) |
| `docs/superpowers/plans/2026-11-14-planafoot-auth-port.html:670` | `SES_FROM` sending address |
| `docs/superpowers/plans/2026-11-23-about-this-model.html:95` | `About this model · SF Housing Simulator` |

Run records under `.superpowers/` (5 lines): `.superpowers/superconductor/incremental-game/surveys/gate-explain.md:7`; `.../surveys/mail-recon.md:12`; `.../surveys/s6-paint-shell-sharing.md:434`, `:501`; `.superpowers/superconductor/incremental-loop/ledger.md:13`.

### c.4 Infrastructure

No worker, bucket, database or domain is named "SF Housing Simulator". The infrastructure names use `sfhousing` (V, `wrangler.jsonc`, read in full):
- Worker `sfhousing` (`:2`), staging `sfhousing-staging` (`:45`).
- Routes `sfhousing.mindlace.net` (`:11`), `sfhousing-staging.mindlace.net` (`:54`).
- D1 `sfhousing` (`:16`), `sfhousing-staging` (`:59`). R2 bucket `sfhousing` in both (`:23`, `:66`).
- `package.json:2` name `sfhousing`. `src/lib/config.ts:1` `REPO_URL = 'https://github.com/mindlace/sfhousing'` (asserted in `src/lib/config.spec.ts:6`).
- `src/lib/server/auth/brand.ts:5` `PSEUDONYMOUS_EMAIL_DOMAIN = 'pseudonymous.sfhousing.invalid'`.
- Hard-coded origin in `og:url`: `src/routes/p/[id]/+page.svelte:159`, `src/routes/s/[id]/+page.svelte:77`.

Lines among the 84 that touch configuration held outside the repository:
- `wrangler.jsonc:40`, `:95` (`SES_FROM`): a deployed var whose display name is the site name (listed in c.1).
- `docs/dev/deploy.md:177`: the Google Auth Platform app name, a setting in Google's console (I: the console value itself was not checked).

The design's call (testimony, `docs/superpowers/specs/2026-11-24-incremental-feel-design.html`, "Calls to check"): "The name changes on the site and in its documents only. The repository, the worker and the bucket keep theirs."

### c.5 Totals

84 lines = shown to users or a value that is shown 14 (c.1) + code identifier or test expectation 22 (c.2) + documentation 48 (README 1, CLAUDE.md 1, `docs/dev` 1, `docs/lesscars` 1, `docs/superpowers` 39, `.superpowers` 5). V by count of the printed lines (40 outside `docs/superpowers` and `.superpowers`, 44 inside).

### c.6 The bare word "Simulator" as the site's name

Search: `rg "Simulator"` minus "Housing Simulator" over `src`, `e2e`, `scripts`, `pipeline`, `README.md`, `package.json`, `wrangler.jsonc`, `CLAUDE.md`, `docs/dev`, `svelte.config.js`, `chreode.config.ts`, `LICENSE`, `release-please-config.json` (V). Three lines:
- `src/lib/shell/SiteHeader.svelte:188`: `>SF Housing <span class="sr-only xl:not-sr-only">Simulator</span></a` (shown to users).
- `src/lib/shell/SiteHeader.svelte.spec.ts:308`: `// sr-only: " Simulator" is clipped to a 1px box, not rendered` (test comment).
- `docs/dev/sim-page.md:81`: "... from lg to xl the site name drops "Simulator" ..." (documentation).

Lower-case "simulator" in `src`, `e2e`, `scripts`, `README.md`, `docs/dev` refers to the model, not the site's name (V, 8 lines read): `docs/dev/pipeline.md:113`, `src/lib/fzp/fixtures/cards.ts:180`, `src/lib/fzp/card.spec.ts:245`, `src/lib/sim/scenario/types.ts:287`, `src/lib/sim/scenario/input.spec.ts:238`, `src/lib/sim/scenario/fixtures/mini-policy.ts:32`, `mini-projects.ts:454`, `mini-parcels.ts:263`. Classification as "not the site name" is **I** from each line's wording.

`README.md:3` describes the game without the name: "Paint zoning until there is room for the homes goal, then reach the goal in a simulation of the city, unlocking permitting, zoning and public money one level at a time." (V)

---

## (d) Census of navigation to the two map pages

Search over `src` and `e2e` for `'/sim'` literals in any quote, `href="/sim"`, `goto(`, `loadPage(`, `gamePath(`, `remixPath(`, `gameHref`, `startHref`, `redirect(`, `location.*`, and for `/`: `href="/"`, `'/'` in comparisons and returns. No `resolve('/sim')` or `resolve('/')` exists anywhere (V: no match).

### d.1 Production code, to `/sim` (V)

| File:line | Form |
| --- | --- |
| `src/lib/shell/SiteHeader.svelte:162` | `<a href="/sim" ...>` (step 2) |
| `src/lib/shell/SiteHeader.svelte:51` | `routeId === '/sim'` (current-step test, not navigation) |
| `src/lib/shell/layout.ts:5` | `routeId === '/sim'` (full-height rule) |
| `src/routes/+page.svelte:230` | `goto('/sim')` on leaving level 1 |
| `src/lib/game/navigate.ts:4-5` | `gamePath(level)` returns `'/'` at level 1, else `'/sim'` |
| `src/lib/game/navigate.ts:9-10` | `remixPath(kind)` returns `'/'` for a plan, `'/sim'` for a policy |
| `src/lib/game/navigate.ts:14-15` | `loadPage(path: '/' \| '/sim')` = `window.location.assign(path)` |
| `src/lib/sharing/copy.ts:139` | `startHref: '/sim'` (policy copy) |
| `src/routes/s/[id]/+error.svelte:28` | `<a href={SIM.startHref}>` |

Callers of the `navigate.ts` helpers (V):
- `gamePath`: `src/routes/p/[id]/+page.svelte:61`, `src/routes/s/[id]/+page.svelte:49` (both `gameHref`, `'/'` before mount), `src/lib/game/LevelPanel.svelte:55`, `:172`.
- `remixPath` with `loadPage`: `src/routes/p/[id]/+page.svelte:78` (`'plan'`), `src/routes/s/[id]/+page.svelte:68` (`'sim'`).
- `gameHref` rendered: `src/lib/sharing/SharedBanner.svelte:75` (`<a href={gameHref}>Your game</a>`), passed at `src/routes/p/[id]/+page.svelte:174`, `src/routes/s/[id]/+page.svelte:92`.

### d.2 Production code, to `/` meaning Paint (V)

| File:line | Form |
| --- | --- |
| `src/lib/shell/SiteHeader.svelte:150` | `<a href="/" ...>` (step 1), with `routeId === '/'` |
| `src/lib/shell/SiteHeader.svelte:187` | `<a href="/">` site name in the bar |
| `src/lib/shell/SiteHeader.svelte:245` | `<a href="/">` site name in the Menu |
| `src/lib/shell/layout.ts:4` | `routeId === '/'` (full-height rule) |
| `src/lib/sim-page/SimRoute.svelte:109` | `<a href="/">Go to Paint</a>` on the locked `/sim` page |
| `src/lib/timeline/TimelineMode.svelte:1721` | `<a href="/">Go to the editor</a>` while `noScenario` |
| `src/lib/sharing/copy.ts:121` | `startHref: '/'` (plan copy) |
| `src/routes/p/[id]/+error.svelte:28` | `<a href="/">{COPY.startOwn}</a>` ("Start your own plan", `src/lib/sharing/copy.ts:21`) |
| `src/lib/game/navigate.ts:5`, `:10` | `'/'` branches of `gamePath` and `remixPath` |
| `src/routes/p/[id]/+page.svelte:61`, `src/routes/s/[id]/+page.svelte:49` | `'/'` as `gameHref` before mount |

Links to `/` that mean "home" rather than Paint by their wording (classification **I**):
- "Go to the home page": `src/routes/+error.svelte:15`, `src/routes/p/[id]/+error.svelte:30`, `src/routes/s/[id]/+error.svelte:30`.
- After auth: `src/routes/account/+page.svelte:46` (`goto('/', { invalidateAll: true })`), `src/routes/account/+page.server.ts:67` (`redirect(303, '/')`), `src/lib/account/safe-redirect.ts:12` (`fallback = '/'`), `src/routes/signin/+page.svelte:16`, `src/routes/signin/+page.server.ts:94` (`returnTo === '/'`), `callbackURL: '/'` at `src/routes/api/account/email/+server.ts:34`, `src/routes/api/account/email/verify/+server.ts:57`, `src/lib/account/AuthenticationPane.svelte:182`.

Not navigation (V): `path: '/'` cookie options at `src/lib/server/onboarding/known-device.ts:11`, `pending-identifier.ts:16`, `:30`, `src/lib/server/e2e/session.ts:93`.

### d.3 Unit and component tests under `src` (V, by grep; not read beyond the matching lines)

To `/sim` or naming it as a route:
- `src/lib/shell/SiteHeader.svelte.spec.ts`: `routeId: '/sim'` at `:139`, `:196`, `:212`, `:394`, `:419`, `:430`, `:449`, `:472`, `:483`, `:502`, `:513`, `:524`, `:589`, `:655`, `:729`, `:742`; `href` expectations at `:244`, `:890`, `:915`.
- `src/lib/shell/SiteHeader.ssr.spec.ts:13`.
- `src/lib/shell/LevelCell.svelte.spec.ts`: `routeId: '/sim'` at `:53`, `:57`, `:67`, `:84`, `:100`, `:122`, `:150`, `:169`, `:180`, `:202`, `:219`, `:240`, `:259`.
- `src/lib/shell/layout.spec.ts:20-21`.
- Test hosts: `src/lib/shell/test/HeaderScoreHeader.svelte:43`, `src/lib/timeline/test/TimelineModeHost.svelte:115`, `src/lib/sim-page/test/SimPageHost.svelte:25` (`routeId="/sim"`); `src/lib/about/test/AboutDialogHarness.svelte:30` (`<a href="/sim">`).
- `src/routes/page.game.svelte.spec.ts:205`, `:225` (`gotoCalls.at(-1)?.url` is `'/sim'`).
- `src/routes/s/[id]/page.view.svelte.spec.ts:259`, `:325` (`loadPage` called with `'/sim'`), `:316` (`href` is `/sim`).
- `src/routes/sim/page.svelte.spec.ts:21`, `:73`, `:105`, `:108`, `:117` (address strings).
- `src/lib/game/navigate.spec.ts:10`, `:14`, `:18`, `:22`, `:32`.
- `src/lib/sharing/SharedBanner.svelte.spec.ts:51`, `:57`, `:134`, `:135`, `:167`.
- `src/lib/about/links.spec.ts:26`.
- `src/hooks.server.spec.ts:56`, `src/lib/server/auth/session-gate.spec.ts:68`, `:89` (path lists).

To `/` as a route id in test hosts: `src/routes/test/PaintHeaderHost.svelte:13` (`routeId="/"`).

The other `/sim` matches in `src` are comments that name the page (for example `src/lib/paint/PaintTab.svelte:2`, `src/lib/brush/BrushEditor.svelte:9`): about 50 lines, V that each is a comment from the printed text, not listed one by one.

### d.4 e2e (V, by grep; line numbers are the matching lines)

Direct `/sim` literals:
- `page.goto('/sim')`: `e2e/sim-pools.spec.ts:17`, `e2e/targets.spec.ts:241`, `e2e/sim-halos.spec.ts:35`, `e2e/layout.spec.ts:929`, `:978`, `e2e/sim-activity.spec.ts:22`, `e2e/game-sim.spec.ts:174`, `e2e/chrome-dark.spec.ts:44`, `e2e/sim-citywide.spec.ts:32`, `e2e/fzp-sim.spec.ts:111`, `e2e/sim-details.spec.ts:14`, `e2e/map-key.spec.ts:43`, `e2e/perf/first-month.perf.spec.ts:11`, `e2e/bench/sim-timeline.bench.ts:127`, `:208`, `:321`, `:359`.
- `gotoHydrated(page, '/sim')`: `e2e/game-journey.spec.ts:159`, `:178`, `e2e/game-shell.spec.ts:35`.
- Default-path helpers `gotoSim(page, path = '/sim')`: `e2e/sim-funding.spec.ts:87`, `e2e/sim-share.spec.ts:58`, `e2e/game-sim.spec.ts:55`, `e2e/sim.spec.ts:67`, `e2e/sim-timeline.spec.ts:71`; explicit `'/sim'` at `e2e/sim-share.spec.ts:110`, `:177`, `:391`.
- `const FZP_PATH = '/sim'`: `e2e/fzp.spec.ts:130`.
- Path lists `['/', '/sim']`: `e2e/pages-a11y.spec.ts:16`, `e2e/layout.spec.ts:496`, `:898`, `:1046`, `e2e/chrome-dark.spec.ts:213` (and `:222`), `e2e/map-key.spec.ts:637`.
- `href` expectation: `e2e/game-shell.spec.ts:79-81`.
- `e2e/auth-a11y.spec.ts:191` goes to `/sims` (a 404 check, not `/sim`).

Callers of the `gotoSim`/`FZP_PATH`/`headerLink` helpers, by file (lines include the definitions):
- `e2e/chrome-dark.spec.ts`: 42, 72, 128, 215, 264, 292, 308, 335, 355, 366, 409, 433, 443, 499, 527
- `e2e/fzp.spec.ts`: 104, 130, 135, 245, 570, 588, 600, 604
- `e2e/game-sim.spec.ts`: 55, 186, 220, 233, 265, 281, 316, 325, 339, 348
- `e2e/map-key.spec.ts`: 41, 98, 138, 197, 503, 529, 566, 579, 645, 672
- `e2e/sim-activity.spec.ts`: 14, 54, 76, 103, 158, 215, 278, 338, 370
- `e2e/sim-citywide.spec.ts`: 30, 51, 61, 79, 112, 119
- `e2e/sim-details.spec.ts`: 12, 32, 71, 93, 108
- `e2e/sim-funding.spec.ts`: 87, 198, 217, 235, 255, 288, 303, 342, 381, 410, 475, 541, 645, 651
- `e2e/sim-halos.spec.ts`: 33, 52, 67, 116
- `e2e/sim-pools.spec.ts`: 15, 50, 107, 138, 175, 214
- `e2e/sim-share.spec.ts`: 58, 110, 177, 243, 276, 391, 411
- `e2e/sim-timeline.spec.ts`: 71, 144, 160, 186, 212, 248, 294, 335, 361, 381, 395, 412, 489, 517
- `e2e/sim.spec.ts`: 67, 241, 258, 287, 313, 348, 368, 385, 397, 417, 431, 454, 485, 498, 514, 535, 618, 642, 665, 730, 754, 772, 801, 821, 840, 849, 866, 886, 905, 911, 938, 986, 1007, 1018, 1063, 1072, 1099, 1115, 1126, 1135, 1167, 1183, 1188, 1202, 1231, 1355, 1400, 1449, 1480, 1497, 1529, 1546, 1577, 1611, 1658, 1677, 1700

Navigation through the header's step links and URL assertions:
- Clicks on the "Simulate" link: `e2e/sim-funding.spec.ts:665`, `e2e/fzp-sim.spec.ts:74`, `e2e/sim-activity.spec.ts:238`, `e2e/sim.spec.ts:1262`, `e2e/fzp.spec.ts:570`, `:588`, `:600` (via `headerLink(page, 'Simulate')`).
- Expectations on the steps: `e2e/game-journey.spec.ts:79-80`, `e2e/game-shell.spec.ts:30`, `:57-58`, `:79`, `:83`, `:101-102`, `e2e/chrome-dark.spec.ts:92`, `e2e/layout.spec.ts:759`, `:934`, `:1001`, `e2e/sim.spec.ts:354-355`, `:1597`.
- `toHaveURL(/\/sim$/)`: `e2e/sim-funding.spec.ts:666`, `e2e/game-journey.spec.ts:100`, `e2e/game-shell.spec.ts:76`, `:158`, `e2e/sim-share.spec.ts:231`, `:374`, `e2e/fzp.spec.ts:200`, `:571`, `:589`, `:601`, `e2e/sim-activity.spec.ts:239`, `e2e/sim.spec.ts:1415`, `:1425`, `:1462`, `:1488`.
- `toHaveURL(/\/$/)` or the root URL: `e2e/share-states.spec.ts:152`, `e2e/game-shell.spec.ts:124`, `e2e/fzp.spec.ts:605`, `e2e/game-sim.spec.ts:179`, `e2e/share-notices.spec.ts:235`, `e2e/share-roundtrip.spec.ts:77`.
- Site-name link click to go to `/`: `e2e/transit.spec.ts:81`.

To `/` (Paint), 127 matching lines of `page.goto('/')`, `gotoHydrated(page, '/')` and the helper `gotoEditor` (defined `e2e/helpers/sharing.ts:115-116`: `await page.goto('/')`). By file, the matching lines (they include import lines that name `gotoEditor`):
- `e2e/about.spec.ts`: 4, 50
- `e2e/bench/map-pan.bench.ts`: 23; `e2e/bench/map-timeline.bench.ts`: 128
- `e2e/brush.spec.ts`: 14, 30, 31, 139, 155, 173, 200, 221, 232, 257, 300, 325, 341, 404, 420
- `e2e/chrome-dark.spec.ts`: 22, 63, 89, 103, 110, 140, 150, 171, 193, 214, 253, 466, 482
- `e2e/compositions.spec.ts`: 2, 7
- `e2e/fzp.spec.ts`: 599
- `e2e/game-journey.spec.ts`: 16, 74; `e2e/game-save.spec.ts`: 65, 99; `e2e/game-shell.spec.ts`: 11, 68
- `e2e/headers.spec.ts`: 8
- `e2e/helpers/sharing.ts`: 115, 116
- `e2e/layout.spec.ts`: 22, 75, 77, 246, 291, 312, 358, 373, 416, 459, 503, 558, 581, 608, 628, 643, 674, 685, 727, 793, 1080, 1145
- `e2e/map-key.spec.ts`: 16, 253, 285, 349, 407, 447, 602, 644
- `e2e/map.spec.ts`: 40, 101, 270, 570, 613, 651, 701, 726, 760, 788, 803, 834
- `e2e/pages-a11y.spec.ts`: 67
- `e2e/perf/brush-commit.perf.spec.ts`: 9, 27; `e2e/perf/loaded-500.perf.spec.ts`: 4, 21
- `e2e/scoreboard.spec.ts`: 12, 52, 92, 134, 174, 187, 203, 212
- `e2e/share-a11y.spec.ts`: 7, 47, 68; `e2e/share-notices.spec.ts`: 11, 170; `e2e/share-roundtrip.spec.ts`: 9, 23
- `e2e/share-states.spec.ts`: 8, 60, 82, 105, 121, 142
- `e2e/sim-citywide.spec.ts`: 126
- `e2e/targets.spec.ts`: 8, 258, 278, 368, 390, 427
- `e2e/timelapse-render.spec.ts`: 10, 166, 168
- `e2e/transit.spec.ts`: 6, 22, 38, 45, 59

Forms among those 127 (V): `await gotoEditor(page);` 85, `await page.goto('/');` 11, `gotoEditor,` in an import list 10, the rest single imports, definitions and variants.

---

## (e) The About page and dialog

The page (`src/routes/about/+page.svelte:29-32`) and the dialog (`src/lib/about/AboutDialog.svelte:194-204`) mount the same four parts; the page at heading level 2, the dialog at 3 (V). The dialog is mounted only by `src/lib/timeline/TimelineMode.svelte:1878` (V, grep), so it exists on `/sim` and `/s/<id>`. All the words are in `src/lib/about/copy.ts`.

Passages on levels, bars, saved games, Paint and Simulate (V unless marked):

| What | File:lines | Text or content |
| --- | --- | --- |
| Element ids for Levels and Saved games | `src/lib/about/copy.ts:15-23` | `levels: 'about-levels'`, `savedGames: 'about-saved-games'`, also `using`, `shortcuts` |
| Intro | `src/lib/about/copy.ts:27-28` | "I built this to show what zoning, permitting and public money could do for housing in San Francisco." |
| Term "Room for N homes" (Paint's number) | `src/lib/about/copy.ts:46`; body from `src/lib/paint/details.ts:17-20` | "Every eligible lot you painted, rebuilt to its height at once." "Homes in replaced buildings are subtracted." |
| Term "Homes by a date" (simulation) | `src/lib/about/copy.ts:47-50` | "Homes the forecast completes from today to that month, net of homes removed. It holds today's market." |
| Term "From your policy" | `src/lib/about/copy.ts:51-54` | "The forecast runs twice, with your policy and under current law. This is the difference." |
| Term "Current law" | `src/lib/about/copy.ts:55-58` | |
| Term "The goal" | `src/lib/about/copy.ts:59-67` | built from `GOAL_BASE`, `WINDOW_MONTHS`, `RHNA_DEADLINE` |
| Term "The goal + N%" | `src/lib/about/copy.ts:68-71` | |
| Term "To beat" (the bar) | `src/lib/about/copy.ts:72-75` | "The month you reached the goal when you last levelled up. Reach the goal in an earlier month to win the level." |
| The five levels | `src/lib/about/copy.ts:83-90` (`LEVELS`) | "Level 1: paint room for the goal. Winning opens the simulation." / "Level 2: play current law to the goal." / "Level 3: change permitting, and beat the month you reached at level 2." / "Level 4: change zoning too, and beat your month to beat." / "Level 5: add the public money on offer, and beat your month to beat." |
| Level notes (bars, levelling up) | `src/lib/about/copy.ts:92-96` (`LEVEL_NOTES`) | "Levelling up is your choice. Your policies stay, and the clock goes back to today." / "A month to beat keeps the data it was earned on. ..." / "A published policy plays in full for everyone, whatever their level." |
| Saved games | `src/lib/about/copy.ts:98-102` (`SAVED_GAMES`) | "Each saved game has its own level, months to beat, plan and policy. You can keep ${MAX_SAVES}." / "Remix makes a new saved game from a published plan or policy, at your current level." / "Games are saved in this browser, and to your account from your first win." |
| Your plans | `src/lib/about/copy.ts:78-81` (`YOUR_PLANS`) | published plans and policies are public and permanent; a reopened plan uses current data |
| Rendering: Levels section | `src/lib/about/AboutUsing.svelte:47-57` | `<section id="about-levels">`, heading "Levels", `<ol>` of `LEVELS`, paragraphs of `LEVEL_NOTES` |
| Rendering: Saved games section | `src/lib/about/AboutUsing.svelte:59-64` | `<section id="about-saved-games">`, heading "Saved games" |
| Rendering: Your plans | `src/lib/about/AboutUsing.svelte:66-69` | |
| Shortcut tables captioned "Painting" and "Timeline" | `src/lib/about/AboutUsing.svelte:16-19`, `:27-45` | rows from `src/lib/brush/shortcuts.ts:106-116` (`SHORTCUTS`) and `src/lib/timeline/shortcuts.ts:8-15` (`TIMELINE_SHORTCUTS`) |
| Rendering: the terms | `src/lib/about/AboutMeanings.svelte:12-30` | a `<dl>` of `MEANINGS` |
| "The simulation's comparison estimates ..." | `src/lib/about/AboutData.svelte:107-108` | a data credit, not a game passage |

Neither the page nor the dialog uses the words "Simulate" or "1 Paint"/"2 Simulate"; the step names appear only in the header (V for `src/lib/about/copy.ts`, `AboutUsing.svelte`, `AboutMeanings.svelte`, `AboutDialog.svelte`, read in full; `AboutAssumptions.svelte` and `AboutData.svelte` by grep for `level|paint|simulat|saved game|bar|to beat|/sim`, which found only the `AboutData.svelte:107` line and unrelated `level` props).

Links into those passages (V, grep for `ABOUT_ID` outside `src/lib/about`): `src/lib/paint/PaintDetails.svelte:101` links `/about#about-meanings`. No production code links `about-levels` or `about-saved-games`; `src/routes/about/page.svelte.spec.ts:9` lists them as subsections.

Doc: `docs/dev/about.md:18`, `:30-36` describe the same structure and agree with the code (V for those lines only; the file was not read in full).

---

## (f) Footer, skip link and `<main>` in the root layout

`src/routes/+layout.svelte` (V, whole file read, 70 lines):

- `const full = $derived(isFullHeightRoute(page.route.id));` (`:33`). This one boolean decides everything below.
- **Skip link**: always rendered, first in the body, unconditional (`:43-47`): `<a href="#main" class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-white focus:px-3 focus:py-2">Skip to content</a>`.
- **Wrapper** (`:51-53`): `full ? 'flex h-dvh flex-col overflow-hidden dark:scheme-dark' : 'flex min-h-dvh flex-col'`.
- **Header**: always rendered (`:54-61`): `SiteHeader` with `actions`, `pinned`, `status` from the `HeaderActions` instance (`?? undefined`), `user={currentUser.overlay(page.data.user)}`, `signInAvailable={page.data.signInAvailable ?? true}`, `routeId={page.route.id}`.
- **`<main>`**: always rendered (`:62-68`): `<main id="main" tabindex="-1" class={full ? 'min-h-0 flex-1' : 'mx-auto w-full max-w-3xl flex-1 px-4 py-6'}>` holding `{@render children()}`.
- **Footer**: `{#if !full}<SiteFooter />{/if}` (`:69`). So the footer shows on every route for which `isFullHeightRoute` is false, including error pages for unknown paths (I: `page.route.id` is `null` there, and `isFullHeightRoute(null)` is false, `src/lib/shell/layout.spec.ts:11`).
- `SiteFooter` (`src/lib/shell/SiteFooter.svelte:5-13`, V): a `<nav aria-label="Footer">` with links About (`/about`), "Data & licences" (`/about#about-data`), "Source code (GitHub)" (`REPO_URL`).
- The layout also provides the header-actions context (`:17`) and the game store (`:19-32`): `openGame()` on the server and under the e2e seam, else a `GameStore` with storage and save sync.
- `:38-40`: under `VITE_E2E === '1'` it sets `document.documentElement.dataset.hydrated`.

Doc vs code: `CLAUDE.md:101` ("the root layout renders the skip link, header and `<main>`, and the footer on document routes only") agrees with the code (V).

---

## Appendix

### Files read in full

- `src/lib/shell/SiteHeader.svelte`, `header-actions.svelte.ts`, `LevelCell.svelte`, `layout.ts`, `layout.spec.ts`, `SiteFooter.svelte`, `ui.ts`, `SiteHeader.ssr.spec.ts`
- `src/lib/shell/test/ActionsChild.svelte`, `Host.svelte`, `LevelCellHost.svelte`, `HeaderScoreHeader.svelte`, `SimRowHeader.svelte`, `SimRowGameHeader.svelte`
- `src/routes/+layout.svelte`, `+layout.server.ts`, `+page.svelte`, `+page.ts`, `+error.svelte`
- `src/routes/sim/+page.svelte`, `+page.ts`, `test/GameSimHost.svelte`, `test/SimPageHost.svelte`
- `src/routes/p/[id]/+page.server.ts`, `+page.ts`, `+page.svelte`, `+error.svelte`, `test/PageHost.svelte`
- `src/routes/s/[id]/+page.server.ts`, `+page.ts`, `+page.svelte`, `+error.svelte`, `test/PageHost.svelte`
- `src/routes/test/page-worker.ts`, `PageHost.svelte`, `PaintHeaderHost.svelte`
- `src/routes/about/+page.svelte`, `+page.server.ts`; `src/routes/attribution/+page.server.ts`
- `src/lib/about/AboutUsing.svelte`, `AboutMeanings.svelte`, `AboutDialog.svelte`, `copy.ts`, `links.ts`, `land.ts`, `credits.ts`
- `src/lib/attribution.ts`, `src/lib/config.ts`, `src/lib/config.spec.ts`, `src/app.html`, `README.md`, `wrangler.jsonc`
- `src/lib/server/email-templates/`: `copy.ts`, `Layout.svelte`, `LinkActionEmail.svelte`, `render.ts`, `sign-in.ts`, `reset-password.ts`, `change-approve.ts`, `confirm-email.ts`, and the four `*.spec.ts`
- Outside scope, read because the scope depends on them: `src/lib/server/auth/brand.ts`, `src/lib/game/navigate.ts`, `src/lib/sim-page/SimRoute.svelte`, `src/lib/paint/headline.ts`, `src/lib/account/safe-redirect.ts`

### Files read in part

- `docs/superpowers/specs/2026-11-24-incremental-feel-design.html` (as stripped text, first 260 non-blank lines; the tail may be cut)
- `package.json` (lines 1-20, plus a grep for `description|name|homepage|repository`)
- `src/lib/about/AboutData.svelte` (lines 96-112, plus grep), `src/lib/about/AboutAssumptions.svelte` (grep only)
- `src/lib/shell/Message.svelte`, `NoticePills.svelte`, `more-below.ts`, `test/seeded-game.ts`, `test/rest-text.ts` (first 14 lines each)
- `src/lib/shell/SiteHeader.svelte.spec.ts`, `LevelCell.svelte.spec.ts` (test names and grep hits only)
- `src/routes/account/+page.server.ts` (28-52), `signin/+page.server.ts` (16-42), `forgot-password/+page.server.ts` (8-14), `reset-password/+page.server.ts` (18-27); their `+page.svelte` files by grep for imports, title and `<h1>`
- All `+server.ts` files: the exported handler lines only
- `src/lib/timeline/TimelineMode.svelte` (1495-1510, 1540-1629, 1712-1724), `src/lib/timeline/TimelineHeaderScore.svelte` (1-125), `src/lib/sim-page/SimPage.svelte` (1155-1200, 1245-1275), `src/lib/sim-page/load.ts` (1-54), `src/lib/game/LevelPanel.svelte` (1-60, 180-296), `src/lib/game/copy.ts` (1-89), `src/lib/game/store.svelte.ts` (788-807 and grep), `src/lib/game/allowed.ts` (76-82), `src/lib/game/progress.ts` (32-38), `src/lib/game/e2e.ts` (2-13), `src/lib/server/sharing/shared-page.ts` (1-93), `src/lib/sharing/copy.ts` (90-145 and grep), `src/lib/sharing/SharedBanner.svelte` (60-80), `src/lib/timeline/game-copy.ts` (43-47), `src/lib/paint/details.ts` (17-20), `src/app.d.ts` (11-27)
- `e2e/helpers/sharing.ts` (100-125), `e2e/helpers/chrome.ts` (36-75), `e2e/pages-a11y.spec.ts` (8-48)
- `docs/dev/about.md`, `docs/dev/sim-page.md`, `docs/dev/fzp-mode.md`, `docs/dev/game.md`, `docs/dev/developing.md`, `docs/dev/deploy.md`: grep hits only
- `CLAUDE.md`: as given in the session context, plus grep hits

### Directories listed

`src/routes` (recursive, all files and directories), `src/lib/shell` (recursive), `src/lib/about` (recursive), `src/lib/server/email-templates`, `src` (top level), `src/lib` (top level), the repository root, `e2e`, `e2e/helpers`, `e2e/bench`, `e2e/perf`. `static/` was looked for and does not exist.

### In scope and NOT examined

- `src/lib/shell/`: `accent.spec.ts`, `header-actions.svelte.spec.ts`, `Message.svelte.spec.ts`, `more-below.svelte.spec.ts`, `NoticePills.svelte.spec.ts`, `SiteFooter.svelte.spec.ts`, `ui.spec.ts`, `test/MessageHost.svelte`, `test/MoreBelowHost.svelte`, `test/NoticePillsHost.svelte`, `test/seeded-game.svelte.spec.ts` were not opened. `Message.svelte`, `NoticePills.svelte`, `more-below.ts` and the bodies of `SiteHeader.svelte.spec.ts` and `LevelCell.svelte.spec.ts` were not read beyond what is listed above.
- `src/routes/layout.css` was not read (one grep for `breakpoint`). `src/routes/layout.server.spec.ts` was not opened.
- Route specs were not read beyond grep hits: `src/routes/page.spec.ts`, `page.svelte.spec.ts`, `page.game.svelte.spec.ts`, `page.header.svelte.spec.ts`, `page.rest-text.svelte.spec.ts`, `page.undo.svelte.spec.ts`, `page.view.svelte.spec.ts`; `src/routes/sim/page.spec.ts`, `page.svelte.spec.ts`, `game.svelte.spec.ts`; `src/routes/p/[id]/page.server.spec.ts`, `page.view.svelte.spec.ts`; `src/routes/s/[id]/page.server.spec.ts`, `page.spec.ts`, `page.view.svelte.spec.ts`.
- `src/lib/about/`: `AboutAssumptions.svelte` and `AboutData.svelte` bodies; `AboutAssumptions.svelte.spec.ts`, `AboutDialog.svelte.spec.ts`, `AboutParts.svelte.spec.ts`, `credits.spec.ts`, `links.spec.ts`, `test/AboutDialogHarness.svelte` (grep hits only).
- `src/lib/attribution.spec.ts` was not opened.
- `package.json` beyond line 20 was not read; the absence of `description` rests on a grep.
- Route directories outside the named scope (`about`, `account`, `signin`, `forgot-password`, `reset-password`, `attribution`, `api/**`, `data/**`): load and handler lines only; page markup, actions and handler bodies were not read.
- The site-name and navigation censuses are grep results. For the name census I read all 84 matching lines. For the `/sim` and `/` censuses I read the matching lines for `src`, and for `e2e` I read the `/sim` literal lines but took the 127 `/` lines and the helper-caller lines from grouped output without reading each line's text. Navigation written in a form my patterns do not match (a path built from parts, a variable holding `'/sim'` other than `FZP_PATH`, `SIM.startHref`, `gameHref`) may be missing.
- Whether the deployed `SES_FROM` vars, the Google Auth Platform app name, or any Cloudflare setting match the files was not checked; no remote system was queried.
- `hooks.server.ts`, `hooks.client.ts`, `svelte.config.js`: grep only (for `fzp`, `lesscars`, redirects, `csp`).
- The graphify code graph was not used; all searches were ripgrep over the worktree.
