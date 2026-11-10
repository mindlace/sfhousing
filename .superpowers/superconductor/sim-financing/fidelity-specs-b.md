# Fidelity check of three sim-financing specs (checker B)

Specs checked, each read in full: `finance-score`, `finance-levers`, `funding-ui` (all `docs/superpowers/specs/2026-11-09-*-design.md`). Read against the design (rulings R0 to R12, "The model", the interface table, "Presets", "Global constraints", "Out of scope"), the spec brief, the evidence digest, `CLAUDE.md`, `docs/dev/sim-page.md`, `docs/dev/sim-levers.md` and `docs/dev/accessibility.md`, and the code in the worktree. Where a finding crosses specs it is counted once, in the spec where the fix belongs, and noted in the other.

Severity: **blocking** (a builder would build the wrong thing or must invent an externally visible decision), **major** (an ambiguity a builder must guess at), **minor** (wording).

Paths below are relative to `docs/superpowers/specs/`. The prefixes are `score:` for `2026-11-09-finance-score-design.md`, `levers:` for `2026-11-09-finance-levers-design.md`, and `ui:` for `2026-11-09-funding-ui-design.md`.

## `finance-score`

0 blocking, 1 major, 6 minor.

| Id | Severity | Where | What is wrong | Smallest fix |
| --- | --- | --- | --- | --- |
| S-1 | major | score:324, score:320 | The fixture `TIMELINE_SCORE_MONEY` breaks identity I4, which test 24 asserts for the fixture. The `u-bond` pool has `received = 10,000,000 × floor(i ÷ 12 + 1)` and `spent = 1,000,000 × i`. At month 11, received is 10,000,000 and spent is 11,000,000, so available money is −1,000,000 (and the same at months 23, 35 and so on). The test cannot pass as written, so the builder must invent new fixture values. | Use `received = 12,000,000 × floor(i ÷ 12 + 1)`, which stays at or above `1,000,000 × i` in every month, or lower `spent` to `800,000 × i`. |
| S-2 | minor | score:141-150, score:229 | `TIER_SOURCES`, `MONEY_SOURCES` and `tierBaselineLabel` are exported "for the page's Sources", but `funding-ui` never reads them (see U-11). The F13 clause "a recorded 0 may mean 'not stated', and the provenance says so" reaches no user. | Fixed in `funding-ui` (U-11). Here, keep the exports and name their consumer. |
| S-3 | minor | score:242 | The signature is `owedAt(o: owed entry, received: number)`. `funding-ui` calls it as `owedAt(money, pool, i)` (ui:337). | Agree on one signature: either `owedAt(money, poolId, i)` here, or the two-argument form in `funding-ui`. |
| S-4 | minor | score:270 | The cost note says "6 series" and "24 pools × 6 series". F14 has 7 series per pool (with `lostCredit`). At most 12 pools are added, plus the baseline's 8 or so. | Change to 7 series, and give at most 12 added pools plus the baseline's. |
| S-5 | minor | score:199-204 | The identities are listed in the order I1, I2, I3, I4, I6, I5. | Renumber them in order. |
| S-6 | minor | score:324 | The fixture's single `owed` entry for `u-bond` gives no `principal` or `repayment`. Its `limits` use a $300,000,000 principal that does not match the pool's `received` series. | State `principal` as the last month's `received` and `repayment` as `debtService(principal, 6%, 20).total`, or say that the mismatch is deliberate for a UI fixture. |
| S-7 | minor | score:208-212 | `displacedHomes` counts only funded projects that completed. A funded start that pre-empted a private start and then dropped out, or is still building at the horizon, displaced homes that the results never report. This follows F14 as written, but OD-F9b asks the results to "state the homes displaced in the run". The spec's tier 2 note covers timing only, not this omission. | Add a sentence to the developer doc and to `MONEY_SOURCES`'s per-added-home entry saying that displacement by funded projects not yet complete is not counted. Alternatively, raise it as an interface concern on F14. |

**Leg results.**

