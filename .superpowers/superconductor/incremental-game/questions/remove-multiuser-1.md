# Question remove-multiuser-1 — from incremental-game-remove-multiuser
## Question
Interface row I1 gives `refuseUnlessSameOriginJson(event: RequestEvent): Response | null`. The current code takes a structural `event: { request: Request; url: URL }`. Should the parameter be narrowed to `RequestEvent` to match the row's text, or does the current type (which every `RequestEvent` satisfies) meet I1?

## What the package says
Spec `2026-11-22-remove-multiuser-design.html` §sec-if-i1: `export function refuseUnlessSameOriginJson(event: RequestEvent): Response | null;`. §sec-design-copy changes only its texts (to `AUTH_COPY`). §sec-design-identity says `same-origin-json.ts` "takes its texts from `AUTH_COPY`" and nothing else.

## What I found
- `src/lib/server/security/same-origin-json.ts:10` takes `event: { request: Request; url: URL }`; `refuseForeignOrigin` at `:22` the same (verified by the plan drafter on this branch at 7fbb5e32).
- Every caller in `src/routes/**` passes a full `RequestEvent` (drafter's report; I have not re-checked each caller).
- `same-origin-json.spec.ts` passes smaller objects; narrowing the type would make those specs need full events or casts.

## Options I see
1. Keep the structural type (a supertype of `RequestEvent`). Every consumer the row promises works unchanged. Recommended.
2. Narrow to `RequestEvent` literally; adjust the spec file's fixtures. One-line code change plus test fixture changes.

## Blocking
None. Task 1 keeps the current type; option 2 is a small follow-up if ruled.
