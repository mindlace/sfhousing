import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { wcagContrast } from 'culori';
import { describe, expect, it } from 'vitest';

const fromRoot = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const css = readFileSync(fromRoot('src/routes/layout.css'), 'utf8');
const theme = /@theme\s*\{([^}]*)\}/s.exec(css)?.[1] ?? '';
const tok: Record<string, string> = {};
for (const m of theme.matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g))
  tok[m[1]] = m[2].toUpperCase();
const contrast = (a: string, b: string) => wcagContrast(a, b);

const CHROME_FILES = [
  'src/lib/sharing/SharedBanner.svelte',
  'src/lib/sharing/PublishButton.svelte',
  'src/lib/sharing/PublishDialog.svelte',
  'src/lib/scoreboard/TargetRow.svelte',
  'src/lib/scoreboard/NeighborhoodList.svelte',
  'src/lib/sim-page/RouteTimeline.svelte',
  'src/lib/shell/SiteHeader.svelte'
];
const SCANNED = [
  ...CHROME_FILES,
  'src/lib/brush/RadiusPopover.svelte',
  'src/lib/fzp/TimeScrubber.svelte'
];
/** Files that follow the light and dark surface tokens (later plans append theirs). */
const THEMED_FILES = [
  'src/lib/shell/NoticePills.svelte',
  'src/lib/sim-page/SimNotices.svelte',
  'src/lib/fzp/FzpMode.svelte',
  'src/lib/fzp/SimResults.svelte',
  'src/lib/fzp/ScoreChart.svelte',
  'src/lib/fzp/MapKey.svelte',
  'src/lib/scoreboard/TargetRow.svelte',
  'src/lib/dock/Dock.svelte',
  'src/lib/scoreboard/HeaderScore.svelte',
  'src/lib/sim-page/RulesSection.svelte',
  'src/lib/sim-page/RuleBrushForm.svelte',
  'src/lib/sim-page/BrushCard.svelte',
  'src/lib/sim-page/CustomZoningSection.svelte',
  'src/lib/sim-page/PermittingSection.svelte',
  'src/lib/sim-page/RouteTimeline.svelte',
  'src/lib/sim-page/ProtectionsSection.svelte',
  'src/lib/sim-page/HistoryRow.svelte',
  'src/lib/sim-page/PolicySummary.svelte',
  'src/lib/sim-page/PhoneToolBar.svelte',
  'src/lib/fzp/ProjectCardPanel.svelte',
  'src/lib/fzp/ProjectTooltip.svelte'
];
/** Themed files whose colours come from tokens and custom properties only: no hex at all. */
const NO_HEX_FILES = [
  'src/lib/fzp/SimResults.svelte',
  'src/lib/fzp/ScoreChart.svelte',
  'src/lib/fzp/MapKey.svelte',
  'src/lib/scoreboard/TargetRow.svelte'
];
const BLUE_HEX = /#(1d4ed8|2563eb|1e40af|3b82f6|1e3a8a)\b/i;
const BLUE_RGB = /rgb\(\s*(29[ ,]+78[ ,]+216|37[ ,]+99[ ,]+235)\s*\)/i;

