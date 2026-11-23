# Gate findings: the package against its sources

Inputs: `gate-explain.md` (stage 1); the owner's request and rulings in `ledger.md` (lines 26-46, 72, 89-95, 101-116); `docs/superpowers/specs/2026-11-17-information-design-review-design.html` (The loop; Public money on the timeline; Decided; Questions); `docs/superpowers/specs/2026-11-21-goal-window-no-halos-design.html`; four memory files; and `surveys/{funding-bounds,reach-measurement,mail-recon}.md`.

Paths in this file are short forms:
- `D` = `docs/superpowers/design/2026-11-22-1216-incremental-game.html`
- `S/<unit>` = `docs/superpowers/specs/2026-11-22-<unit>-design.html`
- `IDR` = `docs/superpowers/specs/2026-11-17-information-design-review-design.html`
- `L` = `.superpowers/superconductor/incremental-game/ledger.md`
- `M/` = `/Users/mindlace/.claude/projects/-Users-mindlace-Projects-sfhousing/memory/`

Left out on purpose, as the brief asks: everything on the ledger's "Open with the owner" list (`L:152`): the Remix level gate, magic link turning on when the secrets are set, the invented ten-year terms, the impact-fee fallback, the state bound and D1's margin, the DNS records, and Google. Also left out are the design doc's owner-signed narrowings: levels 6 to 9, the less-cars unlocks, and D10 narrowing "keep sims".

**Counts: 0 blocker, 1 major, 8 minor.**

## Blocker

None.

## Major

### gate-1: a policy already saved in the browser becomes a level-1 game, and every kind in it is locked (major)

- **Sources.**
  - The owner's D5 ruling: "Playback of a shared sim should preserve all its settings and behavior ...; only remix-ing should shift to only-unlocked." (`L:114`)
  - The earlier design's open question on progress: "In the browser, with the account when signed in. A saved or shared policy that already uses a kind keeps it usable." (`IDR:500`)
- **Package.**
  - "A plan or policy saved in this browser before the game existed becomes the first saved game, at level 1." (`D:198`, `D#sec-model-saves`; built by `S/game-core#sec-design-store-construct`)
  - At level 1, `/sim` is the locked page (`S/game-sim#sec-design-locked-page`).
  - Above level 1, "a saved game ... runs only the policies its level has unlocked" (`D#d5`, `D:163`). Every money policy stored before the build has `preset: null`, so it is "Unlocks in a later round" at every level (`D#sec-if-g3`).
- **Drift.** The owner limited the shift to unlocked-only to remix. The package also applies it to the existing autosave. A returning visitor who opens `/sim` sees a locked page in place of the policy they built, must win Paint to reach it, and then gets back their zoning only at level 4 and their own money never in this round. No source asks for this, and the one source that speaks to saved work asks for the opposite. A builder of `game-core` and `game-sim` will build it as written, so the owner should confirm it or give the migrated game a level that runs its document (for example `levelNeeded`, capped at 5).

## Minor

### gate-2: what a level up does after the round is complete (minor; two specs disagree)

- **game-core.** The pure `levelUp` table: "Level 5, round complete | Anything | `p` itself" (`S/game-core:485`). The store's table: "5, round complete | Anything | Progress unchanged; offer null" (`S/game-core:699`).
- **game-sim.** "A later level up at level 5 changes neither the level nor roundComplete, so it banks the new result and the clock stays where it is." (`S/game-sim:608`, `#sec-design-levelup`)
- **Drift.** The two specs would build, or test, different behaviour. No button calls a level up after the round is complete (the win card, the panel and the level cell hide it by `roundComplete`), so a player sees no difference. A `game-sim` test written from its spec would still fail against `game-core`.

### gate-3: who writes the level 2 check (minor; specs disagree on ownership)

- **Five places name `closing`.**
  - `S/finite-funding:678`: "is closing's scripts/level2-check.ts"
  - `S/finite-funding:898`: out of scope, "closing"
  - `S/pool-closing:461`: "closing's scripts/level2-check.ts"
  - `S/game-core:1073`: "The build check that current law reaches the goal: closing."
  - `S/game-sim:864`: the same
- **The rest of the package names `reach-check`.** The build graph row for `reach-check`, `S/reach-check#sec-goal` and `S/closing#sec-write-set` ("scripts/level2-check.ts and its test are reach-check's; this unit runs the script and never changes it"), and `D#sec-if-g4`.
- **Drift.** These are stale references. They change no behaviour, but an operator of `finite-funding` or `pool-closing` reading its own spec is told the wrong unit owns the D1 check.

