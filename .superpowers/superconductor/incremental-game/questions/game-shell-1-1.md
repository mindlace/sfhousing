# Question game-shell-1-1 — from incremental-game-game-shell-1
## Question
May game-shell-1 edit `src/routes/about/page.svelte.spec.ts` (one line) so the /about page test skips the two new Using-it subsections, `about-levels` and `about-saved-games`, as it already skips `about-shortcuts`?

## What the package says
- game-shell spec `sec-design-about`: Levels and Saved games are sections inside Using it, with headings at the part's sub-level, as Keyboard shortcuts.
- game-shell spec `sec-today-about` (:395): both parts render on `/about` and in the dialog.
- game-shell spec `sec-write-set` lists `src/lib/about/**` and `docs/dev/about.md`. It does not list `src/routes/about/**`; `sec-write-set-files` does not name `src/routes/about/page.svelte.spec.ts`. No spec or design file in the package mentions `routes/about` (grep, verified).

## What I found
- `src/routes/about/page.svelte.spec.ts:29-32` lists every `section[id^="about-"]` on the page, filters out only `ABOUT_ID.shortcuts`, and expects exactly the four part ids. The new sections `about-levels` and `about-saved-games` (commit 9285d15c, `src/lib/about/AboutUsing.svelte`) now appear too, so the test fails (fixrounds/game-shell-1-9285d15c.txt:1-2, :55-56).
- The h2 check in the same test (:22-28) is unaffected: the new headings are h3.
- The same pattern in `src/lib/about/AboutDialog.svelte.spec.ts:195-198` was already changed in 9285d15c, under `src/lib/about/**`.
- Unverified: whether any other spec outside `src/lib/about/**` enumerates `about-*` sections. I will run the whole unit suite after the fix to find out.

## Options I see
1. Allow the edit: line 31 filters `[ABOUT_ID.shortcuts, ABOUT_ID.levels, ABOUT_ID.savedGames]` (same as the dialog spec). Cheapest, keeps the test's intent (the four parts in order).
2. Change the selector in both specs to direct part sections only (e.g. `:scope > section` under the parts' root), so future subsections need no edit. Touches the same file; slightly larger.
3. Give the fix to another unit that owns `src/routes/about/**`.

## Blocking
Task 7 fix round (the merge of incremental-game-game-shell-1 into superconductor/incremental-game).