- **Delegation:** no externally visible decision is left open. The page-side choices (Q3, the "unrecorded" line) are handed to `funding-ui` by name, and `funding-ui` decides both.
- **Placeholders:** none. Every behaviour has a test with a named fixture, and every acceptance criterion traces to a row.
- **Fidelity:** F13 and F14 are carried clause by clause. `lost` counts every loss and `lostCredit` only loans and guarantees (OD-F8). I4 uses `lostCredit`. Limits come from the added borrowing, through `addedBorrowing`, and are empty on the default policy (OD-F6). Tiers are not computed for the twin. No stale phrases were found.
- **Evidence:** the RHNA targets (20,867, 12,014, 13,717, 35,471 and 82,069) match digest Exhibit D. $300,027 and $861,525 match Exhibit F. 715,685,078 on $410,442,573 matches digest p. 106 ($715.7M on $410.4M). The 9,581 progress figure and the inclusionary rates (15% for 10 to 24 homes, 18% split 10/4/4 for 25 or more) match. The exported 0.115 to 0.8 matches the digest's 11.5% and "about eight units" of ten.
- **Recomputed:**
  - The worked example: shares 0.5, 0.425 and 0.075 give 50, 43, 8.
  - The tie example gives 2 and 1.
  - The MOHCD mix on 100 homes gives 48, 43, 8, 1.
  - Inclusionary on 130 homes gives 23 on site, split 18 and 5, with 107 above moderate. On 25 homes it gives 4, 1 and 20.
  - Phases of 100, 100 and 101 homes give 17, 16, 17.
  - All of these are correct.

## `finance-levers`

1 blocking, 4 major, 4 minor. U-3 (in `funding-ui`) also contradicts this spec's acceptance criterion 14.

| Id | Severity | Where | What is wrong | Smallest fix |
| --- | --- | --- | --- | --- |
| L-1 | blocking | levers:310, levers:419; ui:194 | Preset descriptions are never written. `funding-ui` gives each preset button "the preset's one-line description as its accessible description". This spec relies on a description for honesty: `state-double` "buys no homes on the baseline … The preset's description says so", and open question 4 depends on it. But `FundingPreset` (F16) has no description field, and neither spec writes the text for any preset. The builder must invent eleven pieces of user-visible copy, including the caveat that keeps `state-double` honest. | Write one sentence per preset in the 4.7 table. Carry them in `funding-copy.ts` keyed by preset id, so that F16 is unchanged. |
| L-2 | major | levers:75, levers:341; F16 | `valueSource(item, field, presets)` is not defined. The type and vocabulary of `field` are not given. `FundingPreset.provenance` is a flat list, with no mapping from a field to its `Provenance`. Which starting values are "`'custom'` from the start" is left to the prose. For example, is the bond's $410,442,573 (tier 2 "estimate"), the bank inflows (tier 3) or the bank leverage (tier 2 on tier 3) sourced or custom? `funding-ui` renders the result as "From … (tier n)" or "custom, not sourced". | Add a per-preset table of field path to `Provenance` or `'custom'` (for example `pools[0].debt.rate`, `pools[0].inflows[k].dollars`, `programmes[0].instrument.costShare`), and type `field` as that path union. |
| L-3 | major | levers:277-286 | Preset contents are incomplete. No preset gives a programme `label`, which F6 requires and which the parser checks at 1 to 80 characters. Pool `label` is missing for `general-revenue`, `htf-2026` and `revolving-fund`. `public-bank`'s programme has no `from` or `to`, and `revolving-fund`'s has no `to`. The test "numbers exact" (levers:378) cannot be written without guessing. | Give every pool and programme label, or state that each programme label is `funding-ui`'s `programmeSentence`. Give `from` and `to` for every preset programme. |
| L-4 | major | levers:302 | Stale fill-rule wording: "`fundBundle` (F8) counts loans first, then fills grants in three tiers". F8 says loans and guarantees count first within each tier. The worked figures are unaffected, because the bank loan sits in the City tier, but the developer doc is told to restate this rule (levers:412). | Change to "fills three tiers (federal, state, the City's); within each, loans and guarantees count first, then the tier's grants". |
| L-5 | major | levers:250 | The return type of `pastItems(f, asOf)` is not given. It returns "ids of added pools …, of programmes …, and the indices of `once` inflows" without saying what the indices belong to. `funding-ui` consumes it (ui:202). | Declare `pastItems(f, asOf): { pools: string[]; programmes: string[]; inflows: { pool: string; index: number }[] }`. |
| L-6 | minor | levers:282, levers:297 | Partial fidelity to the design's "Presets". The public bank models only the corporation's three years. It leaves out the bank years ($20M of capital, $200M of funding, 0.82 lent per dollar, 5.0% to 5.8%). The spec says so and gives a reason, but "not re-read" is not a reason the design accepts for dropping a source. The design says the state bond's yearly amount may be set by the user "labelled as their own"; the spec makes the preset simply unavailable. | Either re-read the bank plan and add years 4 and 5, or state that the omission is a scope cut and log it. Say that a user who wants the state bond adds a `state` pool by hand. |
| L-7 | minor | levers:156 | The publish-refusal message says "`funding-ui` may supersede the wording". This is a "may" where the outcome differs, and `funding-ui` does not take it up. | Say the API message stands. |
| L-8 | minor | levers:69 | `viaLevers` (`src/lib/sim-page/policy.ts:236`) is typed for `'timers' \| 'routeShares'` only. Reusing it for `finance` under `funding` needs its type widened, which the spec does not mention. The re-pathing `path + e.path.slice(field.length)` does work for `finance` to `funding`. | Mention the signature change. |
| L-9 | minor | levers:369 | The `buildFinance` tests do not cover a scale entry or an `off` span dated before `asOf`. The section 4.4 rule "spans are not clipped" and the section 4.6 rule "applies from `asOf`" are then untested at this layer. | Add the two cases. |

