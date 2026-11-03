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
  it('no Tailwind blue or blue hex remains in chrome', () => {
    for (const f of SCANNED) {
      const src = readFileSync(fromRoot(f), 'utf8');
      expect(src, f).not.toMatch(/\bblue-\d{3}\b/);
      expect(src, f).not.toMatch(BLUE_HEX);
      expect(src, f).not.toMatch(BLUE_RGB);
    }
  });
});
