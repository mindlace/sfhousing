# Question funding-measures-1 — from incremental-game-funding-measures
## Question
Where in BLA 2026 are the phrases "started as $20 million in 2013" and "would expire" (2043) that GENERAL_FUND_TERM_YEARS's method quotes from "p. 108"? Should the cite or the quotation change?

## What the package says
Spec §sec-design-presets (spec html line ~298-310): "The operator reads BLA 2026 pp. 44 and 108 before the term is written"; the method string quotes p. 44 ("baseline annual funding until 2043") and p. 108 (its General Fund allocation "started as $20 million in 2013" and the fund "would expire" in 2043: 30 yearly allocations, FY2013-14 to …). §sec-docs line ~642: Sources row for GENERAL_FUND_TERM_YEARS (tier 2, BLA pp. 44 and 108). The plan's Open questions anticipated this and recommends the partner confirm pp. 44 and 108 from the local copy cited in funding-sources.ts's COP method.

## What I found
- Task 1 implementer opened the BLA PDF (report: .superpowers/sdd/2026-11-22-funding-measures.html/task-1-report.md:18 in the funding-measures worktree). p. 44 matches word for word: "was launched in 2013 after San Francisco voters approved Proposition C … which established baseline annual funding until 2043".
- Printed p. 108 is the COPs exhibit (Exhibit 42) and does not contain "started as $20 million in 2013" or "would expire"; the phrases were not found elsewhere by that implementer (unverified whether PDF page 108 differs from printed page 108).
- The method string was committed verbatim from the spec in src/lib/sim-page/funding-sources.ts (commit d535c8c9); the 30-year term value itself is supported by p. 44 (2013 to 2043).

## Options I see
A. Keep the term (30, supported by p. 44) and change the method to cite p. 44 only, dropping the unconfirmed p. 108 quotes.
B. The partner locates the phrases (another page, or the local copy) and gives the corrected page cite; I update the method and the Sources row.
C. Leave as is (risk: a sourced quotation that does not appear at its cite).

## Blocking
None of Tasks 2-9 block; only the final wording of GENERAL_FUND_TERM_YEARS.method (Task 1) and its Sources row in docs/dev/sim-funding.md (Task 9) wait on the answer.
