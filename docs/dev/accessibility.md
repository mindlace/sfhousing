# Accessibility

Target: WCAG 2.2 level AA.

## The gate

`e2e/helpers/a11y.ts` exports `expectNoA11yViolations(page, opts)`, an axe-core scan over the tag set `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22a, wcag22aa`. The list is additive: axe's version tags mark when a rule was introduced, they are not cumulative supersets, so do not swap `wcag21aa` for `wcag22aa`.

Options: `include` / `exclude` (CSS selectors), `disableRules` (rule ids a surface cannot satisfy yet; scope them per caller), and `structure: true`, which additionally runs `heading-order`, `region`, `landmark-one-main` and `page-has-heading-one` (best-practice rules the AA scan skips). Use `structure` on reading surfaces (about, attribution, error pages).

## Per-page checklist

- Every new page or route gets an a11y e2e that runs under both Playwright projects (`chromium` and `mobile` at 375 px).
- At 375 px the page has no horizontal scroll.
- A skip link, one `<main>`, one `<h1>`, and the header's About entry are reachable by keyboard on every page; document pages also have the footer links (the map pages have no footer).
- Interactive targets are at least 24 by 24 CSS px (SC 2.5.8), on mouse and touch alike: one size for every pointer, nothing larger on a coarse one (no 44 px rule; 44 px is the AAA criterion, 2.5.5). Adjacent targets keep at least 24 px between their centres, or enough spacing that a 24 px circle centred on each does not overlap another target or circle. Use a button kind, `TARGET` from `src/lib/shell/ui.ts` or its classes `min-h-6 min-w-6`; [ui-parts.md](ui-parts.md). `e2e/targets.spec.ts` sweeps every visible interactive element on `/` and `/about` at 375 px (the mobile project): `/` in the opening and the simulation, `/about` at rest and with the assumptions open, and the simulation with About open from the Menu. It lists its exemptions with their reasons. A target covered at its centre fails unless the cover is an open sheet, dialog, popover or toolbar panel (the key's, Layers') that does not hold the target, or another target; the map's credit is never an allowed cover. A row scrolled out of a box that clips it (a panel below its fold) is noted, and the test scrolls it into view and sweeps again; only a real scroller (overflow auto or scroll, with more content than room) in the target's containing-block chain counts as clipping it (the walk stops at a fixed element or a popover or dialog), so a fixed sheet's controls are always measured.
- Anything draggable has a non-dragging alternative (SC 2.5.7).
- No visible text of 12 words or more at rest outside a notice or a dialog, on `/`, in the opening and in the simulation. `src/routes/page.rest-text.svelte.spec.ts` checks the opening (an empty plan, one restored stroke, and with Details open, its disclosure too) and `src/lib/timeline/rest-text.svelte.spec.ts` checks the simulation; both use `longTexts` from `src/lib/shell/test/rest-text.ts`.
- A policy row in the timeline has a switch (`role="switch"`, named "{label} on"), the name and a New or Edit button, each at least 24 px; off shows by the knob and the muted name as well as colour, and there is no lock. A fixed policy's bars cannot be dragged, so they have no key to match (SC 2.5.7); the pane they open says when it becomes editable. See [timeline-ui.md](timeline-ui.md).
- The game's states (the opening, the opening with the room goal met, the simulation with the skip link focused, the game panel) have their scan in `e2e/game-a11y.spec.ts`.
