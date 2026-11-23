# Ruling pool-closing-2
Package commit: a3551571
Changes design: yes
Changes contract: no
## Ruling
Closing stays on by default. The funding specs that pin the wait on a spent pool, or that test serving, re-making and caching against the base timeline, run their worlds with `poolClosing: false` and keep their assertions as they are: `funding/funded.spec.ts` "rule 16: the known limit", `funding/policy.spec.ts` "rule 16 continued: ending the spent programme" and its random-finances case, `funding/retained.spec.ts` "six worlds on one timeline", and `funding/apply.spec.ts` "a kind whose day fell in a month already applied". Closing's own behaviour is tested in `closing.spec.ts`. `funding/pools.spec.ts`'s guard that nothing reads `pools[q].inflows` still holds for serving and arrivals; the closing check's read of the frame definition's `inflows` through `lastArrivalOf` is the one read it allows. These five spec files are in pool-closing's changed files. No assertion is loosened.
## Re-read
- docs/superpowers/specs/2026-11-22-pool-closing-design.html § sec-design-option
- docs/superpowers/specs/2026-11-22-pool-closing-design.html § sec-write-set-files
- docs/superpowers/specs/2026-11-22-pool-closing-design.html § sec-tests-other
## Affected units
- pool-closing: clarification
## Build graph
- pool-closing
