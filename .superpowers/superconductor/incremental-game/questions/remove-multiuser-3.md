# Question remove-multiuser-3 — from incremental-game-remove-multiuser
## Question
The new e2e cases that prove the removed URLs answer 404 (spec §sec-tests-e2e, "New in e2e/auth-a11y.spec.ts") make the preview server log `[WebServer] [404] GET /sims` and similar lines. Signoff fails on server output that is not on chreode's allow list. The allow list is `chreode.config.ts`, which is not in this unit's write set (the spec names `chreode.config.ts:72` as `closing`'s). Who adds the allow-list entry for these 404 lines, and may `remove-multiuser` add it?

## What the package says
- Spec `2026-11-22-remove-multiuser-design.html` §sec-tests-e2e requires `/sims`, `/sims/abc` and `/invite/abc` to answer 404 with "Page not found", and `GET /api/sims` and `POST /api/operator/sims/abc/takedown` to answer 404.
- §sec-global-constraints: "Signoff fails on server stderr, on timing crutches and on a retried flake."
- §sec-out-of-scope: "`chreode.config.ts:72`, which still names `drizzle.sim.config.ts` in a match list: `closing`." The unit's write set (assignment) does not list `chreode.config.ts`.

## What I found
- `chreode.config.ts` around `:189-192` already allow-lists the expected 404 of another e2e case: `pattern: /^\[WebServer\]\s+\[404\] GET \/no-such-page\s*$/`, with reason "the expected /no-such-page 404 that the e2e cache-headers and a11y specs request" (verified in my worktree at f6a31dde).
- The Task 6 implementer added, uncommitted, right after that entry:
  `pattern: /^\[WebServer\]\s+\[404\] (GET \/sims|GET \/sims\/abc|GET \/invite\/abc|GET \/api\/sims|POST \/api\/operator\/sims\/abc\/takedown)\s*$/`, reason "the expected 404s of the removed URLs that e2e/auth-a11y.spec.ts requests". I have told it to revert that edit and leave the file out of its commit.
- Unverified: I have not run signoff (no unit may) to see the 404 lines rejected; the inference comes from the existing `/no-such-page` entry.

## Options I see
1. Add `chreode.config.ts` to `remove-multiuser`'s write set for this one entry; I commit it with Task 6. Recommended: the entry belongs with the tests that cause it.
2. `closing` adds the entry when it edits `chreode.config.ts:72`. Until then a signoff run fails on these lines.
3. Change the tests so they log no 404 (not obvious how; SvelteKit logs every 404).

## Blocking
Only the allow-list entry. Task 6's e2e cases and doc commit without it.