**Leg results.**

- **Delegation:** L-1 and L-2 are the only open externally visible decisions. Error texts, ordering, limits, ids and the report shape are all decided.
- **Placeholders:** none, apart from L-3 and L-5.
- **Fidelity:**
  - F7, F15, F16 and F17 are carried.
  - Rulings R9 and F15 are carried. A schema-2 document loads with default funding in `'reconcile'` on all three paths and reports `upgradedFrom`. Publishing schema 2 returns 422 `unsupported_schema`. `isDefaultPolicy` covers funding and typed terms (levers:197).
  - Every preset of "Presets" is specified or marked unavailable with a reason (see L-6).
  - No `#` id splitting survives (only the "gone" note). No preset presents a 4% default loan rate as sourced.
- **Evidence:** 300,027 ÷ 861,525 = 0.348251. The shares 443,108 ÷ 861,525 = 0.51433 and 118,390 ÷ 861,525 = 0.137419 hold. The six City shares sum to 0.348251. These hold too:
  - $36.7M General Fund (Exhibit E).
  - Certificates of participation at 6.5% over 20 years (pp. 107-108).
  - HR&A's 6.13%; 59.948 ÷ 90 = 0.67.
  - Proposition C's +$6M, +$13M, +$9M a year to $60M, and the extension to 2058.
  - Proposition 1's $7.2B and 40,000 homes.
  - Montgomery County's $100M with five-year loans.
- **Recomputed:**
  - The bond gives $150,014 a home and 1,368 homes.
  - The City pools fund 1,560 a year against the state's 1,267.
  - General revenue gives 122 more a year, 902 in all.
  - The revolving fund is worth $1,942 a home, with coverage 0.009, an odds shift of 0.0046 and 1,357 homes outstanding.
  - The bank is worth $2,384 a home, leaving $297,643 for the City tier, which funds 786 homes.
  - Switching state money off shifts the odds by 1.36; withdrawing the federal tax credits shifts them by 0.77.
  - The bank's inflows are $8,666,667, $11,333,333 and $10,000,000.
  - All are correct.

## `funding-ui`

3 blocking, 9 major, 8 minor.