describe('app accent tokens', () => {
  it('declares the accent tokens', () => {
    expect(tok['accent']).toBe('#A3472C');
    expect(tok['accent-hover']).toBe('#84371F');
    expect(tok['accent-dark']).toBe('#E0955A');
    expect(tok['surface-dark']).toBe(tok['chrome-dark']);
  });
  it('on-accent text is >= 4.5:1 on accent and hover, light and dark', () => {
    expect(contrast(tok['on-accent'], tok['accent'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tok['on-accent'], tok['accent-hover'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tok['on-accent-dark'], tok['accent-dark'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tok['on-accent-dark'], tok['accent-dark-hover'])).toBeGreaterThanOrEqual(4.5);
  });
  it('accent fills are >= 3:1 on their tracks and backgrounds', () => {
    expect(contrast(tok['accent'], '#E5E7EB')).toBeGreaterThanOrEqual(3);
    expect(contrast(tok['accent'], '#F3F4F6')).toBeGreaterThanOrEqual(3);
    expect(contrast(tok['accent'], '#FFFFFF')).toBeGreaterThanOrEqual(3);
    expect(contrast(tok['accent-dark'], tok['chrome-dark'])).toBeGreaterThanOrEqual(3);
    expect(contrast('#111827', tok['accent-tint'])).toBeGreaterThanOrEqual(4.5);
  });
  it('text tokens are >= 4.5:1 on every surface of their theme', () => {
    for (const bg of ['surface', 'surface-raised'])
      for (const fg of ['ink', 'ink-muted'])
        expect(contrast(tok[fg], tok[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    for (const bg of ['surface-dark', 'surface-dark-raised'])
      for (const fg of ['ink-dark', 'ink-dark-muted', 'accent-dark'])
        expect(contrast(tok[fg], tok[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tok['accent'], tok['surface-raised'])).toBeGreaterThanOrEqual(4.5);
  });
  it('control borders are >= 3:1 on their surfaces (WCAG 1.4.11)', () => {
    for (const bg of ['surface', 'surface-raised'])
      expect(contrast(tok['control-line'], tok[bg])).toBeGreaterThanOrEqual(3);
    for (const bg of ['surface-dark', 'surface-dark-raised'])
      expect(contrast(tok['control-line-dark'], tok[bg])).toBeGreaterThanOrEqual(3);
  });
  it('the time bar uses tokens, not hex', () => {
    const src = readFileSync(fromRoot('src/lib/fzp/TimeScrubber.svelte'), 'utf8');
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
  it('the chart, results and target row carry no hex of their own', () => {
    for (const f of NO_HEX_FILES) {
      expect(readFileSync(fromRoot(f), 'utf8'), f).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    }
  });
  it('chart strokes are >= 3:1 on the surfaces of their theme, labels >= 4.5:1', () => {
    const light = /:root\s*\{([^}]*--chart-[^}]*)\}/s.exec(css)?.[1] ?? '';
    const dark = /prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}/s.exec(css)?.[1] ?? '';
    const vars = (block: string) => {
      const out: Record<string, string> = {};
      for (const m of block.matchAll(/--chart-([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g))
        out[m[1]] = m[2];
      return out;
    };
    expect(vars(dark)['total']).toBeDefined();
    const themes = [
      { v: vars(light), surfaces: ['surface', 'surface-raised'] },
      { v: { ...vars(light), ...vars(dark) }, surfaces: ['surface-dark', 'surface-dark-raised'] }
    ];
    for (const { v, surfaces } of themes)
      for (const s of surfaces) {
        for (const k of ['total', 'pipeline', 'fresh', 'plan', 'vertical', 'ink'])
          expect(contrast(v[k], tok[s]), `${k} on ${s}`).toBeGreaterThanOrEqual(3);
        expect(contrast(v['label'], tok[s]), `label on ${s}`).toBeGreaterThanOrEqual(4.5);
      }
  });
  it('themed files use surface and ink tokens, not bg-white or text-black', () => {
    for (const f of THEMED_FILES) {
      const src = readFileSync(fromRoot(f), 'utf8');
      expect(src, f).not.toMatch(/\bbg-white\b/);
      expect(src, f).not.toMatch(/\btext-black\b/);
    }
  });
  it('themed files pair every gray, white or black utility with a dark: class', () => {
    // Per quote-free string (a class attribute or a class constant): a gray, white or black
    // utility needs its dark: partner of the same kind (bg, border, text) in the same string.
    const bad: string[] = [];
    // TargetRow keeps its unthemed branch behind the temporary `themed` prop until a later plan
    // removes it.
    for (const f of THEMED_FILES.filter((f) => f !== 'src/lib/scoreboard/TargetRow.svelte')) {
      const src = readFileSync(fromRoot(f), 'utf8');
      for (const m of src.matchAll(/[^"'`]+/g)) {
        const chunk = m[0];
        for (const u of chunk.matchAll(/(?<![\w:-])(bg|border|text)-(?:gray-\d+|white|black)\b/g)) {
          if (!chunk.includes(`dark:${u[1]}-`)) bad.push(`${f}: ${u[0]}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
  it('no Tailwind blue or blue hex remains in chrome', () => {
    for (const f of SCANNED) {
      const src = readFileSync(fromRoot(f), 'utf8');
      expect(src, f).not.toMatch(/\bblue-\d{3}\b/);
      expect(src, f).not.toMatch(BLUE_HEX);
      expect(src, f).not.toMatch(BLUE_RGB);
    }
  });
});
