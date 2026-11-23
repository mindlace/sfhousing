# Ruling remove-multiuser-3
Package commit: 576a23d9
Changes design: yes
Changes contract: no
## Ruling
The unit whose e2e case requests a removed URL on purpose owns the allow-list entry for the 404 lines that request logs. A unit whose e2e case requests a path that answers 404 on purpose adds, in the same change, one `stderrAllowlist` entry to `chreode.config.ts` that matches exactly the `[WebServer] [404]` lines those requests log, right after the existing `/no-such-page` entry. The `✘ [ERROR]` header and the spacer lines of each 404 block are already allowed.

- `remove-multiuser` adds one entry whose pattern matches exactly `[WebServer] [404] GET /sims`, `GET /sims/abc`, `GET /invite/abc`, `GET /api/sims` and `POST /api/operator/sims/abc/takedown`, with the reason "the expected 404s of the removed URLs that e2e/auth-a11y.spec.ts requests". It changes nothing else in `chreode.config.ts`; line 72 stays `closing`'s. The edit the Task 6 implementer made is this entry: it is committed with Task 6.
- `remove-lesscars` adds the same kind of entry for `GET /fzp` and `GET /lesscars`, which its 404 loop in `e2e/pages-a11y.spec.ts` requests.
- `chreode.config.ts` is written by `remove-lesscars` (the dataset path list and its entry) and by `remove-multiuser` (its entry), in either order because the hunks do not touch, and then by `closing`.
- `closing`'s final sweep treats these entries as allowed places: they stay while the 404 checks do.

Reason: the entry exists only because of the tests, so it belongs with the change that adds them; deferring it to `closing` would leave every signoff run red until the end of the build. The tests cannot avoid the log line, since the server logs every 404.
## Re-read
- docs/superpowers/design/2026-11-22-1216-incremental-game.html § sec-write-sets (tbl-write-sets rows remove-multiuser and remove-lesscars, ordering notes)
- docs/superpowers/specs/2026-11-22-remove-multiuser-design.html § sec-write-set, sec-write-set-changed, sec-tests-e2e
- docs/superpowers/specs/2026-11-22-remove-lesscars-design.html § sec-write-set, sec-write-edit, sec-tests-added
- docs/superpowers/specs/2026-11-22-closing-design.html § sec-write-set (ordering notes), sec-design-sweep
- docs/superpowers/design/2026-11-22-1216-incremental-game-build-graph.md (rows remove-multiuser, remove-lesscars)
## Affected units
- remove-multiuser: clarification
- remove-lesscars: clarification
- closing: clarification
## Build graph
- remove-multiuser
- remove-lesscars
- closing