| Id | Severity | Where | What is wrong | Smallest fix |
| --- | --- | --- | --- | --- |
| U-1 | blocking | ui:198, ui:223, ui:248 | Incomplete values have nowhere to live. "Your own pool" starts with an empty amount, and "the pool compiles with no inflows until it is filled". A loan on any pool but a bank starts with an empty rate, as does a hand-made `goBond` or `cop` field whose entry is `Unsourced`. But the store holds a `SimPolicy`, and `parseFinanceLevers` requires 1 to 12 inflows of whole dollars of at least 1 (levers:113-116). `validateInstrument` requires a finite loan rate. As specified, the worker answers `bad-request`, and the autosaved document fails `parseSimDoc` on reload, so it is treated as corrupt (`src/lib/sharing/storage.ts:63`). The builder must invent where drafts live, and what undo and autosave see. | Keep unfinished pools and programmes in page state, outside the store, until every required field is valid. Then add them in one store change with the "Added: …" label. State this, and say that autosave and publish never see a draft. |
| U-2 | blocking | ui:61, ui:63, ui:178, ui:180, ui:263 | "What the City pays of each home" (the coverage line, `cityPerHome`, the group rows) and a programme's `inBundle` are defined as `granted + lent`. `lent` is loan principal, which comes back. It is not money paid, and not the loan's worth. With the `public-bank` preset, the City row would read about $393,000 a home ($297,643 of grants plus $95,413 lent). The preview's test "when `inBundle` is below what it pays on its own" would then compare principal ($95,413) with grant-equivalent ($2,384). The builder would ship wrong public figures. | Use each item's `grantEquivalent` as priced in the bundle (equal to `granted` for a grant). Show `lent` separately ("lends $95,413 a home") if it is wanted at all. |
| U-3 | blocking | ui:12, ui:213, ui:247, ui:257; levers:296-297; design "Presets" | Tier 4 starting values go unlabelled, against the design and `finance-levers`. The design says the public bank's loan terms are "the user's to set, labelled 'custom, not sourced'", and that the federal amount is "labelled 'custom, not sourced'". `finance-levers` labels the loan presets' `costShare` 0.10 and the revolving fund's rate 0.06 as custom, and its acceptance criterion 14 requires it. This spec classes "Loan share", "Guarantee share" and every "Amount" (outside an enacted-measure preset) as choice fields with no source line and no label. As written, a user sees "10% of the building cost" with no sign that the number is invented. | Show "custom, not sourced" on any field whose value is a preset's tier 4 or unsourced starting value, using `valueSource`. Alternatively, get the design and `finance-levers` to agree that policy choices carry no label. |
| U-4 | major | ui:345, ui:385 | OD-F8, what a user actually sees. The Results face shows nothing about losses. Inside "Money details", which is closed by default, the "By source" table shows "Spent", which includes grants later lost, and "Loans lost", which is `lostCredit` and also holds guarantee reserves; the column is dropped when all zero. Beneath the table, only when some grant was lost, one line reads "Grants paid to projects that stopped after construction began: {sum} (counted in Spent)." That line never says the money is counted as lost and carries no tier 4 label. The "counted as lost (assumption, tier 4)" sentence appears only in the sources dialog. That fixed sentence says "everything spent", which becomes false when a loaded document carries a typed `lossOnExit`. OD-F8 asks for the assumption to be said in the results. | Reword the line: "Grants paid to projects that stopped after construction began, counted as lost (assumption, tier 4): {sum}. They are in Spent." Take "everything" or the percent from the resolved `lossOnExit`. Rename the column "Loans and guarantees lost". |
| U-5 | major | ui:348 | The displacement range is formatted with `formatPercent`, which floors to a whole percent at 10% and above (`src/lib/scoreboard/format.ts:27-36`). It renders "11%", not the "11.5%" that the sentence and acceptance criterion 13 promise. | Format the low bound with one decimal place, or state the exact rendering and test it. |
| U-6 | major | ui:107, ui:178, ui:461 | Dollar formats conflict. The rule rounds everything below $1 million to $1,000, except "the per-home amounts of today's funding in the baseline detail". Yet the coverage-step lines and group rows show computed whole-dollar values ("the City pays $181,637"). The `formatDollars` test lists 999,500 and 999,999,999 without expected outputs: is 999,500 "$1,000,000" or "$1 million", and is 999,999,999 "$1,000 million" or "$1 billion"? | List every surface that shows whole dollars, and give the expected string for each test input. |
| U-7 | major | ui:213, ui:218, ui:246, ui:253 | UI bounds disagree with the parser and with preset values. The pool interest rate accepts 0%, but the parser requires a rate above 0 (levers:114), so a typed 0 makes an unparsable policy. "Smallest project" allows 1 to 500, but the `revolving-fund` preset stores `minHomes` 0 and the parser allows 0 to 10,000. "Grant, %" takes whole percents and "Amount" steps by $0.1 million, but presets store 0.348251, $8,666,667 and $410,442,573. The display precision is not given, nor whether re-committing an unchanged value fails validation. | Set the rate bound to "above 0", and allow `minHomes` 0. State the displayed precision of preset values, and that the step does not invalidate a stored value. |
| U-8 | major | ui:185-186, ui:405 | Dated changes are underspecified in four ways. First, a City-group change writes one entry per City pool (six on the live baseline), but the editor lists "one line per `baselineScale` entry", giving six lines and six Remove buttons, while the summary shows the change once. Second, adding a change on a pool and day that already has one gives a duplicate that the parser rejects ("no two on one day"); there is no rule to replace or refuse. Third, the sorted order the parser requires is not stated for edits. Fourth, "+ Change from a date" has no `aria-disabled` state at 24 entries, and a City change needing six entries when fewer remain is not handled. | Show a City-group change once, removing all its entries. A same-pool, same-day change replaces the old one, as `addPreset` does. Sort on insert. Disable at the limit with a stated description, counting the entries a change needs. |
| U-9 | major | ui:170 | Stale fill-rule wording: "loans and guarantees count first at their full worth; grants then fill … in three tiers". F8 says loans count first within each tier. The page calls `fundBundle`, so numbers are right, but the developer doc restates the rule. | Change to "Within each tier (federal, state, the City's), loans and guarantees count first; then the tier's grants". |
| U-10 | major | ui:541 | Open question 1 lists "60% loan at 4%" as the fixed starting values of a new programme. The field table (ui:248) and its note (ui:257) say the loan rate starts from `POOL_KIND_DEFAULTS`: 6.13% on a bank, empty otherwise. This is a stale 4% default. | Drop "at 4%". |
| U-11 | major | ui:356; score:141-150, score:229 | `finance-score`'s `TIER_SOURCES`, `MONEY_SOURCES` and `tierBaselineLabel` are never rendered, so three things never reach a user. The first is F13's "a recorded 0 may mean 'not stated', and the provenance says so". The second is the rule that existing homes are netted from above moderate. The third is the definition of per added home. The tier text uses `formatMonthYear(since)` ("June 2022") in place of the label "completed since 30 June 2022 (net)". | Render `TIER_SOURCES` under "Homes by income level" and `MONEY_SOURCES` under "Money details" (or in `src-money`). Use `tierBaselineLabel`. |
| U-12 | major | ui:495-501 | Accessibility and e2e gaps. No axe scan covers the "+ Add money" chooser open, a programme editor expanded (loan, guarantee, income-mix fieldset), the "Market terms you set" section, or the "Coverage over time" and "Sources and tiers" disclosures open. No e2e test exercises the programme editor's loan or income-mix fields. | Add those states to e2e test 1's scans, and add one programme-editor e2e test. |
| U-13 | minor | ui:427 | "the kept funding is neither sent to the worker as changes nor dropped" contradicts `compileLevers`, which copies `funding` to the levers (levers:199). Non-default unusable funding also makes `isDefaultPolicy` false, flipping `compare` to `'fzp'`, which the user sees. | State what the worker receives and how `compare` behaves when `unusable` is true. |
| U-14 | minor | ui:194 | Two loose ends in the preset chooser. `FUNDING_PRESETS` is named, but `finance-levers` exports the function `fundingPresets(cal)`. Which preset falls under which of the four `h4` groups is not stated. | Name the function, and give the preset-to-group mapping. |
| U-15 | minor | ui:109 | The odds example "+30%" echoes the superseded OD-F9a figure (now about 12%). Whether "whole percent" rounds or floors is not stated. | Use "+12%" and state the rounding. |
| U-16 | minor | ui:187, ui:254 | The rounding of the whole percents in "52% very low, 31% low…" and in a baseline programme's "{pct} of the uncovered cost" is not stated (for example, 0.072329 shown as 7% or 7.2%). | State it: largest remainder for the mix, and `formatPercent` for shares. |
| U-17 | minor | ui:349 | "with a principal above 0 at the mark": the principal at the mark is not a posted field. | Say it is the pool's `received[i]`. |
| U-18 | minor | ui:524 | Acceptance criterion 14 (no value past the high-water month) has no test. | Add a `SimResults` case. |
| U-19 | minor | ui:140-144 | "Money you add" has no empty-state text. | Add one, or state that the section shows only the add button. |
| U-20 | minor | ui:381, ui:387, ui:366 | Two citations point at the wrong lines. `NOT_SF_NOTE` is at `provenance.ts:84`, but `isResearch` is at line 90, not within 84-88. `FzpMode.svelte:352` is `leverFailed`, not `stale`. | Correct the line numbers. |

