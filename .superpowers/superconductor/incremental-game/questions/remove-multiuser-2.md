# Question remove-multiuser-2 — from incremental-game-remove-multiuser
## Question
§sec-design-e2e says `mintTestPseudonym` writes a `user` with "the email `<userId>@` plus `PSEUDONYMOUS_EMAIL_DOMAIN`", and its doc comment says the rows are made "as the anonymous plugin would make them". Built with the mixed-case user id as written, the pseudonymous password e2e fails. May the address be stored lower-cased (`${userId}@${domain}`.toLowerCase())?

## What the package says
Spec `2026-11-22-remove-multiuser-design.html` §sec-design-e2e: the email bullet above, and the comment "A live pseudonymous `user` row and its identity, as the anonymous plugin would make them." §sec-tests-changed: "`mintTestPseudonym` writes an anonymous user with the pseudonymous email domain and a unique handle."

## What I found
- User ids are mixed-case. Better-Auth lower-cases every email when it stores or looks one up. The real anonymous plugin's rows therefore hold lower-case addresses (implementer's report, `.superpowers/sdd/2026-11-22-remove-multiuser.html/task-3-report.md` in my worktree; I have not checked the Better-Auth source myself).
- With the literal mixed-case address, `e2e/password-auth.spec.ts` "a pseudonymous user sets a password and signs back in with their handle" failed 10/10. With the lower-cased address it passes, along with the other six changed specs (260/260, `--repeat-each=5 --retries=0`). Commit a7d00320 on incremental-game-remove-multiuser.

## Options I see
1. Lower-case the address, as committed. This matches the comment's "as the anonymous plugin would make them" and the test entry's wording. Recommended.
2. Keep the literal mixed case and change the password e2e to sign in some other way. That makes the test seam unlike real accounts.

## Blocking
None. Option 1 is committed; option 2 would be a follow-up fix round.