### gate-4: pools that never end still refill, and a closed pool is "at or near" empty (minor)

- **Sources.**
  - "Decision: public money ... Pools should be seen to drain as their money is allocated." (`IDR:490`)
  - "Each pool's bar ... starts full and drains as its money is allocated ... A pool that runs dry shows as empty from that month on." (`IDR:319-321`)
- **Package.**
  - "A pool with no end keeps today's reading, the free share of what it has received so far." (`D:208`)
  - "A pool's bar shows nothing special when the pool closes: by then its lifetime level is at or near empty" (`D:211`)
  - "Current funding" reads the lifetime level "only when every baseline pool ends" (`S/funding-measures#sec-design-level`). Today's baseline has OCOH, the General Fund, state and federal with no end, so that bar always refills.
  - Money returned to a closed pool raises its level (`S/funding-measures#sec-design-level`: "a lifetime level can rise"; `S/pool-closing#sec-design-closed`).
- **Drift.** The baseline bar, the one every player sees, still refills each year rather than draining. A dry pool can show as partly full. The window is 480 months, so a lifetime total over the window exists even for a pool with no end; the package chose not to use it.

### gate-5: the win card and the header tell less than "The loop" asked for (minor)

- **Sources.**
  - Victory: "That they reached it, when, how far ahead of the deadline, and how much of it came from their policy. Then what they unlocked." (`IDR:340`)
  - What comes next: "The levels won, the current level, and the next unlock by name. | The header, in place of mode links." (`IDR:342`)
- **Package.**
  - The win card holds the title "Goal reached in Mar 2049", "Unlocks: …", two buttons and the account offer (`S/game-core:859-873`, `#sec-design-wincard`).
  - The header keeps the "1 Paint, 2 Simulate" links and adds a level cell beside them (`S/game-shell#sec-design-steps`, `#sec-design-cell`).
- **Drift.** The card does not say how far ahead of the deadline the goal was reached, or how much came from the player's policy. The header keeps the mode links that the loop design replaced with level progress. The owner's later terse-copy preference may justify this, but no ruling records the cut.

### gate-6: the federal "yearly ceiling" carries over, so it does not cap yearly awards (minor)

- **Sources.**
  - R2: "federal credits get a yearly ceiling" (`L:92`).
  - The research: California sets "yearly" credit ceilings (`surveys/funding-bounds.md:28-29`).
  - The measurement: without closing, the state and federal pools "end with $5.8B and $21.9B unspent"; with closing, the federal pool's lowest balance is $446M (`surveys/reach-measurement.md:35-37`).
- **Package.** "Federal tax credits become a pool with a yearly amount, the ceiling." (`D:206`) A pool pays from everything it has received, less what is committed (`D#sec-found`; `S/finite-funding#sec-design-pool-engines`). Unspent money carries over.
- **Drift.** As built, the ceiling caps yearly inflow, not yearly awards. Balances pile up, and in a busy year (for example at level 5 with added City money) the pool can award well above the ceiling. That is unlike the use-it-or-lose-it allocation the research describes. It does not change current law's result (it "never binds"), but the owner asked for a ceiling, and this one cannot bind.

### gate-7: deleting an account now deletes its saved games (minor)

- **Source.** "When a design choice trades durability of sims, links or history against deletion or data minimisation, choose durability and say so, unless real personal data is involved" (`M/sims-are-public-keep-them.md:15`). The owner: "deletion shouldn't kill any shared links", "a deleted person's commits stay" (`:11`).
- **Package.**
  - "Deleting the account deletes its saved games. Published plans and policies stay." (`D:262`)
  - `deleteGamesOf` runs in `closeAccountRows` (`S/game-save#sec-design-deletion`).
  - `remove-multiuser` drops the e2e case "deleting the account signs out and keeps both sims" (`S/remove-multiuser#sec-tests-e2e`).
- **Drift.** Saved games are not personal data and not shared, so either choice is defensible. Still, the package picks deletion against a standing preference for durability, without a ruling and without saying so.

### gate-8: a game deleted on one device discards unsent edits on another (minor)

- **Source.** D8: "When saved games meet (a sign-in on a device with its own games, two accounts joined, two devices changing one game), every one is kept as its own saved game. Nothing is merged and nothing is picked over another." (`L:106`; `D#sec-rulings-review`)
- **Package.**
  - "A 410 to the send of a save that is not the current game removes it here" (`S/game-save:617`).
  - A pull: "changed here, send it, which answers 410 and follows the 410 rule" (`S/game-save:639`). Only the current game is kept under a new id.