**Leg results.**

- **Delegation:** U-1, U-3, U-6, U-7 and U-8 are open externally visible decisions. Copy, ids, notices, labels and focus are otherwise decided in detail.
- **Placeholders:** none. See U-12 for coverage.
- **Fidelity:**
  - R4: tiers against the four targets, City and all public money per added home, and no rent or price.
  - F13: the funded-tier sentence is shown.
  - OD-F6: limits are shown under "shown, not enforced" and come from the added borrowing.
  - R9 and F15: the `funding-added` notice has text.
  - OD-F8: weak, see U-4.
- **Partner preferences:** respected. The header score is unchanged, and no header items are added, so the phone menu is unaffected. The coverage line sits as status above the controls, never among buttons. The Results face adds three visible lines, with the rest behind disclosures.
- **Evidence:** these hold:
  - 86% coverage with state money off: (861,525 − 118,390) ÷ 861,525 = 0.863.
  - $181,637.
  - $300M at 6% over 20 years: $26.2M a year and $523M in all, $1.74 per $1.
  - The $20B regional bond.
  - The 40-year PASS loans.
  - Rates of 6% to 8.5%.
  - The 11.5% and 80% displacement range.
  - 6% over 20 for bonds and 6.5% for certificates of participation.
  - 0.67 and 6.13%.

