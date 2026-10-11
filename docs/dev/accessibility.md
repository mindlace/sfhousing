# Accessibility

Target: WCAG 2.2 level AA.

## The gate

`e2e/helpers/a11y.ts` exports `expectNoA11yViolations(page, opts)`, an axe-core scan over the tag set `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22a, wcag22aa`. The list is additive: axe's version tags mark when a rule was introduced, they are not cumulative supersets, so do not swap `wcag21aa` for `wcag22aa`.

Options: `include` / `exclude` (CSS selectors), `disableRules` (rule ids a surface cannot satisfy yet; scope them per caller), and `structure: true`, which additionally runs `heading-order`, `region`, `landmark-one-main` and `page-has-heading-one` (best-practice rules the AA scan skips). Use `structure` on reading surfaces (about, attribution, error pages).

## Per-page checklist

- Every new page or route gets an a11y e2e that runs under both Playwright projects (`chromium` and `mobile` at 375 px).
- At 375 px the page has no horizontal scroll.
- A skip link, one `<main>`, one `<h1>`, and the footer links are reachable by keyboard.
- Interactive targets are at least 24x24 CSS px (SC 2.5.8).
- Anything draggable has a non-dragging alternative (SC 2.5.7).
