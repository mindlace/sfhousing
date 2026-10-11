// Reusable runtime WCAG 2.2 AA gate. Thin, policy-free wrapper over axe-core so
// every surface spec shares one assertion. Scoping (include/exclude/disableRules)
// is the CALLER's choice — this helper bakes in only the AA tag set.
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

// WCAG 2.0 + 2.1 + 2.2, Levels A and AA — the conformance target (see
// docs/dev/accessibility.md). Excludes AAA and best-practice rules.
//
// The list is ADDITIVE, not a swap. axe's version tags mark the WCAG release a
// rule was introduced in; they are not cumulative supersets. Dropping wcag21aa
// for wcag22aa would silently stop checking autocomplete-valid,
// avoid-inline-spacing and css-orientation-lock, which 2.2 still requires.
// wcag22a matches zero rules in axe-core 4.12.1 and is listed so a future axe
// release that adds one is picked up without another edit.
const AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

// Structure rules for reading surfaces (heading order + landmarks). These are
// best-practice-tagged in axe, so the AA tag scan never runs them; `structure:
// true` opts a surface in via a second runOnly-rules scan.
const STRUCTURE_RULES = ['heading-order', 'region', 'landmark-one-main', 'page-has-heading-one'];

export type A11yScanOptions = {
  // Restrict the scan to a region (CSS selector(s)) — e.g. a surface's root.
  include?: string | string[];
  // Carve a region out of the scan.
  exclude?: string | string[];
  // Rule ids a surface legitimately cannot satisfy yet (scoped per caller).
  disableRules?: string[];
  // Additionally enforce heading-order/landmark structure (reading surfaces).
  structure?: boolean;
};

type AxeViolations = Awaited<ReturnType<AxeBuilder['analyze']>>['violations'];

function scoped(page: Page, opts: A11yScanOptions): AxeBuilder {
  // preload: false stops axe-core from XHR-fetching cross-origin stylesheets to analyze
  // them for color-contrast. That fetch is governed by connect-src and would trip the e2e
  // CSP guard — a test-harness artifact, not an app bug. This app loads no third-party CSS.
  let builder = new AxeBuilder({ page }).options({ preload: false });
  if (opts.include) builder = builder.include(opts.include);
  if (opts.exclude) builder = builder.exclude(opts.exclude);
  if (opts.disableRules?.length) builder = builder.disableRules(opts.disableRules);
  return builder;
}

export async function expectNoA11yViolations(
  page: Page,
  opts: A11yScanOptions = {}
): Promise<void> {
  const violations: AxeViolations = (await scoped(page, opts).withTags(AA_TAGS).analyze())
    .violations;
  if (opts.structure) {
    // withRules (axe runOnly) takes precedence over disableRules, so honor the
    // caller's disableRules contract by filtering the structure rule set here.
    const structureRules = STRUCTURE_RULES.filter((r) => !opts.disableRules?.includes(r));
    violations.push(...(await scoped(page, opts).withRules(structureRules).analyze()).violations);
  }

  const summary = violations
    .map((v) => {
      const targets = v.nodes.map((n) => n.target.join(' ')).join(', ');
      return `  ✗ ${v.id} · ${v.impact ?? 'n/a'} · ${targets} · ${v.helpUrl}`;
    })
    .join('\n');

  expect(
    violations,
    `axe found ${violations.length} WCAG 2.2 AA violation(s):\n${summary}`
  ).toEqual([]);
}