- **Drift.** If device A deletes a game while device B has changed it, B's changes are thrown away for any game that is not current there. The delete wins over the edit. "Deleted on the others the next time they sync" (`D#sec-model-accounts`) covers an unchanged copy, but D8's keep-everything rule suggests a changed copy should survive as "{name} (this device)", as it does for the current game.

### gate-9: closing's final sweep reports code that other units keep on purpose as defects (minor; specs disagree)

- **Kept by design.**
  - `S/remove-lesscars:221`: "style.ts keeps LC_ROADS_SOURCE_LAYER ('roads_lc') …"
  - `manifest.ts` still parses `scenarios.lesscars` and derives `splitRoads` (`S/remove-lesscars#sec-design-manifest`).
  - `scripts/data-local.spec.ts` "keeps its lesscars block".
  - `parseCalibration` reads `uncapped` from older datasets, and `parsePool` accepts and ignores it (`S/finite-funding:605`, `#sec-design-pool-types`).
  - The reserved handles `lesscars` and `fzp` stay.
- **Closing.** Its sweep greps `lesscars`, `roads_lc` and `'uncapped'`/`.uncapped`. Its allowed places cover only tests that assert a 404 or the F2 load rule in a Vitest file. "A hit in code or test code anywhere else is a defect of the unit that removed the name: it is reported" (`S/closing:263`).
- **Drift.** Closing will report L1's and F2's compatibility code as defects owned by `remove-lesscars` and `finite-funding`, and its verification line cannot read "finds nothing". Code stays untouched, but the handback is wrong and a conductor may send fixes that break older datasets. The allowed list should name those files.

## Could not tell, checked

- **Item 1** (a level up after the round is complete): gate-2.
- **Item 5** (who writes the check): gate-3.
- **Item 2** (the state and impact-fee bounds): on the owner's open list; not a finding.
- **Item 3** (a bar frozen by D9): the owner's "fine" covers it.
- **Item 4** (the offer lost on reload): follows from the owner's D2 ("offered only while the current policy's result has been seen"). A builder has nothing to decide.

## Write-set check

The `remove-multiuser` spec (`S/remove-multiuser#sec-write-set-deleted`, `#sec-write-set-changed`, `#sec-tests-e2e`) names its e2e files:

- **Deletes:**
  - `e2e/invite.spec.ts`
  - `e2e/invite-redundant-entry.spec.ts`
  - `e2e/leave-sim.spec.ts`
  - `e2e/sim-control-plane.spec.ts`
  - `e2e/sim-object.spec.ts`
  - `e2e/sims-onboarding.spec.ts`
  - `e2e/pseudonymous-onboarding.spec.ts`
  - `e2e/helpers/members.ts`
  - `e2e/helpers/sim-socket.ts`
- **Edits:**
  - `e2e/helpers/account.ts` (`startPseudonymous` rewritten; the `SIMS_COPY` import goes)
  - `e2e/account-deletion.spec.ts`
  - `e2e/auth-a11y.spec.ts` (the invite case goes; 404 checks for `/sims`, `/invite`, `/api/sims` and `/api/operator` are added)
  - `e2e/auth-methods-default.spec.ts`
  - `e2e/email-link.spec.ts`
  - `e2e/sign-out.spec.ts`
  - `e2e/account-a11y.spec.ts`
  - `e2e/password-auth.spec.ts`
  - `e2e/account-email.spec.ts`
- **Also edited, but not an e2e spec:** `playwright.config.ts`.

The list is complete against `e2e/`. A grep for `members/copy`, `SIMS_COPY`, `startPseudonymous`, `sim-socket`, `/sims`, `/invite`, `/api/sims` and `kind=invite` across `e2e/*.spec.ts` and `e2e/helpers/*.ts` hits only those files. `account-handle`, `passkey` and `password-reset` import `helpers/account.ts`, but only `gotoAccount` and `submitPasswordForm`, which stay.

**Overlap with `remove-lesscars`: none.** That unit edits `e2e/{targets,sim-citywide,sim,pages-a11y}.spec.ts` and deletes `e2e/lesscars.spec.ts`. None of those is in the list above, and a grep of `e2e/` for `/fzp` and `/lesscars` visits finds them only in those five files. `pages-a11y.spec.ts` has no `/sims` or `/invite` case: the new 404 checks for those go in `auth-a11y.spec.ts`. The two units can run in parallel without touching a shared e2e file.
