# Ruling remove-multiuser-1
Package commit: none
Changes design: no
Changes contract: no
## Ruling
I1 is met by the current parameter type. `refuseUnlessSameOriginJson` and `refuseForeignOrigin` keep `event: { request: Request; url: URL }`. I1's `RequestEvent` states what callers pass: every `RequestEvent` satisfies the structural type, so every caller works unchanged. This includes the routes in `src/routes/api/account/**` and `game-save`'s `/api/game` routes. The structural type also lets `same-origin-json.spec.ts` keep its small fixtures. The parameter is not narrowed. The only change to the file stays the one §sec-design-copy and §sec-design-identity give: its texts come from `AUTH_COPY`. A unit that calls the function passes its `RequestEvent` as it is.
## Re-read
- docs/superpowers/specs/2026-11-22-remove-multiuser-design.html § sec-if-i1
- docs/superpowers/specs/2026-11-22-remove-multiuser-design.html § sec-design-identity
## Affected units
## Build graph
