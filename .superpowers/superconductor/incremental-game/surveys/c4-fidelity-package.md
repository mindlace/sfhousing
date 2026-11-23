# C4 fresh-eyes check: `remove-multiuser`, `mail-setup`, `closing`, and the whole package

uncovered: [32]
multiply_covered: [21]

Reviewer read: the design doc in full; the ledger in full; `remove-multiuser`, `mail-setup` and `closing` in full (their own sections); for the other nine specs, `sec-goal`, `sec-write-set*`, `sec-tests*`, `sec-out-of-scope`, plus the sections a seam pointed into (`game-shell` design, `game-sim` level-up and bar, `game-save` offer/methods/e2e, `finite-funding` page and federal, `funding-measures` dates and federal, `pool-closing` money view). Code read on `8125e557` where a finding depends on it.

## Findings

| id | sev | spec / section | finding | evidence | proposed fix |
|---|---|---|---|---|---|
| F1 | blocker | `game-sim` sec-tests-e2e; `game-shell` sec-tests-component | The two units run in parallel (both only "after `game-core`"), but each one's tests need the other's work. `game-sim`'s e2e presses "Level up" in the header level cell, which `game-shell` builds. `game-shell`'s `/s/<id>` test opens "a policy holding a given measure", which today's schema 4 parser refuses until `game-sim` changes `parse4.ts`. An operator who wants green tests will edit the other unit's file. | `game-sim`: "the level cell's panel offers 'Level up', and pressing it returns the playhead to today". `game-shell`: "Level 3 with a policy holding a given measure: 'Level 5 runs all of it'". `src/lib/timeline/parse4.ts:272` (`if (r.preset !== null) fail(..., 'expected null')` for money). | Move G3's parser rule (money `preset` accepted) into `game-core` or `contracts`, or have `game-shell`'s test build the document in memory. Drop the level-cell step from `game-sim`'s e2e (the win card's "Level up" covers it), or order `game-sim` after `game-shell` and say so in `tbl-write-sets`. |
| F2 | major | `finite-funding` sec-design-pool-page / write set; `funding-measures` sec-tests-e2e | `finite-funding` removes the "no limit" text (`NO_LIMIT`). `e2e/sim-funding.spec.ts` imports `NO_LIMIT`, and `svelte-check` covers `e2e/**`, so `finite-funding`'s required `npm run check` fails. The design gives that e2e file only to `funding-measures` ("edited only by the unit named for it"), and `funding-measures` plans to drop the import only after `finite-funding` merges. | `e2e/sim-funding.spec.ts:19,200`; `src/lib/sim-page/funding-copy.ts:116`; `tsconfig.json` includes `e2e/**/*.ts`; `funding-measures`: "test 1a: ... the `NO_LIMIT` import goes". | Put `e2e/sim-funding.spec.ts:19,200` in `finite-funding`'s write set (the lines that read `NO_LIMIT`), and remove test 1a's change from `funding-measures`. Alternatively, `finite-funding` keeps exporting `NO_LIMIT` until `funding-measures` removes it. |
| F3 | major | `closing` sec-design-sweep, sec-docs-claude | `closing` treats `MUTATION_REGISTERED_RL` as a removed name. The sweep greps for it, and a hit in code is "a defect of the unit that removed the name". CLAUDE.md's bindings are "expected five" without it. But `remove-multiuser` keeps the binding and `game-save` reads it to guard saved-game writes, so the sweep reports `wrangler.jsonc` and `game-save`'s routes as defects, and the expected doc text is wrong. | `closing`: `git grep ... 'SimObject\|...\|INVITE_RL\|MUTATION_REGISTERED_RL'`; "expected five: `PUBLISH_RL`, ... `ACCOUNT_EDIT_RL`". `remove-multiuser` sec-design-config: "`MUTATION_REGISTERED_RL` stays"; `game-save`: `enforceRate(MUTATION_REGISTERED_RL, 'game_write:' + identityId, env)`. | Remove `MUTATION_REGISTERED_RL` from the sweep. In the CLAUDE.md item, expect six rate limits, with `MUTATION_REGISTERED_RL` for saved-game writes. |
| F4 | major | `closing` sec-design-journey | The journey calls `seedGoalAmount(page, SIM_AMOUNT)` and then presses "Level up" on Paint, expecting "the page loads `/sim`". But `seedGoalAmount` is a Playwright init script, which runs only on a document load, and `game-shell`'s Paint uses `goto('/sim')`, a client-side navigation. So `/sim` reads the stale `PAINT_AMOUNT` of 1, level 2 is won in the first month, and `SIM_AMOUNT` ("won after some play") has no effect until the later reload. | `contracts` X1: "`seedGoalAmount(page, amount)` adds an init script that sets `E2E_GOAL_KEY` ... before every document load". `game-shell` sec-design-paint: "Paint calls `goto('/sim')`". | In the journey, set the amount with `page.evaluate(() => localStorage.setItem(E2E_GOAL_KEY, ...))` before pressing Level up, or reload `/sim` after landing and before playing. Alternatively, `game-shell` uses a full load (`location.assign`). |
| F5 | major | `mail-setup` sec-design-rules, sec-design-prod; `closing` sec-goal | The owner may ask that the production secrets wait "until the build is on main". `closing` runs "after every other unit" and is the only unit that gets the build to main (through signoff). If the owner says wait, the run deadlocks, and the spec says nothing about what the operator does then. | `mail-setup`: "may ask for the production secrets to wait until the build is on main; the operator asks before setting them on production." Design `tbl-write-sets`: `closing` "After every other unit". | State the deferred path: `mail-setup` hands back complete after the staging proof, with the production steps written under Remaining in the bootstrap checklist. The production steps (step 7) then run after the merge, as a follow-up the conductor tracks. `closing` must not wait for them. |
| F6 | major | `mail-setup` sec-design-rollback, sec-docs-mail ("Rotating one environment's key") | The rotation runbook is wrong in two ways. (1) IAM allows at most two access keys per user. The unit leaves two active keys (staging and production), so "create a key with the step 5 command" fails with `LimitExceeded`. (2) The single-environment rollback hard-codes `Tags[?Value=='production']`, so following it for staging (with `--env staging`) deletes the production key. During a rotation, both the old and the new key carry the same environment tag. | `mail-setup` sec-design-after: "two `Active` keys". Rollback: `aws iam list-user-tags ... --query "Tags[?Value=='production'].Key"`. | Use one IAM user per environment (`sfhousing-mail-staging`, `sfhousing-mail-production`, same policy), or document rotation as "delete the old key, then create the new one", with the short outage stated. Parameterise the environment in the rollback query, and pick the key by its id, read from `wrangler`'s current value or the tag, never by the environment tag alone. |
| F7 | minor | `remove-multiuser` sec-today-platform | Says "The D1 migrations create 14 tables". They create 15: nine identity tables, `plan`, and five that are dropped. | `grep -ho "CREATE TABLE [^ (]*" migrations/d1/*.sql \| sort -u` gives 15. | Change it to 15. |
| F8 | minor | design sec-global-constraints; `remove-multiuser` sec-design-config | The global constraint says "This build makes one [CSP change]: `remove-multiuser` removes whatever the sim socket needed". The spec says, correctly, that `svelte.config.js` is unchanged because `connect-src 'self'` never held anything for the socket. The constraint promises a change that does not exist. | `svelte.config.js:16` `'connect-src': ['self']`. | Reword the constraint: "This build makes no CSP change." |
| F9 | minor | `closing` sec-design-sweep | The sweep will flag tests that `remove-multiuser` is told to write or keep, and report them as defects: the session-gate cases "`/sims`, `/api/sims/abc/members` ... are not session routes", the new 404 checks in `e2e/auth-a11y.spec.ts`, and `src/lib/account/safe-redirect.spec.ts:6,9` (`'/sims/abc'`), which no spec lists. | The pattern `"[\"'\`( ]/(sims\|invite\|fzp\|lesscars)\b\|api/(sims\|invites\|operator)\b"`; `remove-multiuser` sec-tests-changed and sec-tests-e2e. | Add to the allowed places: tests that assert a removed path answers 404 or is not a session route. Give `safe-redirect.spec.ts` a neutral path (in `remove-multiuser`'s write set). |
| F10 | minor | `closing` sec-design-finish | "This unit's own changes touch no hashed path" does not hold. Leftovers rewrite "a comment in any file" that names removed things, and `pipeline/**` is hashed. A pipeline comment edit changes `<v>` and falls under the global rule "a unit that writes a hashed path regenerates the fixture". The finish order still builds after the edits, so the upload is correct, but the fixture rule is not addressed. | `pipeline/lib/version.ts:41-52` `PATHS` includes `pipeline`. | Say that comment edits under `PATHS` change `<v>`, and that the fixture is regenerated (or confirmed byte-identical) after them. |
| F11 | minor | `closing` sec-design-finish | "If `dataset-version.ts --check` exits 0, `<v>` is already published: skip to step 11" skips the level 2 check. For a re-run that is harmless. In general it lets a published version past D1 unchecked. | `closing` finish, bullet 5. | Run the level 2 check on every path, including when `<v>` is already published (fetch it with `data:local` if needed). |
| F12 | minor | `closing` sec-docs-pipeline / sec-docs-claude; G4 | D1 holds for future datasets only through a doc step. `pipeline upload` does not run the check, and chreode's `dataset` step does not either. A later data update can upload a dataset on which current law misses. | `closing`: "Conventions, a new item: a dataset is uploaded only after ... exits 0". | Question for the composer: have `pipeline -- upload` refuse unless `level2-check` exits 0 on the same directory, or add the check to chreode's `dataset` rule. |
| F13 | minor | `closing` sec-design-journey | `SIM_AMOUNT` is "the homes current law reaches on `fixture-0` at month 60, read ... with `runEmptyDocument` and `readLevel2`". `readLevel2` returns only `homesAtDeadline`, so month 60 cannot be read from its outputs. | `Level2Result` fields. | Say how to read it: `goal.measure.valueAt(run.view, 60)`, or export a helper. |
| F14 | minor | `closing` sec-docs-claude | The expected `pipeline` command list omits `boxes`, which `remove-lesscars` keeps. | `remove-lesscars` sec-design-pipeline: "`doctor`, ..., `quality-doc`, `boxes` and `all`". | Add `boxes`. The "cli.ts wins" rule already covers it, but the expectation should be right. |
| F15 | minor | `closing` sec-today-leftovers / sec-design-leftovers; `game-shell` sec-design-paint, sec-out-of-scope; `game-sim` sec-design-other | `closing` expects `sfhRemix` and `sfhSimRemix` to have no reader after `game-shell` and `game-sim` and removes them from `app.d.ts`. Both units keep their readers ("kept as it is; nothing sends one any more"), so the types stay, and no unit removes the dead hand-off code. `game-shell` also calls them "unused" while keeping the reader. | `game-shell`: "The Remix hand-off on Paint (`page.state.sfhRemix`) is kept as it is"; "The unused `sfhRemix` and `sfhSimRemix` types: removed by `closing`". `game-sim`: "kept as it is ... unused in the app". | Either `game-shell` and `game-sim` delete their hand-off readers (then `closing` removes the types), or `closing` is told the readers stay. |
| F16 | minor | `mail-setup` sec-design-dns, sec-design-wait, sec-design-proof | The owner steps are clear: the six records, the test address, the `Authentication-Results` lines, following the link, the production go-ahead and Google. How the operator waits is only "ends its turn ... reads the state again when it is next prompted". Operators run as conducted sessions, and nothing says who relays the owner's inputs or how a hand-back mid-runbook resumes. | `mail-setup` §2, §3, §6. | Name the relay: the operator hands back with a stated "waiting on owner: X" and is resumed by the conductor with the owner's answer. Name which hand-backs are partial and which are final. |
| F17 | minor | `remove-multiuser` sec-design-locals | Text about the past: "It no longer reads `BOOTSTRAP_EMAILS`". | `remove-multiuser` sec-design-locals. | Change it to "It reads no capability and no `BOOTSTRAP_EMAILS`." |
| F18 | minor | `remove-multiuser` sec-write-set | The row says "the multi-user e2e specs and helpers", but the unit edits account specs that are not multi-user: `account-deletion`, `auth-a11y`, `auth-methods-default`, `email-link`, `sign-out`, `account-a11y`, `password-auth`, `account-email`, and `e2e/helpers/account.ts`. Under "edited only by the unit named for it", the row should name them. | `remove-multiuser` sec-write-set-changed. | List those files in `tbl-write-sets`'s `remove-multiuser` row. |
| F19 | minor | `contracts` sec-write-set | Creates `e2e/game-helpers.spec.ts`, which is outside its row (the row names `e2e/helpers/game.ts` only, and this is not a test beside a file). | `contracts` "Created". | Add it to the `contracts` row. |
| F20 | minor | `funding-measures` sec-write-set; `game-sim` row | `funding-measures` writes `src/lib/timeline/copy.spec.ts`. The design's `game-sim` row covers `src/lib/timeline/**` except `pool-level.ts` and `copy.ts`'s funding sentences, so the spec falls in `game-sim`'s row, and the two units run together. `game-sim` lists no change to it, so this is a row overlap, not a collision. | `tbl-write-sets` `game-sim` row; `funding-measures` "Tests and helpers changed beside them". | Add "and `copy.spec.ts`'s funding cases" to the exception in `game-sim`'s row. |
| F21 | minor | `funding-measures` sec-out-of-scope | Two items are handed to units that do not take them. "The span bar's 'no end' edge text in `src/lib/timeline/rows.ts`: `game-sim`": `game-sim`'s files do not include `rows.ts`. "Drawing a closed pool's bar as empty: `pool-closing`": `pool-closing` writes no timeline file and says a timeline marker belongs to no unit. | `game-sim` sec-write-set-files; `pool-closing` sec-out-of-scope. | Decide each: give the closed-pool bar to `funding-measures` (`pool-level.ts`) or drop it, and say whether the "no end" edge text changes at all (D3: "Everything a player adds has an end"). |
| F22 | minor | `funding-measures` sec-design-dates; design `sec-subsystems` and `tbl-write-sets` | `funding-measures` "Needs F2 and G3", and `dateMeasure` returns its policy "when it is not a given measure (G3)". If it calls `isGiven`, that is a throwing stub until `game-core` merges, yet the write sets order `funding-measures` only after `finite-funding`. | Design: `funding-measures` "Needs F2 and G3"; contracts: G3 functions throw "not implemented". | Say that `dateMeasure` tests `policy.preset` and the money kind inline, or order `funding-measures` after `game-core`. |
| F23 | minor | `finite-funding` sec-design-pool-page; `funding-measures` sec-design-federal | Both specs build the federal group's dated change as "Amount, % of today's" (removing the on/off fieldset), and both define a group's yearly amount (the year from `asOf`, `once` and `yearly` alike). Their scale-line texts also differ: "Federal tax credits: 150% of today's from July 2028" against "From {Month Year}: {p}% of today's amount". This is the duplicate behind traceability row 21. | The two sections. | Keep it in `finite-funding` (the federal editor is part of removing `uncapped`). Have `funding-measures` point to it and change only what is new. |
| F24 | minor | `finite-funding` and `funding-measures` sec-out-of-scope | The two November 2026 measures are handed back and forth. `finite-funding` gives them to "`funding-measures`, once certified". `funding-measures` gives them to "a later change once the results are certified". | Both out-of-scope lists. | Use one wording: "a later change, no unit in this build". |
| F25 | minor | design `sec-subsystems` (`game-shell` line) | The line says "the root layout providing the store". G2 and `tbl-write-sets` give that script to `game-core`, and `game-shell`'s spec says it changes nothing in the layout. | Design `sec-subsystems`. | Drop the phrase from `game-shell`'s line. |
| F26 | minor | design `sec-rulings-partner` R1; `sec-rulings-review` D12 | Two quotations are trimmed without marking. The ledger's D12 is "eh let's have passkeys too", and the design gives "Let's have passkeys too". R1 in the ledger starts "and I want ...". | Ledger lines 74 and 90. | Quote exactly, or mark the elision. |
| F27 | minor (question) | design `sec-rulings-second` D5 | Sentences after the owner's D5 quotation are the composer's reading, presented under "Yours": "Publish sends the policies that ran" and "A saved game, including one made by Remix, runs only the policies its level has unlocked". The owner's words address playback and remix, not publish. Sending the playable document narrows "retaining the ability for people to publish their solutions": a player at level 3 who remixed a level 5 policy publishes without its money. The ledger says the reading was "told to the partner", not confirmed. | Ledger lines 97-99. | Mark the publish sentence as the composer's reading, or confirm it with the owner. |

## Per check

**1. Coverage.** `remove-multiuser` carries I1 completely in its own design and tests: `onFuse` and when it runs, `deleteAccount({db, identityId})` returning `{ more: false }`, the copy moved into `AUTH_COPY`, the gate's seven prefixes, and the locals. It also carries D10: published links are untouched, accounts are kept, and the five tables are dropped. `mail-setup` carries D12's mail half and every item of `sec-model-mail`. `closing` carries G4's build check, the journey, the one upload and the signoff. Rules carried by no spec, or by two, are in the traceability lists below and in F21 and F23.

**2. Contradictions.** Found: F3, F7, F8, F14, F15, F23, F24, F25. Checked and consistent: the `AUTH_METHODS` value (`game-save`, `closing`, `mail-setup`); the deploy.md mail-section boundary (`mail-setup` and `closing` state it identically); the DO migration tags; the session prefixes (I1's seven, then `/api/game` added by `game-save`, in order); the delete-account texts; the journey's lane texts against `game-sim`'s tests; "Beat {month}" against `game-core`'s `aimText`; the test ids used by the journey (all fixed by `game-core`, `game-shell` or `game-sim`).

**3. Signatures.** I1 as used in `remove-multiuser`'s own sections matches the design. `game-save`'s use of `handleAccountLink`'s `onFuse` and of `deleteAccount` is consistent with it. No remnants of `canLevelUp`, `HeaderLevel`, `opts.level`, `seedDefault`, `syncState`, `remix({ text })` or `Bound` in contracts appear in the three specs. `closing`'s check binds to real signatures: `createTimelineHost` deps, `viewOf`, `readGoal`, `defaultGoal`, `reconcilePolicy4`, `WINDOW_MONTHS`.

**4. Placeholders.** None in the three specs. There is no TBD, TODO or awaiting passage. Closing's "the code wins ... and reports the difference" in Docs is a stated rule, not a placeholder.

**5. Readability.** Every `<pre>` in all 13 documents has `data-lang` on its `<code>`. The one text about the past is F17. Closing's finish list is an `<ol>`, so its step numbers resolve.

**6. Fidelity.** See "Request and rulings" below. Quotations match the ledger except F26. One composer reading is presented as a ruling (F27).

**7. Delegation.** `mail-setup` decides every observable value: records, policy, commands, checks and stop conditions. It delegates nothing except F5 and F16. `remove-multiuser` decides its texts, statuses and migration. `closing` delegates doc wording to "the code wins", which is acceptable, and leaves one value to derive without a method (F13).

**8. Seams.** Found: F1 (cycle between `game-sim` and `game-shell`), F2 (`finite-funding` needs a file `funding-measures` owns), F4 (journey against Paint's navigation), F22 (`funding-measures` against G3 stubs). Checked and clean: `game-save`'s e2e needs only `game-core` and X1 (it seeds level 2 and loads `/`); `game-core`'s e2e runs on `/about`; the e2e server keeps `AUTH_METHODS=magic-link` pinned, so `game-save`'s four-method switch does not move existing account specs; `enforceRate` allows everything under `ENVIRONMENT=development`, so the journey and `game-save` e2e mints are not rate-limited.

**9. Evidence.** Spot-checked and correct:
- `remove-multiuser`: `hooks.server.ts:7`, `:53-61`; `app.d.ts:3-4`, `:12`, `:20-22`; `session-gate.ts:31-34`; `identity.ts:45`, `:129`, `:174`; `deletion.ts:110-117`, `:129-193`; `better-auth.ts:297-305`; `rate-limit.ts:40-55`; `profile/+server.ts:29-31`; `wrangler.jsonc:6-10`, `:31`, `:33-37`, `:51-52`, `:81`, `:87-91`; `account/copy.ts:30`, `:56`; `account-copy.ts:58-59`, `:67-68`; `api/account/+server.ts:35-44`.
- `mail-setup`: `provider.ts:19-24`, `:27-29`; `send.ts:38-43`, `:50-53`, `:86-96`; `methods.ts:17-24`, `:47-57`; `signin/+page.server.ts:57`; `wrangler.jsonc:12`, `:41-42`, `:54`, `:95-96`.
- `closing`: `host.ts:57`; `timeline-client.ts:29`; `view.ts:87`; `goal.ts:54-65`, `:91-103`; `reconcile4.ts:254-258`; `ensemble-measure.ts:148`, `:264-265`; `host.spec.ts:172-176`; `package.json:80`; `chreode.config.ts:46`, `:72`, `:87`; `app.d.ts:27`, `:30`; `CLAUDE.md:88`, `:102`; `pipeline.md:99`; `testing.md:44`; `pipeline.yml:3-12`.

The only error found is F7. Deletion lists against `git ls-files` match exactly, for all 17 directories (counts 25, 18, 19, 5, 13, 16, 10, 27, 7, 15, 4, 12, 4, 12, 4, 2, 2). A repo-wide grep for `sim-log|sim-store|sim-sync|sim-stream|$lib/members|server/{sims,invites,operator,authz}|sim-object|event-log|SimObject|SIM_TAKEDOWN_TOKEN|INVITE_RL|capability_event|simInvite|simControlPlane|pending-sim|BOOTSTRAP_EMAILS|SIMS_COPY|enforceMutationRate|reseedHandleFromSim|resolveCapabilities` finds nothing outside the spec's deleted or changed lists, `closing`'s docs and `chreode.config.ts:72` (assigned to `closing`), and the generated migrations. The DO deletion entry (`v2-delete-sim-object`, `deleted_classes`, kept `v1` entry, both environments, applied by `wrangler deploy` in both workflows, `deploy-*.yml:40-46`) is right.

## Traceability (rows numbered from 0, in table order)

Carriers are specs whose own design and tests build the row. "Halves" marks rows split between units as the table intends.

| # | Claim | Carried by |
|---|---|---|
| 0 | An unlock per win | game-core |
| 1 | Level 1 paint unlocks the sim | game-core (`paintWon`), game-shell (Paint win), game-sim (locked page): halves |
| 2 | Level 2 run to target | game-core, game-sim |
| 3 | Level 3 permitting, beat level 2 | game-core, game-sim |
| 4 | Level 4 zoning | game-core, game-sim |
| 5 | Level 5 given funding | game-core (`isGiven`), game-sim ("+", read-only what), funding-measures (finite presets, summary): halves |
| 6 | Levels 6-9 deferred | game-core (`levelNeeded` 6); out of scope |
| 7 | Opt-in levelling | game-core (offer, card), game-sim (offer on `/sim`), game-shell (cell, Paint): halves |
| 8 | Choices carry forward | game-core (`levelUp` changes progress only), game-sim (policies stay) |
| 9 | Clock returns to today | game-sim |
| 10 | Victory under one clock | game-sim (seen result), game-core (`standing`) |
| 11 | Goal always reachable | closing (check); game-core (`beats`) |
| 12 | Remix makes a saved game; pick among them | game-core (store, panel), game-shell (Remix buttons): halves |
| 13 | Published policy plays in full | game-sim (published view), game-core (`playable`, `levelNeeded`), game-shell (note): halves |
| 14 | Saves separate, default names | game-core, game-save: halves |
| 15 | Passkeys | game-save |
| 16 | Email sending via planafoot's AWS | mail-setup |
| 17 | Projects stop waiting | pool-closing |
| 18 | Locked rows visible | game-core (`lockedLane`), game-sim (lanes): halves |
| 19 | Goal one replaceable thing | Nothing new to build. game-shell and game-sim build the goal from `GOAL_BASE`/`defaultGoal` with an amount override, and test titles from the amount. |
| 20 | Finite pools, real ends | finite-funding (baseline), funding-measures (presets): halves |
| 21 | Federal yearly ceiling | finite-funding; **also** funding-measures builds the same federal editor and group-amount rule (F23) |
| 22 | Pool's bar drains | funding-measures |
| 23 | Funding yearly on purpose | finite-funding (inflows stay yearly) |
| 24 | Remove invitations / concurrent users | remove-multiuser |
| 25 | Keep publishing | game-sim (playable Publish), game-shell (remix) |
| 26 | Device-bound anonymous | game-save (mint at first win), game-core (localStorage store) |
| 27 | Username at each win screen | game-save (`AccountOffer`), game-core (`WinCard` renders it): halves |
| 28 | Email, password, Google | game-save (methods), mail-setup (mail): halves |
| 29 | Progress saved to account | game-save |
| 30 | Drop `/fzp`, `/lesscars` | remove-lesscars |
| 31 | Less cars returns as unlocks | remove-lesscars (keeps only what D11 names); deferred |
| 32 | Booms and busts are market conditions, never seeds | **None.** A global constraint only. `pool-closing`'s determinism section holds "one future" for its piece. No spec carries the market-conditions half (level 7, deferred). |
| 33 | Keep sims, narrowed by D10 | remove-multiuser |

## Request and rulings

| Clause | Where carried | Status |
|---|---|---|
| "convert this into an (educational) incremental game" | game-core, game-sim, game-shell; closing's CLAUDE.md and README text | carried |
| "retaining the ability for people to publish their solutions" | game-sim (Publish), global constraint | narrowed: Publish sends the playable document (F27) |
| start weak, unlock per win, "no big upgrade tree" | game-core `allowedAt`, `levelUp` | carried |
| 1 paint to target unlocks sim | game-shell, game-sim locked page | carried |
| 2 nothing to change, run to target "by 2057 or so" | game-core, game-sim; date moved by R2, D1 | carried, as the owner accepted |
| 3 permitting, "still have to hit the target" | widened by R3 to beat level 2 | carried as R3 |
| 4, 5 beat previous time | game-core `beats`, `barOf` | carried |
| 6-9 | out of scope, with sign-off | deferred |
| opt-in levelling, keep tweaking | R5: game-core offer, game-sim, game-shell | carried |
| "funding ... finite funding pools" | finite-funding, pool-closing, funding-measures | carried |
| multiplayer removed | remove-multiuser | carried |
| choices carry forward except 1 to 2 | R6: game-core, game-sim | carried |
| R0 | design out of scope | quote exact |
| R1 | game-save, game-core `WinCard` | carried; quote trimmed (F26) |
| R2, R3, R4 | finite-funding; game-core; remove-lesscars | carried; R4's quote exact |
| R5, R6 | quotes exact | carried |
| R7 | global constraints | carried |
| D1 | closing check, game-core | carried (F11 and F12 weaken enforcement) |
| D2, D3, D4 | game-sim offer; finite-funding `none` bound; game-sim and funding-measures | carried |
| D5 | game-sim | carried; publish sentence is the composer's (F27) |
| D6 | game-shell, game-core | carried; the composer's reading that level 2 is the remix gate is recorded in the ledger |
| D7 | game-save (`no_win`, `sign_in`) | carried |
| D8 | game-save keep-both, game-core names | carried |
| D9 | game-shell About text, game-core `Banked` | carried |
| D10 | remove-multiuser | carried |
| D11 | remove-lesscars | carried |
| D12 | game-save `AUTH_METHODS`, mail-setup | carried; quote trimmed (F26) |
| D13 | pool-closing | carried |
| D14 | game-core panel, names, cap | carried |

## Write sets: file → units

The files written by more than one unit, all ordered by `tbl-write-sets` unless noted:

- `src/routes/+layout.svelte`: game-core, then game-shell (which changes nothing).
- `src/lib/game/{save-sync.svelte.ts,AccountOffer.svelte}` and their specs; `docs/dev/{game,game-save}.md`: contracts, then the owner.
- `src/lib/sim-page/funding-presets.ts`: contracts, then finite-funding, then funding-measures.
- `src/lib/sim-page/{funding-*.ts,Funding*.svelte,test/**}`, `src/lib/timeline/pool-level.ts`: finite-funding, then funding-measures.
- `src/lib/timeline/{TimelineMode,SimDetails}.svelte`, `Timeline.svelte.spec.ts`: finite-funding, then game-sim.
- `src/lib/fzp/{money-view.ts,MoneyResults.svelte}`, `src/lib/sim/world/funding/**`, `score/**`, `docs/dev/world-funding.md`: finite-funding, then pool-closing.
- `pipeline/**`, `e2e/fixtures/data/fixture-0/**`: remove-lesscars, then finite-funding.
- `wrangler.jsonc`, schema index, auth files, `deletion.ts`, session-gate, `docs/dev/auth.md`, `migrations/d1`: remove-multiuser, then game-save.
- `package.json`, `src/app.d.ts`: remove-multiuser, then closing. `chreode.config.ts`: remove-lesscars, then closing. `CLAUDE.md`: contracts, then closing. `docs/dev/deploy.md`: mail-setup, then closing.
- Docs under `docs/dev/` that closing edits after their owner: pipeline, fzp-mode, road-lots (remove-lesscars); finance-engine (finite-funding); sim-page and timeline-ui (game-sim).

Writes that the design does not order, or that fall outside a row:

- `e2e/sim-funding.spec.ts`: must be written by finite-funding as well as funding-measures (F2).
- `src/lib/timeline/parse4.ts`: game-sim's file, needed by game-shell's test (F1).
- `src/lib/timeline/copy.spec.ts`: funding-measures, inside game-sim's row, while the two run together (F20).
- Outside their rows: the `remove-multiuser` account specs and helpers (F18), `src/lib/account/safe-redirect.spec.ts` (no unit, F9), `e2e/game-helpers.spec.ts` (contracts, F19), and closing's comment edits under hashed paths (F10).

## Build order

Edges from "Needs" and the write-set "after" notes:

- contracts → {game-core, remove-lesscars, remove-multiuser, mail-setup}
- remove-lesscars → finite-funding
- finite-funding → {game-sim, pool-closing, funding-measures}
- game-core → {game-sim, game-shell, game-save}
- remove-multiuser → game-save
- every unit → closing

Implied by tests and file lists, and not stated in the design:

- game-shell → game-sim (game-sim's e2e uses the level cell).
- game-sim → game-shell (game-shell's test needs parse4): a cycle (F1).
- game-core → funding-measures, if `isGiven` is used (F22).

Longest chain: **contracts → remove-lesscars → finite-funding → pool-closing → closing** (five units). The same length runs through funding-measures or game-sim, and, with F1 resolved by ordering, through contracts → game-core → game-shell → game-sim → closing. Every edge on the first chain, challenged:

1. **contracts → remove-lesscars: removable.** remove-lesscars uses nothing contracts ships (no game type, no stub, no helper), and the write sets are disjoint. contracts deletes `docs/dev/lesscars.md`, and the dangling links are closing's job either way. It can start at t0. The same holds for contracts → remove-multiuser and contracts → mail-setup. mail-setup is the wall-clock risk because of the owner waits, so starting it at t0 matters most.
2. **remove-lesscars → finite-funding: splittable.** finite-funding needs none of L1's content: not `FREEWAY_LAND_JSON`, not the manifest, not `WorkerMode`. The collision is only in regenerated outputs (fixture-0's `manifest.json` and `report.json`, the mini goldens) and in `pipeline/test/**` neighbours. finite-funding's research, `funding.json`, schema, `fzp-cal` emit and the whole `src/` removal of `uncapped` can run in parallel. Only its final fixture and golden regeneration waits for L1.
3. **finite-funding → pool-closing: splittable.** The closing engine (`closing.ts`, `columns`, `serve`, `system`, `world.ts`, `types.ts`, `score/{types,money,view}`, the ensemble case) touches no file finite-funding writes, except `funding/test/fixtures.ts` and the funded golden. It does not depend on `uncapped` being gone, since an uncapped pool is never short and so never spent. The parts that need F2 are `money-view.ts`, `MoneyResults.svelte`, `world-funding.md`, and the referee-ledger run "on fixture-0's finite pools". Those land after finite-funding. The engine work can start after contracts.
4. **pool-closing → closing: needed for the finish, splittable for the check.** The live level 2 check must see closing (D1 holds only with it, `tbl-reach`). But `scripts/level2-check.ts` and its fixture test depend on no unit and could be built early as their own slice. The removal-driven doc fixes for multiuser and less cars could also start once those units merge. What remains for the end: the run, the upload, the journey and signoff.

## Not examined

- The `sec-tests-*`, `sec-design-*` and `sec-today` sections of `contracts`, `game-core`, `remove-lesscars`, `finite-funding`, `pool-closing` and `funding-measures` beyond the parts named at the top. Their `file:line` evidence was not checked; the other two reviewers cover it.
- `funding-bounds.md`, `reach-measurement.md`, and the tier of each number in `tbl-bounds` and `tbl-reach`.
- The information-design spec (the loop, locked rows, public money on the timeline) and the goal-window spec, beyond what the traceability rows cite.
- Whether `@planafoot/drizzle-cf-migrations`' classifier accepts a drop-table migration without a flag.
- Whether a fresh-migrated local D1 lists `d1_migrations` and Cloudflare-internal tables, which `remove-multiuser`'s "exactly the nine identity tables and `plan`" test would have to exclude.
- Which existing e2e expectations move when the fixture's pools become finite.