## What was checked

- All three specs, line by line, and the full design, brief, digest, `CLAUDE.md` and the three developer docs.
- Every interface row in the three specs, compared mechanically with the design: all are verbatim.
- A stale-phrase sweep plus a reading. Found: L-4, U-9 and U-10. None of "first programme", "taxes before borrowing", "cannot be switched off", "every pool must pay", −1.10 or "about a third" appears.
- Code citations, about 60 in all. They held, except for U-20 and the two-site `restoreSimDoc` note below.
  - `finance-score`, 24 citations: `score.ts`, `simulate.ts`, `scenario-host.ts`, `engine.ts`, `version.ts`, `runs.ts`, `targets.ts`, `projects.test.ts`, `format.ts` and the `/fzp` route.
  - `finance-levers`, about 30: `levers/types.ts`, `policy.ts`, `sim-doc.ts`, `apply.ts`, `scenario/policy.ts`, `load.ts`, `model.ts`, `time.ts`, `constants.ts`, `publish.ts`, `storage.ts`, `autosave.svelte.ts`, `shared-page.ts`, `SimPage.svelte`, `+page.svelte`, `app.d.ts`, `e2e-seed.ts`, `scenario-client.ts`, `sim-session.ts`, `reconcile.ts` and `tabs.ts`.
  - `funding-ui`, 15: `copy.ts`, `provenance.ts`, `icons.ts`, `fzp/format.ts`, `SimResults.svelte`, `FzpMode.svelte`, `ProjectCardPanel.svelte`, `ProtectionsSection.svelte`, `policy-store.svelte.ts`, `RouteTimeline.svelte`, `tabs.ts` and `SimPage.svelte`.
  - `SimPage.svelte` calls `restoreSimDoc` at two sites (174 and 228). `finance-levers` names both paths correctly.
- Cross-checks against `finance-model` and `finance-engine`:
  - `validateInstrument` bounds, `TYPED_TERM_RANGES`, `lossOnExit` = 1 at tier 4, and `guaranteeRateCut` unsourced.
  - `debtService` against Exhibit 40, and the `inclusionaryUnits` rounding.
  - The engine's event table against `finance-score`'s, and the `tiny-queue` fixture.

## What was not checked

- The PDFs themselves. Constants were checked against the digest, not re-read in the primaries.
- `finance-data`'s expected live baseline (the City pool ids and shares) beyond summing the shares, and the MOHCD tier mix beyond the arithmetic.
- `market-baseline`'s `marketLevel` and `marketSentence`, which `funding-ui` 4.12 extends. They were not opened.
- Whether `docs/dev/fzp-mode.md`'s horizon really ends in December 2066.
- The existing e2e helpers and the exact test file names `funding-ui` extends.
