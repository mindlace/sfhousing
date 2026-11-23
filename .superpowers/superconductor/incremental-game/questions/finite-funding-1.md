# Question finite-funding-1 — from incremental-game-finite-funding

## Question
The primary reads (§sec-design-data) found three things the spec does not decide:

(a) **Impact-fee balance.** No document titled as the City's Government Code 66006(b) development impact fee report was found. MOHCD's FY2024-25 Annual Report, Table 2 "Affordable Housing Fund Summary", p. 21, states the ending balances at 30 June 2025 of the two accounts: Inclusionary (PC 415/419) $28,865,155 and Jobs-Housing Linkage (PC 413) $16,293,589, sum **$45,158,744** (net of loan encumbrances). Does this primary make the `remaining` bound (and if so, with what `method` text, since the spec's fixed text names the 66006(b) report), or does the `none` fallback stand because the 66006(b) report itself was not found?

(b) **A third housing bond row.** GOB Project Summary (30 September 2026) row [2], "2016 PASS Program-Affordable Housing", p. 1, has **$47,464,550** unissued. The spec's `city-debt` bound counts only 2019 and 2024 Prop A (rows [13], [16]) and says "the source's other debt ... [is] not counted". Is PASS in or out of the `city-debt` remaining amount?

(c) **Two measures passed but uncertified** (heads-up; the spec covers today's state). SF 2026 Proposition C (Housing Trust Fund to 2058) passed in press reports (~80-82% yes), certification due 2026-12-03. State 2026 Proposition 1 (SB 417, $11.25B housing bond) passed in unofficial returns (~60-61%), certification reported for 2026-12-11. The spec treats the first as a player measure "not certified"; the second does not change the state rule's outcome (`none`). Should either change once certified before the dataset ships?

## What the package says
- §sec-design-data-impact-fees: "The builder reads the ending balance of the affordable-housing fee accounts (the Inclusionary Affordable Housing Fee and the Jobs-Housing Linkage Fee) for the latest fiscal year in the City's annual development impact fee report, which Government Code section 66006(b) requires." "When no primary states it, the bound is the block below [none]". `method` fixed text: "... from the City's development impact fee report (Government Code section 66006(b)). ..."
- §sec-design-data-city-debt: "The unissued part of the two housing bonds not yet fully issued." Method: "... 2015 Proposition A is fully issued (row [10]). ... Proceeds issued and not yet spent, and the source's other debt, are not counted."
- §sec-design-data-htf method: "The 2026 extension (Proposition C) is not certified and is a measure a player adds."
- §sec-design-data (general): "Where the primary states a value other than the one here, the file takes the primary's value, and the builder's handback lists the difference."

## What I found
Full read reports: `/Users/mindlace/Projects/sfhousing/.claude/worktrees/incremental-game-finite-funding/.superpowers/sdd/2026-11-22-finite-funding.html/primaries-city.md` and `primaries-state-federal.md` (read 2026-11-22 by investigators with WebFetch; quotes inside).
- (a) MOHCD FY2024-25 Annual Report https://media.api.sf.gov/documents/MOHCD_FY_2024-2025_Annual_Report.pdf p. 21: Inclusionary 6/30/25 $28,865,155; Jobs-Housing $16,293,589 (columns add exactly). Searches for a 66006(b)-titled report found none; SF Planning's fee page lists fee registers only. No FY2025-26 MOHCD report found. Impact: at $34.8M/yr a $45.2M remaining runs out in about 1.3 years, against `none` (paying forever). This moves the level-2 reach margin.
- (b) GOB Project Summary p. 1 row [2]: issued 302,535,450; unissued 47,464,550; issued + unissued = 350,000,000, the 1992 Seismic Safety Loan Program authorisation of row [1] (investigator's inference: PASS is a loan programme carved from that authorisation). Rows [10], [13], [16] match the spec exactly (sum 260,310,000).
- (c) Charter §16.110 current text (struck text in File 260537 legal text) reads "Fiscal Year 2025-2026 through Fiscal Year 2042-43": the spec's block stands. Press: Mission Local 2026-11-10 "Prop. C passed handily and had 82% of the vote". State: CalMatters 2026-11-03 "nearly 60%".

Decided under the spec's primary-wins rule (no question; in the handback): `city-ocoh` bound cite page becomes "p. 44" (BLA p. 46 does not mention OCOH; p. 44 does, with no sunset). Everything else matches: city-general-fund / Housing Stability Fund (pp. 44, 100), redevelopment quote (p. 73), impact-fee collections $422,048 (p. 9), federal Exhibit F (p. 7), CDLAC Exhibit A ($4,829,170,308; no SF share). Notes: the $2,861,626 SF 9% credit figure in the federal `method` is in CTCAC's "2026 credit estimates" (updated 2026-09-02), not the CDLAC Exhibit A the bound cites; BLA p. 42 states "more than $1.2 billion ... since 2018", not $150M a year (the state source's existing yearly amount; this unit does not change it). State bound outcome under the spec's rule: `none` (NPLH last awards Aug 2022; MHP and AHSC funded going forward; no SF dollars left stated).

## Options I see
(a1) `remaining` 45,158,744, tier 2, cite MOHCD FY2024-25 Annual Report p. 21, method = the spec's text with "from MOHCD's FY2024-25 Annual Report (Table 2, Affordable Housing Fund Summary)" in place of the 66006(b) report. (a2) keep the `none` fallback; handback tells the owner the balance found.
(b1) PASS out (spec as written; it is a loan programme under the Seismic Safety authorisation); method adds "Row [2], the PASS loan programme, is not counted." (b2) PASS in: 307,774,550.
(c1) No change now; reach-check / closing re-read after certification. (c2) Treat certified results as current law at dataset time (spec amendment).

## Blocking
Task 1's final data edit for `city-impact-fees` and `city-debt` bounds (a Task 1 fix round). Nothing else: Task 1's other fixes and Tasks 2-7 proceed; the held edit lands as a later Task 1 fix round with regenerated goldens. F1 is reported only after it lands.
